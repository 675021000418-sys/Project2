// ACL Guard - ตรวจสิทธิ์จาก role_permissions ใน PostgreSQL
const pool = require('../config/database');

// Endpoint Registry - ลงทะเบียน endpoints ที่รองรับ
const endpointRegistry = new Map();

// ฟังก์ชันลงทะเบียน endpoint
const registerEndpoint = (method, pathPattern, description) => {
  const key = `${method.toUpperCase()}:${pathPattern}`;
  endpointRegistry.set(key, { method, pathPattern, description });
};

// ฟังก์ชันดึง registry ทั้งหมด
const getEndpointRegistry = () => {
  return Array.from(endpointRegistry.values());
};


// Guard หลัก - ตรวจสิทธิ์จาก endpoint_permissions ใน DB
const aclGuard = async (req, res, next) => {
  try {
    // Admin ผ่านทุกอย่าง
    if (req.session && req.session.role === 'admin') {
      return next();
    }

    if (!req.session || !req.session.roleId) {
      return res.status(401).json({ error: 'ต้องล็อกอินก่อน' });
    }

    // ตรวจสอบว่า endpoint นี้ผูกกับ permission ไว้หรือไม่
    const method = req.method.toUpperCase();
    const path = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;

    const result = await pool.query(
      `SELECT ep.permission_id, p.key as permission_key
       FROM endpoint_permissions ep
       JOIN permissions p ON ep.permission_id = p.id
       WHERE ep.method = $1 AND $2 ~ ep.path_pattern
       LIMIT 1`,
      [method, path]
    );

    if (result.rows.length === 0) {
      // Endpoint ยังไม่ผูก permission - deny by default
      return res.status(403).json({ error: 'Endpoint นี้ยังไม่ได้ผูกกับ Permission' });
    }

    const permissionId = result.rows[0].permission_id;

    // ตรวจสอบว่า user มี permission นี้หรือไม่
    const permissionResult = await pool.query(
      `SELECT 1 FROM role_permissions
       WHERE role_id = $1 AND permission_id = $2`,
      [req.session.roleId, permissionId]
    );

    if (permissionResult.rows.length === 0) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });
    }

    next();
  } catch (err) {
    console.error('ACL Guard error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการตรวจสิทธิ์' });
  }
};

// Guard แบบตรวจ permission key โดยตรง (สำหรับกรณีพิเศษ)
const requirePermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      // Admin ผ่านทุกอย่าง
      if (req.session && req.session.role === 'admin') {
        return next();
      }

      if (!req.session || !req.session.roleId) {
        return res.status(401).json({ error: 'ต้องล็อกอินก่อน' });
      }

      const result = await pool.query(
        `SELECT rp.role_id
         FROM role_permissions rp
         JOIN permissions p ON rp.permission_id = p.id
         WHERE rp.role_id = $1 AND p.key = $2`,
        [req.session.roleId, permissionKey]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });
      }

      next();
    } catch (err) {
      console.error('Require permission error:', err);
      res.status(500).json({ error: 'เกิดข้อผิดพลาดในการตรวจสิทธิ์' });
    }
  };
};

module.exports = {
  aclGuard,
  requirePermission,
  registerEndpoint,
  getEndpointRegistry,
};

