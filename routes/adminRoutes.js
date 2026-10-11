// Routes สำหรับ Admin
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { aclGuard } = require('../middleware/aclGuard');
const auditLogger = require('../middleware/auditLogger');
const { registerEndpoint } = require('../middleware/aclGuard');

// ลงทะเบียน endpoints
registerEndpoint('GET', '/api/admin/roles', 'ดูรายการ Roles');
registerEndpoint('POST', '/api/admin/roles', 'เพิ่ม Role ใหม่');
registerEndpoint('PUT', '/api/admin/roles/:id', 'แก้ไข Role');
registerEndpoint('DELETE', '/api/admin/roles/:id', 'ลบ Role');
registerEndpoint('POST', '/api/admin/users/role', 'เปลี่ยน Role ของ User');

registerEndpoint('GET', '/api/admin/permissions', 'ดูรายการ Permissions');
registerEndpoint('POST', '/api/admin/permissions', 'เพิ่ม Permission ใหม่');
registerEndpoint('PUT', '/api/admin/permissions/:id', 'แก้ไข Permission');
registerEndpoint('DELETE', '/api/admin/permissions/:id', 'ลบ Permission');

registerEndpoint('GET', '/api/admin/acl', 'ดู ACL Matrix');
registerEndpoint('POST', '/api/admin/acl', 'อัปเดต ACL');

registerEndpoint('GET', '/api/admin/endpoints', 'ดู Endpoint Registry');
registerEndpoint('GET', '/api/admin/endpoint-permissions', 'ดู Endpoint Permissions');
registerEndpoint('POST', '/api/admin/endpoint-permissions', 'ผูก Permission กับ Endpoint');
registerEndpoint('DELETE', '/api/admin/endpoint-permissions/:id', 'ลบ Endpoint Permission');

registerEndpoint('GET', '/api/admin/users', 'ดูรายการ Users');
registerEndpoint('POST', '/api/admin/users', 'เพิ่ม User ใหม่');
registerEndpoint('PUT', '/api/admin/users/:id', 'แก้ไข User');
registerEndpoint('DELETE', '/api/admin/users/:id', 'ลบ User');

registerEndpoint('GET', '/api/admin/logs', 'ดู Audit Logs');

registerEndpoint('GET', '/api/admin/stats', 'ดูสถิติ Dashboard');

// Middleware ตรวจสอบการเข้าถึงหน้า Admin View แต่ละหน้า
const requireAdminPage = (permissionKey) => (req, res, next) => {
  if (req.session?.role === 'admin') {
    return next();
  }
  const can = res.locals.can || ((p) => false);
  // หน้า dashboard รวม: เข้าได้ถ้ามีสิทธิ์ admin อย่างน้อย 1 สิทธิ์
  if (!permissionKey) {
    const adminPerms = ['acl.manage', 'endpoint.manage', 'user.read', 'role.read', 'permission.read', 'log.view'];
    if (adminPerms.some(p => can(p))) {
      return next();
    }
  } else if (can(permissionKey)) {
    return next();
  }

  return res.status(403).render('error', {
    status: 403,
    error: 'ไม่มีสิทธิ์เข้าถึงหน้านี้ (ต้องการสิทธิ์ ' + (permissionKey || 'ผู้ดูแลระบบ') + ')'
  });
};

// Helper สำหรับ render หน้า Admin
const renderAdminView = (viewName, pageTitle, activeMenu) => (req, res) => {
  res.render(viewName, {
    pageTitle,
    fullName: req.session.fullName,
    role: req.session.role,
    activeMenu,
    can: res.locals.can || ((perm) => req.session?.role === 'admin'),
    permissions: res.locals.permissions || [],
  });
};

