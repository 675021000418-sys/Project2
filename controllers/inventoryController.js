// Controller สำหรับคลังวัสดุและเวชภัณฑ์ (Inventory Controller)
const pool = require('../config/database');
const { z } = require('zod');
const inventoryService = require('../services/inventoryService');

// Zod Schema สำหรับสร้าง/แก้ไข Item
const itemSchema = z.object({
  item_code: z.string({ required_error: 'กรุณาระบุรหัสสินค้า' })
    .trim().min(1, 'รหัสสินค้าต้องไม่ว่างเปล่า'),
  name: z.string({ required_error: 'กรุณาระบุชื่อสินค้า' })
    .trim().min(1, 'ชื่อสินค้าต้องไม่ว่างเปล่า'),
  category: z.enum(['feed', 'antibiotic', 'vaccine'], {
    errorMap: () => ({ message: 'หมวดหมู่ต้องเป็น อาหารสัตว์ (feed), ยาปฏิชีวนะ (antibiotic) หรือ วัคซีน (vaccine)' }),
  }),
  base_unit: z.string({ required_error: 'กรุณาระบุหน่วยหลัก' })
    .trim().min(1, 'หน่วยหลักต้องไม่ว่างเปล่า'),
  alt_unit: z.string().trim().optional().nullable(),
  unit_factor: z.coerce.number().positive('อัตราส่วนหน่วยย่อยต้องมากกว่า 0').optional().nullable(),
  reorder_point: z.coerce.number().min(0, 'จุดสั่งซื้อซ้ำต้องไม่ติดลบ').default(0),
  unit_cost: z.coerce.number().min(0, 'ราคาต่อหน่วยต้องไม่ติดลบ').optional().nullable(),
  storage_note: z.string().trim().optional().nullable(),
});

