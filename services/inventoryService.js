// Inventory Service - จัดการ Business Logic และกติกาการตัดสต็อก
const pool = require('../config/database');

/**
 * ตัดสต็อกสินค้าตามกติกา FEFO หรือ FIFO ภายใต้ Transaction + SELECT ... FOR UPDATE
 * @param {number} itemId รหัสสินค้า
 * @param {number} requestedQty จำนวนที่ต้องการเบิก (ต้องมากกว่า 0)
 * @param {number} userId ผู้ทำรายการ
 * @param {string} note หมายเหตุ
 * @returns {Promise<object>} ผลการตัดสต็อกและรายละเอียดว่าตัดจากล็อตไหนบ้าง
 */
async function issueStock(itemId, requestedQty, userId, note = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. ตรวจสอบข้อมูลสินค้าและหมวดหมู่
    const itemRes = await client.query(
      `SELECT id, item_code, name, category, base_unit, is_active 
       FROM items 
       WHERE id = $1`,
      [itemId]
    );

    if (itemRes.rows.length === 0) {
      const err = new Error('ไม่พบรายการสินค้าที่ระบุ');
      err.status = 404;
      throw err;
    }

    const item = itemRes.rows[0];
    if (!item.is_active) {
      const err = new Error('รายการสินค้านี้ถูกระงับการใช้งาน');
      err.status = 400;
      throw err;
    }

    // 2. ดึงล็อตสินค้าพร้อม LOCK แถว (SELECT ... FOR UPDATE)
    // กติกา:
    // - antibiotic และ vaccine: กรองเฉพาะล็อตที่ยังไม่หมดอายุ (exp_date >= CURRENT_DATE) และเรียงตาม exp_date ASC (FEFO)
    // - feed: เรียงตาม received_date ASC, id ASC (FIFO) และถ้ามีวันหมดอายุก็ต้องยังไม่หมดอายุ
    let batchQuery = '';
    if (item.category === 'antibiotic' || item.category === 'vaccine') {
      batchQuery = `
        SELECT id, lot_no, exp_date, received_date, qty_remaining
        FROM inventory_batches
        WHERE item_id = $1 
          AND qty_remaining > 0
          AND exp_date >= CURRENT_DATE
        ORDER BY exp_date ASC, id ASC
        FOR UPDATE
      `;
    } else {
      // feed
      batchQuery = `
        SELECT id, lot_no, exp_date, received_date, qty_remaining
        FROM inventory_batches
        WHERE item_id = $1 
          AND qty_remaining > 0
          AND (exp_date IS NULL OR exp_date >= CURRENT_DATE)
        ORDER BY received_date ASC, id ASC
        FOR UPDATE
      `;
    }

    const batchesRes = await client.query(batchQuery, [itemId]);
    const availableBatches = batchesRes.rows;

    // คำนวณยอดรวมที่ใช้ได้
    const totalAvailable = availableBatches.reduce((acc, b) => acc + parseFloat(b.qty_remaining), 0);

    if (totalAvailable < requestedQty) {
      const err = new Error(`สต็อกไม่เพียงพอ (ต้องการเบิก: ${requestedQty} ${item.base_unit}, มีพร้อมใช้: ${totalAvailable} ${item.base_unit})`);
      err.status = 409; // 409 Conflict ตามข้อกำหนด
      throw err;
    }

    // 3. ทยอยตัดยอดข้ามล็อต
    let remainingToDeduct = requestedQty;
    const deductions = [];

    for (const batch of availableBatches) {
      if (remainingToDeduct <= 0.0001) break;

      const currentRemaining = parseFloat(batch.qty_remaining);
      const deductFromThisBatch = Math.min(currentRemaining, remainingToDeduct);
      const newBalance = Math.round((currentRemaining - deductFromThisBatch) * 100) / 100;
      const actualDeduct = Math.round(deductFromThisBatch * 100) / 100;

      // อัปเดตยอดคงเหลือในล็อต
      await client.query(
        `UPDATE inventory_batches
         SET qty_remaining = $1
         WHERE id = $2`,
        [newBalance, batch.id]
      );

      // บันทึก Stock Transaction (Type: issue)
      await client.query(
        `INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
         VALUES ($1, $2, 'issue', $3, $4, $5, $6)`,
        [itemId, batch.id, actualDeduct, newBalance, userId, note || `จ่ายออก (${item.category.toUpperCase()})`]
      );

      deductions.push({
        batchId: batch.id,
        lotNo: batch.lot_no,
        expDate: batch.exp_date,
        deductedQty: actualDeduct,
        balanceAfter: newBalance,
      });

      remainingToDeduct = Math.round((remainingToDeduct - deductFromThisBatch) * 100) / 100;
    }

    await client.query('COMMIT');

    return {
      success: true,
      item: {
        id: item.id,
        itemCode: item.item_code,
        name: item.name,
        category: item.category,
        baseUnit: item.base_unit,
      },
      requestedQty,
      strategyUsed: (item.category === 'antibiotic' || item.category === 'vaccine') ? 'FEFO' : 'FIFO',
      deductions,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * รับสินค้าเข้าสต็อก (สร้างล็อตใหม่ หรือเพิ่มในล็อตเดิม)
 */
async function receiveStock({ itemId, lotNo, mfgDate, expDate, receivedDate, qty, supplier, note, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ตรวจสอบสินค้า
    const itemRes = await client.query('SELECT id, name, category, is_active FROM items WHERE id = $1 FOR UPDATE', [itemId]);
    if (itemRes.rows.length === 0) {
      const err = new Error('ไม่พบรายการสินค้าที่ระบุ');
      err.status = 404;
      throw err;
    }
    const item = itemRes.rows[0];

    // กติกาหมวดหมู่ antibiotic & vaccine
    if (item.category === 'antibiotic' || item.category === 'vaccine') {
      if (!lotNo || !lotNo.trim()) {
        const err = new Error(`สินค้าหมวด ${item.category} จำเป็นต้องระบุหมายเลขล็อต (lot_no)`);
        err.status = 400;
        throw err;
      }
      if (!expDate) {
        const err = new Error(`สินค้าหมวด ${item.category} จำเป็นต้องระบุวันหมดอายุ (exp_date)`);
        err.status = 400;
        throw err;
      }
    }

    // กติกาความถูกต้องของวันที่: ห้ามรับของที่หมดอายุย้อนหลัง หรือมีวันหมดอายุเท่ากับ/ก่อนวันที่รับเข้า
    const effectiveReceivedDate = receivedDate ? new Date(receivedDate) : new Date();
    effectiveReceivedDate.setHours(0, 0, 0, 0);

    if (expDate) {
      const parsedExpDate = new Date(expDate);
      parsedExpDate.setHours(0, 0, 0, 0);
      if (parsedExpDate <= effectiveReceivedDate) {
        const err = new Error('วันหมดอายุ (exp_date) ต้องอยู่หลังจากวันที่รับเข้า (ห้ามรับของที่หมดอายุแล้วหรือหมดอายุย้อนหลัง)');
        err.status = 400;
        throw err;
      }
    }

    if (mfgDate) {
      const parsedMfgDate = new Date(mfgDate);
      parsedMfgDate.setHours(0, 0, 0, 0);
      if (parsedMfgDate > effectiveReceivedDate) {
        const err = new Error('วันผลิต (mfg_date) ต้องไม่อยู่หลังวันที่รับเข้าสินค้า');
        err.status = 400;
        throw err;
      }
    }

    // ตรวจสอบว่าล็อตนี้มีอยู่แล้วหรือไม่
    const existingBatchRes = await client.query(
      'SELECT id, qty_remaining, qty_received FROM inventory_batches WHERE item_id = $1 AND lot_no = $2 FOR UPDATE',
      [itemId, lotNo]
    );

    let batchId;
    let newBalance;

    if (existingBatchRes.rows.length > 0) {
      // มีล็อตเดิม -> เพิ่มยอด
      const batch = existingBatchRes.rows[0];
      const updatedReceived = parseFloat(batch.qty_received) + qty;
      newBalance = parseFloat(batch.qty_remaining) + qty;
      batchId = batch.id;

      await client.query(
        `UPDATE inventory_batches 
         SET qty_received = $1, 
             qty_remaining = $2, 
             mfg_date = COALESCE($3, mfg_date),
             exp_date = COALESCE($4, exp_date),
             supplier = COALESCE($5, supplier),
             note = COALESCE($6, note)
         WHERE id = $7`,
        [updatedReceived, newBalance, mfgDate || null, expDate || null, supplier || null, note, batchId]
      );
    } else {
      // สร้างล็อตใหม่
      newBalance = qty;
      const insertRes = await client.query(
        `INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
         VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $6, $7, $8)
         RETURNING id`,
        [itemId, lotNo, mfgDate || null, expDate || null, receivedDate || null, qty, supplier || null, note || null]
      );
      batchId = insertRes.rows[0].id;
    }

    // บันทึกธุรกรรม stock_transactions
    await client.query(
      `INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
       VALUES ($1, $2, 'receive', $3, $4, $5, $6)`,
      [itemId, batchId, qty, newBalance, userId, note || 'รับสินค้าเข้าสต็อก']
    );

    await client.query('COMMIT');
    return { success: true, batchId, balanceAfter: newBalance };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * ปรับยอดสต็อก (Adjust) สำหรับตรวจนับ
 */
async function adjustStock({ itemId, batchId, newQty, reason, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const batchRes = await client.query(
      'SELECT id, item_id, lot_no, qty_remaining FROM inventory_batches WHERE id = $1 AND item_id = $2 FOR UPDATE',
      [batchId, itemId]
    );

    if (batchRes.rows.length === 0) {
      const err = new Error('ไม่พบล็อตสินค้าที่ต้องการปรับยอด');
      err.status = 404;
      throw err;
    }

    const batch = batchRes.rows[0];
    const currentRemaining = parseFloat(batch.qty_remaining);
    const diff = newQty - currentRemaining;

    if (diff === 0) {
      await client.query('COMMIT');
      return { success: true, message: 'ยอดคงเหลือตรงกันแล้ว ไม่มีการปรับยอด' };
    }

    // อัปเดตยอดคงเหลือในล็อต
    await client.query(
      'UPDATE inventory_batches SET qty_remaining = $1 WHERE id = $2',
      [newQty, batchId]
    );

    // บันทึกธุรกรรม (qty เป็นค่าบวกเสมอตามกติกา CHECK (qty > 0))
    await client.query(
      `INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
       VALUES ($1, $2, 'adjust', $3, $4, $5, $6)`,
      [
        itemId, 
        batchId, 
        Math.abs(diff), 
        newQty, 
        userId, 
        reason ? `ปรับยอดตรวจนับ: ${reason} (${diff > 0 ? '+' : ''}${diff})` : `ปรับยอดตรวจนับ (${diff > 0 ? '+' : ''}${diff})`
      ]
    );

    await client.query('COMMIT');
    return { success: true, oldQty: currentRemaining, newQty, diff };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * ทำลายสินค้าหมดอายุ (Dispose Expired Stock)
 * - ตัดยอดออกจาก inventory_batches
 * - บันทึกธุรกรรม stock_transactions (type = 'dispose')
 * - บันทึกประวัติและหลักฐานการทำลายใน disposal_records (status = 'completed')
 */
async function disposeStock({ itemId, batchId, qty, reason, disposalMethod, witnessName, note, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ตรวจสอบและ Lock ล็อตสินค้า
    const batchRes = await client.query(
      `SELECT b.*, i.name as item_name, i.base_unit
       FROM inventory_batches b
       JOIN items i ON b.item_id = i.id
       WHERE b.id = $1 AND b.item_id = $2
       FOR UPDATE`,
      [batchId, itemId]
    );

    if (batchRes.rows.length === 0) {
      const err = new Error('ไม่พบล็อตสินค้าที่ต้องการทำลาย');
      err.status = 404;
      throw err;
    }

    const batch = batchRes.rows[0];
    const currentRemaining = parseFloat(batch.qty_remaining);
    const disposeQty = parseFloat(qty);

    if (isNaN(disposeQty) || disposeQty <= 0) {
      const err = new Error('จำนวนที่ต้องการทำลายต้องมากกว่า 0');
      err.status = 400;
      throw err;
    }

    if (disposeQty > currentRemaining) {
      const err = new Error(`จำนวนที่ต้องการทำลาย (${disposeQty}) มากกว่ายอดคงเหลือในล็อต (${currentRemaining} ${batch.base_unit})`);
      err.status = 400;
      throw err;
    }

    const newBalance = currentRemaining - disposeQty;

    // 1. ตัดยอดคงเหลือในล็อต
    await client.query(
      'UPDATE inventory_batches SET qty_remaining = $1 WHERE id = $2',
      [newBalance, batchId]
    );

    // 2. บันทึกธุรกรรม stock_transactions
    await client.query(
      `INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
       VALUES ($1, $2, 'dispose', $3, $4, $5, $6)`,
      [
        itemId,
        batchId,
        disposeQty,
        newBalance,
        userId,
        `ทำลายสินค้าหมดอายุ (${disposalMethod}): ${reason}${witnessName ? ' | พยาน: ' + witnessName : ''}`
      ]
    );

    // 3. บันทึกประวัติการทำลายใน disposal_records
    const disposalRes = await client.query(
      `INSERT INTO disposal_records 
        (item_id, batch_id, qty, reason, disposal_method, witness_name, disposed_by, status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8)
       RETURNING id, disposed_at`,
      [
        itemId,
        batchId,
        disposeQty,
        reason,
        disposalMethod,
        witnessName || null,
        userId,
        note || null
      ]
    );

    await client.query('COMMIT');
    return {
      success: true,
      disposalId: disposalRes.rows[0].id,
      disposedAt: disposalRes.rows[0].disposed_at,
      batchId,
      lotNo: batch.lot_no,
      disposedQty: disposeQty,
      newBalance,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  issueStock,
  receiveStock,
  adjustStock,
  disposeStock,
};