// หน้า Admin แยก Route (ตรวจสิทธิ์ตาม permissionKey หรือ role admin)
router.get(['/admin/dashboard', '/admin'], requireLogin, requireAdminPage(), renderAdminView('admin/dashboard', 'Dashboard', 'dashboard'));
router.get(['/admin/users', '/users'], requireLogin, requireAdminPage('user.read'), renderAdminView('admin/users', 'ผู้ใช้', 'users'));
router.get(['/admin/roles', '/roles'], requireLogin, requireAdminPage('role.read'), renderAdminView('admin/roles', 'Roles', 'roles'));
router.get(['/admin/permissions', '/permissions'], requireLogin, requireAdminPage('permission.read'), renderAdminView('admin/permissions', 'Permissions', 'permissions'));
router.get(['/admin/acl', '/acl'], requireLogin, requireAdminPage('acl.manage'), renderAdminView('admin/acl', 'ACL', 'acl'));
router.get(['/admin/endpoints', '/endpoints'], requireLogin, requireAdminPage('endpoint.manage'), renderAdminView('admin/endpoints', 'Endpoints', 'endpoints'));
router.get(['/admin/logs', '/logs'], requireLogin, requireAdminPage('log.view'), renderAdminView('admin/logs', 'Audit Logs', 'logs'));


// ========== Dashboard Stats API ==========
router.get('/api/admin/stats', requireLogin, aclGuard, adminController.getDashboardStats);

// ========== Roles API ==========
router.get('/api/admin/roles', requireLogin, aclGuard, auditLogger('role.read'), adminController.getRoles);
router.post('/api/admin/roles', requireLogin, aclGuard, auditLogger('role.create'), adminController.createRole);
router.put('/api/admin/roles/:id', requireLogin, aclGuard, auditLogger('role.update'), adminController.updateRole);
router.delete('/api/admin/roles/:id', requireLogin, aclGuard, auditLogger('role.delete'), adminController.deleteRole);
router.post('/api/admin/users/role', requireLogin, aclGuard, auditLogger('user.update'), adminController.changeUserRole);

// ========== Permissions API ==========
router.get('/api/admin/permissions', requireLogin, aclGuard, auditLogger('permission.read'), adminController.getPermissions);
router.post('/api/admin/permissions', requireLogin, aclGuard, auditLogger('permission.create'), adminController.createPermission);
router.put('/api/admin/permissions/:id', requireLogin, aclGuard, auditLogger('permission.update'), adminController.updatePermission);
router.delete('/api/admin/permissions/:id', requireLogin, aclGuard, auditLogger('permission.delete'), adminController.deletePermission);

// ========== ACL API ==========
router.get('/api/admin/acl', requireLogin, aclGuard, auditLogger('acl.manage'), adminController.getACL);
router.post('/api/admin/acl', requireLogin, aclGuard, auditLogger('acl.manage'), adminController.updateACL);

// ========== Endpoint Permissions API ==========
router.get('/api/admin/endpoints', requireLogin, aclGuard, adminController.getEndpointRegistry);
router.get('/api/admin/endpoint-permissions', requireLogin, aclGuard, auditLogger('endpoint.manage'), adminController.getEndpointPermissions);
router.post('/api/admin/endpoint-permissions', requireLogin, aclGuard, auditLogger('endpoint.manage'), adminController.createEndpointPermission);
router.delete('/api/admin/endpoint-permissions/:id', requireLogin, aclGuard, auditLogger('endpoint.manage'), adminController.deleteEndpointPermission);

// ========== Users API ==========
router.get('/api/admin/users', requireLogin, aclGuard, auditLogger('user.read'), adminController.getUsers);
router.post('/api/admin/users', requireLogin, aclGuard, auditLogger('user.create'), adminController.createUser);
router.put('/api/admin/users/:id', requireLogin, aclGuard, auditLogger('user.update'), adminController.updateUser);
router.delete('/api/admin/users/:id', requireLogin, aclGuard, auditLogger('user.delete'), adminController.deleteUser);

// ========== Audit Logs API ==========
router.get('/api/admin/logs', requireLogin, aclGuard, auditLogger('log.view'), adminController.getAuditLogs);

module.exports = router;