// Zod Schema สำหรับรับเข้า (Receive)
const receiveSchema = z.object({
  lot_no: z.string({ required_error: 'กรุณาระบุหมายเลขล็อต' }).trim().min(1, 'หมายเลขล็อตต้องไม่ว่างเปล่า'),
  qty: z.coerce.number().positive('จำนวนที่รับเข้าต้องมากกว่า 0'),
  mfg_date: z.string().trim().optional().nullable(),
  exp_date: z.string().trim().optional().nullable(),
  received_date: z.string().trim().optional().nullable(),
  supplier: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

// Zod Schema สำหรับจ่ายออก (Issue)
const issueSchema = z.object({
  qty: z.coerce.number().positive('จำนวนที่ต้องการเบิกต้องมากกว่า 0'),
  note: z.string().trim().optional().nullable(),
});

// Zod Schema สำหรับปรับยอด (Adjust)
const adjustSchema = z.object({
  batch_id: z.coerce.number().int().positive('กรุณาระบุรหัสล็อตสินค้าให้ถูกต้อง'),
  new_qty: z.coerce.number().min(0, 'ยอดคงเหลือใหม่ต้องไม่ติดลบ'),
  reason: z.string({ required_error: 'กรุณาระบุเหตุผลการปรับปรุงยอด' }).trim().min(1, 'กรุณาระบุเหตุผลการปรับปรุงยอด'),
});

// Zod Schema สำหรับทำลายสินค้าหมดอายุ (Dispose)
const disposeSchema = z.object({
  batch_id: z.coerce.number().int().positive('กรุณาระบุรหัสล็อตสินค้า'),
  qty: z.coerce.number().positive('จำนวนที่ต้องการทำลายต้องมากกว่า 0'),
  reason: z.string({ required_error: 'กรุณาระบุเหตุผลการทำลาย' }).trim().min(1, 'กรุณาระบุเหตุผลการทำลาย'),
  disposal_method: z.string({ required_error: 'กรุณาระบุวิธีการทำลาย' }).trim().min(1, 'กรุณาระบุวิธีการทำลาย'),
  witness_name: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

function formatZodErrors(err) {
  return err.errors.map(e => e.message).join(', ');
}

/**
 * ตรวจสอบความถูกต้องของจำนวนตามประเภทหน่วย
 * - ถ้าหน่วยเป็น 'ขวด' (หรือแผง, โหล) จะต้องเป็นจำนวนเต็มเท่านั้น ห้ามมีทศนิยม
 * - ถ้าเป็นหน่วยที่รองรับทศนิยม เช่น ถุง, กระสอบ, กก., กรัม, มล. จะมีทศนิยมได้
 */
function validateUnitQuantity(qty, unit) {
  const num = parseFloat(qty);
  if (isNaN(num) || num <= 0) {
    return { valid: false, message: 'จำนวนต้องมากกว่า 0' };
  }

  const u = (unit || '').toLowerCase();
  const isDiscreteUnit = u.includes('ขวด') || u.includes('แผง') || u.includes('โหล');

  if (isDiscreteUnit) {
    // ต้องเป็นจำนวนเต็มเท่านั้น
    if (!Number.isInteger(num) && Math.abs(num - Math.round(num)) > 0.0001) {
      return {
        valid: false,
        message: `หน่วย "${unit}" ต้องระบุเป็นจำนวนเต็มเท่านั้น ไม่สามารถใส่จุดทศนิยมได้`
      };
    }
  }

  return { valid: true };
}

/**
 * GET /app/inventory - หน้าภาพรวมสต็อก
 */
async function renderInventoryPage(req, res, next) {
  try {
    const { category, status, search, sort, order, page = 1 } = req.query;
    const limit = 10;
    const currentPage = Math.max(1, parseInt(page) || 1);
    const offset = (currentPage - 1) * limit;

    let baseQuery = `
      FROM v_item_stock v
      LEFT JOIN files f ON v.image_file_id = f.id
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      params.push(category);
      baseQuery += ` AND v.category = $${params.length}`;
    }

    if (status) {
      params.push(status);
      baseQuery += ` AND v.stock_status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      baseQuery += ` AND (v.item_code ILIKE $${params.length} OR v.name ILIKE $${params.length})`;
    }

    // นับจำนวนทั้งหมดสำหรับ Pagination
    const countRes = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalItemsCount = parseInt(countRes.rows[0].count);
    const totalPages = Math.ceil(totalItemsCount / limit) || 1;

    // การเรียงลำดับ (Sorting)
    const validSortCols = {
      item_code: 'v.item_code',
      name: 'v.name',
      category: 'v.category',
      stock: 'v.total_usable_stock',
      reorder: 'v.reorder_point',
      exp: 'v.earliest_exp_date',
    };
    const sortCol = validSortCols[sort] || 'v.id';
    const sortOrder = (order && order.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';

    const dataQuery = `
      SELECT v.*, f.stored_name as image_file_name
      ${baseQuery}
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const result = await pool.query(dataQuery, params);

    // สถิติ 4 ช่อง
    const statsRes = await pool.query(`
      SELECT 
        COUNT(*) AS total_items,
        COUNT(*) FILTER (WHERE stock_status = 'low_stock') AS low_stock_count,
        COUNT(*) FILTER (WHERE stock_status = 'near_exp') AS near_exp_count,
        COUNT(*) FILTER (WHERE stock_status = 'out_of_stock' OR expired_stock > 0) AS expired_or_out_count,
        COUNT(*) FILTER (WHERE expired_stock > 0) AS expired_batch_count
      FROM v_item_stock
    `);

    // ดึงรายการวิกฤติสำหรับกล่องแจ้งเตือน (สีส้ม/แดง)
    const alertItemsRes = await pool.query(`
      SELECT id, item_code, name, category, stock_status, earliest_exp_date, total_usable_stock, reorder_point, expired_stock
      FROM v_item_stock
      WHERE stock_status IN ('low_stock', 'near_exp', 'out_of_stock') OR expired_stock > 0
      ORDER BY 
        CASE 
          WHEN expired_stock > 0 THEN 1
          WHEN stock_status = 'out_of_stock' THEN 2 
          WHEN stock_status = 'low_stock' THEN 3 
          ELSE 4 
        END, earliest_exp_date ASC NULLS LAST
      LIMIT 8
    `);

    // ข้อมูลสำหรับกราฟ Chart.js (แสดงคงเหลือเทียบ reorder_point 15 รายการแรก)
    const chartDataRes = await pool.query(`
      SELECT item_code, name, total_usable_stock, reorder_point
      FROM v_item_stock
      ORDER BY id ASC
      LIMIT 15
    `);

    res.render('inventory/index', {
      pageTitle: 'คลังวัสดุและเวชภัณฑ์',
      items: result.rows,
      stats: statsRes.rows[0],
      alertItems: alertItemsRes.rows,
      chartData: chartDataRes.rows,
      pagination: {
        currentPage,
        totalPages,
        totalItemsCount,
        hasPrev: currentPage > 1,
        hasNext: currentPage < totalPages,
      },
      filters: { 
        category: category || '', 
        status: status || '', 
        search: search || '',
        sort: sort || 'id',
        order: sortOrder.toLowerCase()
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /app/inventory/:id - หน้ารายละเอียดสินค้า + ล็อต + ประวัติธุรกรรม
 */
async function renderItemDetailPage(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).render('error', { status: 400, error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const itemRes = await pool.query(`
      SELECT v.*, f.stored_name as image_file_name
      FROM v_item_stock v
      LEFT JOIN files f ON v.image_file_id = f.id
      WHERE v.id = $1
    `, [itemId]);

    if (itemRes.rows.length === 0) {
      return res.status(404).render('error', { status: 404, error: 'ไม่พบรายการสินค้าที่ระบุ' });
    }
    const item = itemRes.rows[0];

    // ล็อตสินค้าเรียงตาม FEFO (ยา/วัคซีน) หรือ FIFO (อาหาร)
    // ล็อตที่ทำลายแล้วจนยอดเป็น 0 จะไม่แสดงในรายการล็อตคงเหลือ หรือสามารถแยกแสดงได้
    const batchesRes = await pool.query(
      `SELECT b.*,
        CASE 
          WHEN EXISTS (SELECT 1 FROM disposal_records d WHERE d.batch_id = b.id) AND b.qty_remaining <= 0 THEN 'disposed'
          WHEN b.qty_remaining <= 0 THEN 'empty'
          WHEN b.exp_date IS NOT NULL AND b.exp_date < CURRENT_DATE THEN 'expired'
          WHEN b.exp_date IS NOT NULL AND b.exp_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'near_exp'
          ELSE 'normal'
        END AS lot_status
       FROM inventory_batches b
       WHERE b.item_id = $1 
         AND NOT (EXISTS (SELECT 1 FROM disposal_records d WHERE d.batch_id = b.id) AND b.qty_remaining <= 0)
       ORDER BY 
         CASE WHEN b.exp_date IS NULL THEN 1 ELSE 0 END,
         b.exp_date ASC, 
         b.received_date ASC, 
         b.id ASC`,
      [itemId]
    );

    // หา ID ของล็อตแรกที่จะถูกตัดก่อน (เพื่อไฮไลต์ในตาราง)
    let nextLotIdToDeduct = null;
    for (const b of batchesRes.rows) {
      const isExpired = b.exp_date && new Date(b.exp_date) < new Date();
      if (parseFloat(b.qty_remaining) > 0 && !isExpired) {
        nextLotIdToDeduct = b.id;
        break;
      }
    }

    // ประวัติธุรกรรมสต็อก พร้อม Pagination (หน้าละ 10 รายการ)
    const txPage = Math.max(1, parseInt(req.query.tx_page) || 1);
    const txLimit = 10;
    const txOffset = (txPage - 1) * txLimit;

    const txCountRes = await pool.query('SELECT COUNT(*) FROM stock_transactions WHERE item_id = $1', [itemId]);
    const totalTx = parseInt(txCountRes.rows[0].count);
    const totalTxPages = Math.ceil(totalTx / txLimit) || 1;

    const transactionsRes = await pool.query(
      `SELECT st.*, b.lot_no, u.full_name as performed_by_name
       FROM stock_transactions st
       JOIN inventory_batches b ON st.batch_id = b.id
       JOIN users u ON st.performed_by = u.id
       WHERE st.item_id = $1
       ORDER BY st.created_at DESC
       LIMIT ${txLimit} OFFSET ${txOffset}`,
      [itemId]
    );

    // รายชื่อโรงเรือนที่เปิดใช้งาน (สำหรับเลือกในแบบฟอร์มขอเบิก)
    const housesRes = await pool.query(
      `SELECT id, name, animal_type FROM houses WHERE status = 'active' ORDER BY id ASC`
    );

    res.render('inventory/detail', {
      pageTitle: `${item.name} (${item.item_code})`,
      item,
      batches: batchesRes.rows,
      nextLotIdToDeduct,
      houses: housesRes.rows,
      transactions: transactionsRes.rows,
      txPagination: {
        currentPage: txPage,
        totalPages: totalTxPages,
        totalTx,
        hasPrev: txPage > 1,
        hasNext: txPage < totalTxPages,
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/summary - JSON สำหรับแดชบอร์ด
 */
async function getInventorySummary(req, res, next) {
  try {
    const statsRes = await pool.query(`
      SELECT 
        COUNT(*) AS total_items,
        COUNT(*) FILTER (WHERE category = 'feed') AS feed_count,
        COUNT(*) FILTER (WHERE category = 'antibiotic') AS antibiotic_count,
        COUNT(*) FILTER (WHERE category = 'vaccine') AS vaccine_count,
        COUNT(*) FILTER (WHERE stock_status = 'normal') AS normal_count,
        COUNT(*) FILTER (WHERE stock_status = 'near_exp') AS near_exp_count,
        COUNT(*) FILTER (WHERE stock_status = 'low_stock') AS low_stock_count,
        COUNT(*) FILTER (WHERE stock_status = 'out_of_stock') AS out_of_stock_count,
        COALESCE(SUM(near_exp_stock), 0) AS total_near_exp_qty,
        COALESCE(SUM(expired_stock), 0) AS total_expired_qty
      FROM v_item_stock
    `);

    const criticalItemsRes = await pool.query(`
      SELECT id, item_code, name, category, base_unit, total_usable_stock, reorder_point, earliest_exp_date, stock_status
      FROM v_item_stock
      WHERE stock_status IN ('low_stock', 'near_exp', 'out_of_stock')
      ORDER BY 
        CASE stock_status 
          WHEN 'out_of_stock' THEN 1 
          WHEN 'low_stock' THEN 2 
          WHEN 'near_exp' THEN 3 
          ELSE 4 
        END, earliest_exp_date ASC NULLS LAST
      LIMIT 10
    `);

    res.json({
      summary: statsRes.rows[0],
      criticalItems: criticalItemsRes.rows,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /app/inventory - เพิ่ม Item ใหม่ + รูปภาพ
 */
async function createItem(req, res, next) {
  try {
    const parseResult = itemSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: formatZodErrors(parseResult.error) });
    }

    const data = parseResult.data;

    // เช็ค item_code ซ้ำ
    const checkRes = await pool.query('SELECT 1 FROM items WHERE item_code = $1', [data.item_code]);
    if (checkRes.rows.length > 0) {
      return res.status(400).json({ error: 'รหัสสินค้านี้มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น' });
    }

    let imageFileId = null;
    if (req.file) {
      const fileRes = await pool.query(
        `INSERT INTO files (original_name, stored_name, mime_type, size_bytes, uploaded_by, ref_type)
         VALUES ($1, $2, $3, $4, $5, 'item')
         RETURNING id`,
        [req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.session.userId]
      );
      imageFileId = fileRes.rows[0].id;
    }

    const insertRes = await pool.query(
      `INSERT INTO items (item_code, name, category, base_unit, alt_unit, unit_factor, reorder_point, unit_cost, storage_note, image_file_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        data.item_code, data.name, data.category, data.base_unit,
        data.alt_unit || null, data.unit_factor || null, data.reorder_point,
        data.unit_cost || null, data.storage_note || null, imageFileId
      ]
    );

    res.status(201).json({
      success: true,
      message: 'เพิ่มรายการสินค้าสำเร็จ',
      itemId: insertRes.rows[0].id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /app/inventory/:id - แก้ไขข้อมูล Item + อัปเดตรูปภาพ
 */
async function updateItem(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const parseResult = itemSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: formatZodErrors(parseResult.error) });
    }

    const data = parseResult.data;

    const existingRes = await pool.query('SELECT id, image_file_id FROM items WHERE id = $1', [itemId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการสินค้าที่ต้องการแก้ไข' });
    }

    const dupRes = await pool.query('SELECT 1 FROM items WHERE item_code = $1 AND id <> $2', [data.item_code, itemId]);
    if (dupRes.rows.length > 0) {
      return res.status(400).json({ error: 'รหัสสินค้านี้ซ้ำกับรายการอื่น' });
    }

    let imageFileId = existingRes.rows[0].image_file_id;
    if (req.file) {
      const fileRes = await pool.query(
        `INSERT INTO files (original_name, stored_name, mime_type, size_bytes, uploaded_by, ref_type, ref_id)
         VALUES ($1, $2, $3, $4, $5, 'item', $6)
         RETURNING id`,
        [req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.session.userId, itemId]
      );
      imageFileId = fileRes.rows[0].id;
    }

    await pool.query(
      `UPDATE items 
       SET item_code = $1, name = $2, category = $3, base_unit = $4, alt_unit = $5,
           unit_factor = $6, reorder_point = $7, unit_cost = $8, storage_note = $9, image_file_id = $10
       WHERE id = $11`,
      [
        data.item_code, data.name, data.category, data.base_unit,
        data.alt_unit || null, data.unit_factor || null, data.reorder_point,
        data.unit_cost || null, data.storage_note || null, imageFileId, itemId
      ]
    );

    res.json({ success: true, message: 'บันทึกการแก้ไขสินค้าเรียบร้อยแล้ว' });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /app/inventory/:id - ลบหรือปิดใช้งาน Item
 */
async function deleteItem(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const itemRes = await pool.query('SELECT id, is_active FROM items WHERE id = $1', [itemId]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการสินค้า' });
    }

    const item = itemRes.rows[0];
    const txCheck = await pool.query('SELECT 1 FROM stock_transactions WHERE item_id = $1 LIMIT 1', [itemId]);

    if (txCheck.rows.length > 0) {
      const newStatus = !item.is_active;
      await pool.query('UPDATE items SET is_active = $1 WHERE id = $2', [newStatus, itemId]);
      return res.json({
        success: true,
        action: newStatus ? 'activated' : 'deactivated',
        isActive: newStatus,
        message: newStatus 
          ? 'เปิดใช้งานรายการสินค้านี้เรียบร้อยแล้ว' 
          : 'ปิดการใช้งาน (ระงับ) รายการสินค้านี้เรียบร้อยแล้ว',
      });
    }

    await pool.query('DELETE FROM inventory_batches WHERE item_id = $1', [itemId]);
    await pool.query('DELETE FROM items WHERE id = $1', [itemId]);

    res.json({
      success: true,
      action: 'deleted',
      message: 'ลบรายการสินค้าเรียบร้อยแล้ว',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /app/inventory/:id/toggle-status - สลับสถานะเปิด/ปิดใช้งานโดยตรง
 */
async function toggleItemStatus(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const itemRes = await pool.query('SELECT id, is_active FROM items WHERE id = $1', [itemId]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการสินค้า' });
    }

    const newStatus = !itemRes.rows[0].is_active;
    await pool.query('UPDATE items SET is_active = $1 WHERE id = $2', [newStatus, itemId]);

    res.json({
      success: true,
      isActive: newStatus,
      message: newStatus ? 'เปิดใช้งานรายการสินค้านี้เรียบร้อยแล้ว' : 'ปิดการใช้งานสินค้านี้เรียบร้อยแล้ว',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /app/inventory/:id/receive - รับเข้า
 */
async function receiveStock(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const parseResult = receiveSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: formatZodErrors(parseResult.error) });
    }

    const data = parseResult.data;
    const userId = req.session.userId;

    const result = await inventoryService.receiveStock({
      itemId,
      lotNo: data.lot_no,
      mfgDate: data.mfg_date || null,
      expDate: data.exp_date || null,
      receivedDate: data.received_date || null,
      qty: data.qty,
      supplier: data.supplier || null,
      note: data.note || null,
      userId,
    });

    res.status(201).json({
      success: true,
      message: `รับเข้าสต็อกสำเร็จ จำนวน ${data.qty} หน่วย`,
      batchId: result.batchId,
      balanceAfter: result.balanceAfter,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /app/inventory/:id/issue - จ่ายออก (FEFO/FIFO)
 */
async function issueStock(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const parseResult = issueSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: formatZodErrors(parseResult.error) });
    }

    const { qty, note } = parseResult.data;
    const userId = req.session.userId;

    const result = await inventoryService.issueStock(itemId, qty, userId, note);

    res.json({
      success: true,
      message: `ตัดจ่ายสต็อกสำเร็จ (${result.strategyUsed}) จำนวนรวม ${qty} ${result.item.baseUnit}`,
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /app/inventory/:id/adjust - ปรับยอดตรวจนับ
 */
async function adjustStock(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const parseResult = adjustSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: formatZodErrors(parseResult.error) });
    }

    const { batch_id, new_qty, reason } = parseResult.data;
    const userId = req.session.userId;

    const result = await inventoryService.adjustStock({
      itemId,
      batchId: batch_id,
      newQty: new_qty,
      reason,
      userId,
    });

    res.json({
      success: true,
      message: 'ปรับปรุงยอดตรวจนับเรียบร้อยแล้ว',
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /app/inventory/:id/dispose - บันทึกทำลายสินค้าหมดอายุ
 */
async function disposeStock(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    const parseResult = disposeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: formatZodErrors(parseResult.error) });
    }

    const { batch_id, qty, reason, disposal_method, witness_name, note } = parseResult.data;
    const userId = req.session.userId;

    const result = await inventoryService.disposeStock({
      itemId,
      batchId: batch_id,
      qty,
      reason,
      disposalMethod: disposal_method,
      witnessName: witness_name,
      note,
      userId,
    });

    res.json({
      success: true,
      message: `บันทึกการทำลายสินค้าหมดอายุจำนวน ${result.disposedQty} เรียบร้อยแล้ว (สถานะ: ทำลายแล้ว)`,
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /app/inventory/:id/request - ยื่นคำขอเบิกวัสดุ/ยา/เวชภัณฑ์
 */
async function submitRequisition(req, res, next) {
  try {
    const itemId = parseInt(req.params.id);
    const { house_id, qty, reason } = req.body;
    const requesterId = req.session.userId;

    if (!house_id || !qty || parseInt(qty) <= 0) {
      return res.status(400).json({ error: 'กรุณาระบุโรงเรือนและจำนวนที่ต้องการเบิกให้ถูกต้อง' });
    }

    // ตรวจสอบสินค้าและสต็อกพร้อมใช้
    const itemCheck = await pool.query(
      `SELECT i.name, i.base_unit, i.is_active, COALESCE(v.total_usable_stock, 0) as total_usable_stock
       FROM items i
       LEFT JOIN v_item_stock v ON i.id = v.id
       WHERE i.id = $1`,
      [itemId]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการสินค้า' });
    }

    const item = itemCheck.rows[0];
    if (!item.is_active) {
      return res.status(400).json({ error: 'สินค้านี้ถูกปิดใช้งานอยู่ ไม่สามารถยื่นขอเบิกได้' });
    }

    const requestQty = parseFloat(qty);
    if (isNaN(requestQty) || requestQty <= 0) {
      return res.status(400).json({ error: 'กรุณาระบุจำนวนที่ต้องการเบิกให้ถูกต้อง' });
    }

    // ตรวจสอบกติกาหน่วยนับ (เช่น ขวดห้ามมีจุดทศนิยม)
    const unitValidation = validateUnitQuantity(requestQty, item.base_unit);
    if (!unitValidation.valid) {
      return res.status(400).json({ error: unitValidation.message });
    }

    const usableStock = parseFloat(item.total_usable_stock);

    if (requestQty > usableStock) {
      return res.status(400).json({
        error: `ของในสต็อกไม่เพียงพอ (ต้องการเบิก: ${requestQty.toLocaleString()} ${item.base_unit}, มีพร้อมใช้: ${usableStock.toLocaleString()} ${item.base_unit})`
      });
    }

    // บันทึกลง supply_requests
    const insertRes = await pool.query(
      `INSERT INTO supply_requests (requester_id, house_id, item_id, qty, reason, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, created_at`,
      [requesterId, parseInt(house_id), itemId, requestQty, reason ? reason.trim() : '']
    );

    res.json({
      success: true,
      message: `ยื่นคำขอเบิก "${itemCheck.rows[0].name}" จำนวน ${requestQty} ${item.base_unit} เรียบร้อยแล้ว (สถานะ: รออนุมัติ)`,
      requestId: insertRes.rows[0].id
    });
  } catch (err) {
    console.error('Submit requisition error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการยื่นคำขอเบิก' });
  }
}

module.exports = {
  renderInventoryPage,
  renderItemDetailPage,
  getInventorySummary,
  createItem,
  updateItem,
  deleteItem,
  toggleItemStatus,
  receiveStock,
  issueStock,
  adjustStock,
  disposeStock,
  submitRequisition,
};
