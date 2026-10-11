// Routes สำหรับระบบคลังวัสดุและเวชภัณฑ์ (Inventory Routes)
const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { requireLogin } = require('../middleware/auth');
const { aclGuard, registerEndpoint } = require('../middleware/aclGuard');
const auditLogger = require('../middleware/auditLogger');

// ลงทะเบียน Endpoints ใน Endpoint Registry เพื่อให้ตรวจสอบและผูกสิทธิ์ได้
registerEndpoint('GET', '^/app/inventory$', 'ดูภาพรวมสต็อกคลังวัสดุและเวชภัณฑ์');
registerEndpoint('GET', '^/app/inventory/[0-9]+$', 'ดูรายละเอียดสินค้า ล็อต และประวัติการทำรายการ');
registerEndpoint('GET', '^/api/inventory/summary$', 'ดูข้อมูลสรุปสต็อกสำหรับแดชบอร์ด (JSON)');
registerEndpoint('POST', '^/app/inventory$', 'เพิ่มรายการวัสดุ/เวชภัณฑ์ใหม่');
registerEndpoint('PUT', '^/app/inventory/[0-9]+$', 'แก้ไขข้อมูลวัสดุ/เวชภัณฑ์');
registerEndpoint('DELETE', '^/app/inventory/[0-9]+$', 'ลบหรือปิดการใช้งานวัสดุ/เวชภัณฑ์');
registerEndpoint('POST', '^/app/inventory/[0-9]+/toggle-status$', 'เปิดหรือปิดการใช้งานวัสดุ/เวชภัณฑ์');
registerEndpoint('POST', '^/app/inventory/[0-9]+/receive$', 'รับวัสดุ/เวชภัณฑ์เข้าคลัง (สร้างล็อต)');
registerEndpoint('POST', '^/app/inventory/[0-9]+/issue$', 'จ่ายวัสดุ/เวชภัณฑ์ออกจากคลัง (FEFO/FIFO)');
registerEndpoint('POST', '^/app/inventory/[0-9]+/adjust$', 'ปรับปรุงยอดสต็อกตรวจนับ');
registerEndpoint('POST', '^/app/inventory/[0-9]+/request$', 'ยื่นคำขอเบิกวัสดุ/ยา/เวชภัณฑ์');
registerEndpoint('GET', '^/app/requests$', 'ดูรายการคำขอเบิก');
registerEndpoint('POST', '^/app/requests/[0-9]+/approve$', 'อนุมัติคำขอเบิก');
registerEndpoint('POST', '^/app/requests/[0-9]+/reject$', 'ปฏิเสธคำขอเบิก');
registerEndpoint('POST', '^/app/requests/[0-9]+/dispense$', 'จ่ายวัสดุตามใบเบิก');
registerEndpoint('POST', '^/app/requests/[0-9]+/cancel$', 'ยกเลิกคำขอเบิก');

// ========== หน้า Web Views ==========
// 1. ภาพรวมสต็อก
router.get(
  '/app/inventory',
  requireLogin,
  aclGuard,
  auditLogger('inventory.read', 'inventory'),
  inventoryController.renderInventoryPage
);

// 2. หน้ารายละเอียด + ล็อต + ประวัติ
router.get(
  '/app/inventory/:id',
  requireLogin,
  aclGuard,
  auditLogger('inventory.read', 'inventory'),
  inventoryController.renderItemDetailPage
);

// ========== API Endpoints ==========
// 3. API สรุปสำหรับแดชบอร์ด (JSON)
router.get(
  '/api/inventory/summary',
  requireLogin,
  aclGuard,
  auditLogger('inventory.read', 'inventory'),
  inventoryController.getInventorySummary
);

const upload = require('../middleware/upload');

// Route เสิร์ฟไฟล์รูปภาพสินค้า
router.get('/uploads/:filename', requireLogin, (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const filePath = path.join(__dirname, '..', 'uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Not Found');
  }
});

// 4. เพิ่มรายการใหม่ (รองรับอัปโหลดรูปภาพ)
router.post(
  '/app/inventory',
  requireLogin,
  aclGuard,
  upload.single('image'),
  auditLogger('inventory.create', 'inventory'),
  inventoryController.createItem
);

// 5. แก้ไขรายการ (รองรับอัปโหลดรูปภาพ)
router.put(
  '/app/inventory/:id',
  requireLogin,
  aclGuard,
  upload.single('image'),
  auditLogger('inventory.update', 'inventory'),
  inventoryController.updateItem
);

// 6. ลบหรือปิดใช้งาน
router.delete(
  '/app/inventory/:id',
  requireLogin,
  aclGuard,
  auditLogger('inventory.delete', 'inventory'),
  inventoryController.deleteItem
);

// 6.1 เปิดหรือปิดการใช้งาน (Toggle Active Status)
router.post(
  '/app/inventory/:id/toggle-status',
  requireLogin,
  aclGuard,
  auditLogger('inventory.update', 'inventory'),
  inventoryController.toggleItemStatus
);

// 7. รับเข้าคลัง (Receive)
router.post(
  '/app/inventory/:id/receive',
  requireLogin,
  aclGuard,
  auditLogger('inventory.receive', 'inventory'),
  inventoryController.receiveStock
);

// 8. จ่ายออกจากคลัง (Issue - FEFO / FIFO)
router.post(
  '/app/inventory/:id/issue',
  requireLogin,
  aclGuard,
  auditLogger('inventory.issue', 'inventory'),
  inventoryController.issueStock
);

// 9. ปรับยอดสต็อกตรวจนับ (Adjust)
router.post(
  '/app/inventory/:id/adjust',
  requireLogin,
  aclGuard,
  auditLogger('inventory.adjust', 'inventory'),
  inventoryController.adjustStock
);

// 10. ทำลายสินค้าหมดอายุ (Dispose)
router.post(
  '/app/inventory/:id/dispose',
  requireLogin,
  aclGuard,
  auditLogger('inventory.dispose', 'inventory'),
  inventoryController.disposeStock
);

// 11. ยื่นคำขอเบิก (Requisition)
router.post(
  '/app/inventory/:id/request',
  requireLogin,
  aclGuard,
  auditLogger('request.create', 'request'),
  inventoryController.submitRequisition
);

// ========== จัดการคำขอเบิก (Requests Management) ==========
const requestController = require('../controllers/requestController');

router.get(
  '/app/requests',
  requireLogin,
  aclGuard,
  auditLogger('request.read', 'request'),
  requestController.renderRequestsPage
);

router.post(
  '/app/requests/:id/approve',
  requireLogin,
  aclGuard,
  auditLogger('request.approve', 'request'),
  requestController.approveRequest
);

router.post(
  '/app/requests/:id/reject',
  requireLogin,
  aclGuard,
  auditLogger('request.reject', 'request'),
  requestController.rejectRequest
);

router.post(
  '/app/requests/:id/dispense',
  requireLogin,
  aclGuard,
  auditLogger('request.dispense', 'request'),
  requestController.dispenseRequest
);

router.post(
  '/app/requests/:id/cancel',
  requireLogin,
  aclGuard,
  auditLogger('request.cancel', 'request'),
  requestController.cancelRequest
);

module.exports = router;
