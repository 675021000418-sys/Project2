// Middleware สำหรับ Authentication
const pool = require('../config/database');

// ตรวจสอบการล็อกอิน
const requireLogin = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'ต้องล็อกอินก่อน' });
    }
    return res.redirect('/login');
  }
  next();
};

// ตรวจสอบสิทธิ์ Admin โดยเฉพาะ (สำหรับหน้า Admin)
const requireAdmin = (req, res, next) => {
  if (!req.session || req.session.role !== 'admin') {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง (สำหรับ Admin เท่านั้น)' });
    }
    return res.status(403).render('error', { 
      status: 403,
      error: 'ไม่มีสิทธิ์เข้าถึง (สำหรับ Admin เท่านั้น)' 
    });
  }
  next();
};

// สร้าง request context (user, clientIp) พร้อมคำนวณสิทธิ์ res.locals.can
const requestContext = async (req, res, next) => {
  req.user = (req.session && req.session.userId) ? {
    id: req.session.userId,
    username: req.session.username,
    role: req.session.role,
    roleId: req.session.roleId,
  } : null;

  const forwarded = req.headers['x-forwarded-for'];
  req.clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.socket?.remoteAddress || req.ip || '127.0.0.1';

  // ค่าตั้งต้นสำหรับ View
  res.locals.currentUser = req.user;
  res.locals.fullName = req.session?.fullName || '';
  res.locals.role = req.session?.role || '';
  res.locals.can = (permissionKey) => false;
  res.locals.permissions = [];

  if (req.user) {
    if (req.user.role === 'admin') {
      res.locals.can = (permissionKey) => true; // Admin ทำได้ทุกอย่าง
    } else if (req.user.roleId) {
      try {
        const permRes = await pool.query(
          `SELECT p.key 
           FROM role_permissions rp
           JOIN permissions p ON rp.permission_id = p.id
           WHERE rp.role_id = $1`,
          [req.user.roleId]
        );
        const permKeys = new Set(permRes.rows.map(r => r.key));
        res.locals.permissions = Array.from(permKeys);
        res.locals.can = (permissionKey) => permKeys.has(permissionKey);
      } catch (err) {
        console.error('โหลดสิทธิ์ผู้ใช้ล้มเหลว:', err);
      }
    }
  }

  next();
};

module.exports = {
  requireLogin,
  requireAdmin,
  requestContext,
};

