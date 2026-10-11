// Controller สำหรับคำขอเบิก (Request Controller)
const pool = require('../config/database');
const inventoryService = require('../services/inventoryService');

/**
 * GET /app/requests - หน้าดูรายการคำขอเบิกทั้งหมด
 */
async function renderRequestsPage(req, res, next) {
  try {
    const userId = req.session.userId;
    const userRole = req.session.role;
    const canApprove = req.session.role === 'admin' || (res.locals.can && (res.locals.can('request.approve') || res.locals.can('request.dispense')));

    let query = `
      SELECT sr.*, 
             u.full_name as requester_name, u.username as requester_username,
             h.name as house_name, h.animal_type,
             i.item_code, i.name as item_name, i.base_unit,
             app_u.full_name as approver_name,
             disp_u.full_name as dispenser_name
      FROM supply_requests sr
      JOIN users u ON sr.requester_id = u.id
      JOIN houses h ON sr.house_id = h.id
      JOIN items i ON sr.item_id = i.id
      LEFT JOIN users app_u ON sr.approved_by = app_u.id
      LEFT JOIN users disp_u ON sr.dispensed_by = disp_u.id
    `;
    const params = [];

    // ถ้าเป็นคนงานทั่วไป ให้เห็นเฉพาะคำขอเบิกของตัวเอง
    if (!canApprove) {
      query += ` WHERE sr.requester_id = $1`;
      params.push(userId);
    }

    query += ` ORDER BY sr.created_at DESC`;

    const result = await pool.query(query, params);

    res.render('requests/index', {
      pageTitle: 'รายการคำขอเบิกพัสดุและเวชภัณฑ์',
      requests: result.rows,
      canApprove,
      userId,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /app/requests/:id/approve - อนุมัติคำขอเบิก
 */
async function approveRequest(req, res, next) {
  try {
    const requestId = parseInt(req.params.id);
    const approverId = req.session.userId;
    const { note } = req.body;

    const reqCheck = await pool.query(
      `SELECT sr.*, i.name as item_name, i.base_unit, COALESCE(v.total_usable_stock, 0) as total_usable_stock
       FROM supply_requests sr
       JOIN items i ON sr.item_id = i.id
       LEFT JOIN v_item_stock v ON i.id = v.id
       WHERE sr.id = $1`,
      [requestId]
    );
    if (reqCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการคำขอเบิก' });
    }

    const currentReq = reqCheck.rows[0];
    if (currentReq.status !== 'pending') {
      return res.status(400).json({ error: `ไม่สามารถอนุมัติได้เนื่องจากสถานะปัจจุบันคือ ${currentReq.status}` });
    }

    const requestedQty = parseFloat(currentReq.qty);
    const usableStock = parseFloat(currentReq.total_usable_stock);

    if (requestedQty > usableStock) {
      return res.status(400).json({
        error: `ของในสต็อกไม่เพียงพอสำหรับการอนุมัติ (ขอเบิก: ${requestedQty.toLocaleString()} ${currentReq.base_unit}, มีพร้อมใช้: ${usableStock.toLocaleString()} ${currentReq.base_unit})`
      });
    }

    // ตัดสต็อกคลังทันทีตาม FEFO/FIFO เมื่อได้รับการอนุมัติ
    const noteText = `ตัดสต็อกอัตโนมัติจากการอนุมัติใบเบิก #${currentReq.id} (โรงเรือน ${currentReq.house_id})`;
    const issueResult = await inventoryService.issueStock(
      currentReq.item_id,
      requestedQty,
      approverId,
      noteText
    );

    // อัปเดตสถานะเป็น dispensed (หรืออนุมัติและตัดจ่ายของเรียบร้อย)
    await pool.query(
      `UPDATE supply_requests 
       SET status = 'dispensed', approved_by = $1, dispensed_by = $1, approve_note = $2, updated_at = NOW() 
       WHERE id = $3`,
      [approverId, note ? note.trim() : null, requestId]
    );

    res.json({
      success: true,
      message: `อนุมัติคำขอเบิกและตัดสต็อกสินค้า "${currentReq.item_name}" จำนวน ${requestedQty} ${currentReq.base_unit} เรียบร้อยแล้ว`,
      data: issueResult
    });
  } catch (err) {
    console.error('Approve and deduct error:', err);
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาดในการอนุมัติและตัดสต็อก' });
  }
}

/**
 * POST /app/requests/:id/reject - ปฏิเสธคำขอเบิก
 */
async function rejectRequest(req, res, next) {
  try {
    const requestId = parseInt(req.params.id);
    const rejectorId = req.session.userId;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'กรุณาระบุเหตุผลในการปฏิเสธ' });
    }

    const reqCheck = await pool.query('SELECT * FROM supply_requests WHERE id = $1', [requestId]);
    if (reqCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการคำขอเบิก' });
    }

    const currentReq = reqCheck.rows[0];
    if (currentReq.status !== 'pending') {
      return res.status(400).json({ error: `ไม่สามารถปฏิเสธได้เนื่องจากสถานะปัจจุบันคือ ${currentReq.status}` });
    }

    await pool.query(
      `UPDATE supply_requests 
       SET status = 'rejected', approved_by = $1, approve_note = $2, updated_at = NOW() 
       WHERE id = $3`,
      [rejectorId, note.trim(), requestId]
    );

    res.json({ success: true, message: 'ปฏิเสธคำขอเบิกเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการปฏิเสธคำขอ' });
  }
}

/**
 * POST /app/requests/:id/dispense - จ่ายของตามคำขอเบิก (ตัดสต็อกคลังจริง FEFO/FIFO)
 */
async function dispenseRequest(req, res, next) {
  try {
    const requestId = parseInt(req.params.id);
    const dispenserId = req.session.userId;

    const reqCheck = await pool.query(
      `SELECT sr.*, i.name as item_name 
       FROM supply_requests sr 
       JOIN items i ON sr.item_id = i.id 
       WHERE sr.id = $1`,
      [requestId]
    );
    if (reqCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการคำขอเบิก' });
    }

    const currentReq = reqCheck.rows[0];
    if (currentReq.status !== 'approved') {
      return res.status(400).json({ error: 'ต้องได้รับการอนุมัติก่อน จึงจะทำการจ่ายของได้' });
    }

    // ตัดสต็อกคลังตาม FEFO/FIFO: issueStock(itemId, requestedQty, userId, note)
    const noteText = `จ่ายตามใบเบิก #${currentReq.id} (โรงเรือน ${currentReq.house_id})`;
    const issueResult = await inventoryService.issueStock(
      currentReq.item_id,
      parseFloat(currentReq.qty),
      dispenserId,
      noteText
    );

    // อัปเดตสถานะเป็น dispensed
    await pool.query(
      `UPDATE supply_requests 
       SET status = 'dispensed', dispensed_by = $1, updated_at = NOW() 
       WHERE id = $2`,
      [dispenserId, requestId]
    );

    res.json({
      success: true,
      message: `จ่ายพัสดุ/ยาตามคำขอเบิก #${requestId} เรียบร้อยแล้ว (ตัดสต็อก ${currentReq.qty} หน่วย)`,
      deductions: issueResult.deductions,
    });
  } catch (err) {
    console.error('Dispense error:', err);
    res.status(err.status || 500).json({ error: err.message || 'เกิดข้อผิดพลาดในการจ่ายของ' });
  }
}

/**
 * POST /app/requests/:id/cancel - คนงานยกเลิกคำขอเบิกของตนเอง
 */
async function cancelRequest(req, res, next) {
  try {
    const requestId = parseInt(req.params.id);
    const userId = req.session.userId;

    const reqCheck = await pool.query('SELECT * FROM supply_requests WHERE id = $1', [requestId]);
    if (reqCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการคำขอเบิก' });
    }

    const currentReq = reqCheck.rows[0];
    if (currentReq.requester_id !== userId && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ยกเลิกคำขอของผู้อื่น' });
    }

    if (currentReq.status !== 'pending') {
      return res.status(400).json({ error: 'สามารถยกเลิกได้เฉพาะคำขอที่อยู่ในสถานะรออนุมัติเท่านั้น' });
    }

    await pool.query(
      `UPDATE supply_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [requestId]
    );

    res.json({ success: true, message: 'ยกเลิกคำขอเบิกเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการยกเลิก' });
  }
}

module.exports = {
  renderRequestsPage,
  approveRequest,
  rejectRequest,
  dispenseRequest,
  cancelRequest,
};
