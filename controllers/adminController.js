// Controller สำหรับ Admin - จัดการ Roles, Permissions, ACL
const pool = require('../config/database');

// ========== Roles ==========

// ดูรายการ Roles ทั้งหมด
const getRoles = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, 
              (SELECT COUNT(*) FROM users WHERE role_id = r.id) as user_count
       FROM roles r
       ORDER BY r.id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get roles error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// เพิ่ม Role ใหม่
const createRole = async (req, res) => {
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ Role' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO roles (name, description, is_system)
       VALUES ($1, $2, FALSE)
       RETURNING *`,
      [name.trim(), description || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'ชื่อ Role ซ้ำ' });
    }
    console.error('Create role error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// แก้ไข Role
const updateRole = async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ Role' });
  }

  try {
    // ตรวจสอบว่าเป็น system role หรือไม่
    const roleCheck = await pool.query(
      `SELECT is_system FROM roles WHERE id = $1`,
      [id]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบ Role' });
    }

    if (roleCheck.rows[0].is_system) {
      return res.status(403).json({ error: 'ไม่สามารถแก้ไข System Role ได้' });
    }

    const result = await pool.query(
      `UPDATE roles SET name = $1, description = $2 WHERE id = $3 RETURNING *`,
      [name.trim(), description || '', id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'ชื่อ Role ซ้ำ' });
    }
    console.error('Update role error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ลบ Role
const deleteRole = async (req, res) => {
  const { id } = req.params;

  try {
    // ตรวจสอบว่าเป็น system role หรือไม่
    const roleCheck = await pool.query(
      `SELECT is_system, name FROM roles WHERE id = $1`,
      [id]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบ Role' });
    }

    if (roleCheck.rows[0].is_system) {
      return res.status(403).json({ error: 'ไม่สามารถลบ System Role ได้' });
    }

    // ตรวจสอบว่ามีผู้ใช้ใช้ role นี้อยู่หรือไม่
    const userCheck = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE role_id = $1`,
      [id]
    );

    if (parseInt(userCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: 'ไม่สามารถลบ Role ที่มีผู้ใช้อยู่ได้' });
    }

    await pool.query('DELETE FROM roles WHERE id = $1', [id]);
    res.json({ message: 'ลบ Role สำเร็จ' });
  } catch (err) {
    console.error('Delete role error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// เปลี่ยน Role ของ User
const changeUserRole = async (req, res) => {
  const { userId, roleId } = req.body;

  try {
    const currentRole = await pool.query(
      `SELECT u.id, r.name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [userId]
    );

    if (currentRole.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    }

    // ตรวจสอบว่าจะไม่ทำให้ไม่มี admin เหลือ
    if (currentRole.rows[0].name === 'admin') {
      const adminCount = await pool.query(
        `SELECT COUNT(*) as count
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'admin' AND u.is_active = TRUE`
      );

      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'ต้องมี Admin อย่างน้อย 1 คน' });
      }
    }

    await pool.query(
      `UPDATE users SET role_id = $1 WHERE id = $2`,
      [roleId, userId]
    );

    res.json({ message: 'เปลี่ยน Role สำเร็จ' });
  } catch (err) {
    console.error('Change user role error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ========== Permissions ==========

// ดูรายการ Permissions ทั้งหมด
const getPermissions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM permissions ORDER BY module, key`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get permissions error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// เพิ่ม Permission ใหม่
const createPermission = async (req, res) => {
  const { key, description, module } = req.body;

  if (!key || !module) {
    return res.status(400).json({ error: 'กรุณากรอก Permission Key และ Module' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO permissions (key, description, module)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [key.trim(), description || '', module.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Permission Key ซ้ำ' });
    }
    console.error('Create permission error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// แก้ไข Permission
const updatePermission = async (req, res) => {
  const { id } = req.params;
  const { description } = req.body;

  try {
    const result = await pool.query(
      `UPDATE permissions SET description = $1 WHERE id = $2 RETURNING *`,
      [description || '', id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบ Permission' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update permission error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ลบ Permission
const deletePermission = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM permissions WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบ Permission' });
    }
    res.json({ message: 'ลบ Permission สำเร็จ' });
  } catch (err) {
    console.error('Delete permission error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ========== ACL (Role-Permission) ==========

// ดู ACL Matrix (Role × Permission)
const getACL = async (req, res) => {
  try {
    const roles = await pool.query('SELECT * FROM roles ORDER BY id');
    const permissions = await pool.query('SELECT * FROM permissions ORDER BY module, key');
    
    const acl = await pool.query(
      `SELECT role_id, permission_id FROM role_permissions`
    );

    const aclMap = {};
    acl.rows.forEach(row => {
      const key = `${row.role_id}-${row.permission_id}`;
      aclMap[key] = true;
    });

    res.json({
      roles: roles.rows,
      permissions: permissions.rows,
      acl: aclMap,
    });
  } catch (err) {
    console.error('Get ACL error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// อัปเดต ACL
const updateACL = async (req, res) => {
  const { roleId, permissionId, hasPermission } = req.body;

  try {
    // ห้ามลดสิทธิ์ Admin
    const roleCheck = await pool.query(
      `SELECT name FROM roles WHERE id = $1`,
      [roleId]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบ Role' });
    }

    if (roleCheck.rows[0].name === 'admin' && !hasPermission) {
      return res.status(403).json({ error: 'ไม่สามารถลดสิทธิ์ Admin ได้' });
    }

    if (hasPermission) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [roleId, permissionId]
      );
    } else {
      await pool.query(
        `DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2`,
        [roleId, permissionId]
      );
    }

    res.json({ message: 'อัปเดต ACL สำเร็จ' });
  } catch (err) {
    console.error('Update ACL error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ========== Endpoint Permissions ==========

// ดู Endpoint Registry ทั้งหมด
const getEndpointRegistry = async (req, res) => {
  const { getEndpointRegistry: getRegistry } = require('../middleware/aclGuard');
  res.json(getRegistry());
};

// ดู Endpoint Permissions ทั้งหมด
const getEndpointPermissions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ep.*, p.key as permission_key, p.description as permission_description
       FROM endpoint_permissions ep
       JOIN permissions p ON ep.permission_id = p.id
       ORDER BY ep.method, ep.path_pattern`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get endpoint permissions error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ผูก Permission กับ Endpoint
const createEndpointPermission = async (req, res) => {
  const { method, pathPattern, permissionId } = req.body;

  if (!method || !pathPattern || !permissionId) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO endpoint_permissions (method, path_pattern, permission_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [method.toUpperCase(), pathPattern.trim(), permissionId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Endpoint นี้ผูก Permission อยู่แล้ว' });
    }
    console.error('Create endpoint permission error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ลบ Endpoint Permission
const deleteEndpointPermission = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM endpoint_permissions WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบ Endpoint Permission' });
    }
    res.json({ message: 'ลบ Endpoint Permission สำเร็จ' });
  } catch (err) {
    console.error('Delete endpoint permission error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ========== Users ==========

// ดูรายการ Users ทั้งหมด
const getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.created_at,
              r.name as role_name, r.id as role_id
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       ORDER BY u.id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// เพิ่ม User ใหม่
const createUser = async (req, res) => {
  const { username, email, password, full_name, roleId } = req.body;
  const bcrypt = require('bcrypt');

  if (!username || !email || !password || !full_name) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, is_active`,
      [username.trim(), email.trim().toLowerCase(), passwordHash, full_name.trim(), roleId ? parseInt(roleId) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'ชื่อผู้ใช้หรืออีเมลซ้ำ' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// แก้ไข User
const updateUser = async (req, res) => {
  const { id } = req.params;
  const { email, full_name, roleId, is_active } = req.body;

  try {
    const userCheck = await pool.query(
      `SELECT u.id, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    }

    const user = userCheck.rows[0];
    if (user.role_name === 'admin' && (is_active === false || is_active === 'false')) {
      const adminCount = await pool.query(
        `SELECT COUNT(*) as count
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'admin' AND u.is_active = TRUE AND u.id != $1`,
        [id]
      );
      if (parseInt(adminCount.rows[0].count) === 0) {
        return res.status(400).json({ error: 'ต้องมี Admin ที่เปิดใช้งานอย่างน้อย 1 คน' });
      }
    }

    const result = await pool.query(
      `UPDATE users
       SET email = COALESCE($1, email),
           full_name = COALESCE($2, full_name),
           role_id = COALESCE($3, role_id),
           is_active = COALESCE($4, is_active)
       WHERE id = $5 RETURNING id, username, email, full_name, is_active`,
      [email ? email.trim().toLowerCase() : null, full_name ? full_name.trim() : null, roleId !== undefined ? (roleId ? parseInt(roleId) : null) : null, is_active !== undefined ? is_active : null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }
    console.error('Update user error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ลบ User
const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // ห้ามลบตัวเองถ้ากำลังล็อกอินอยู่
    if (req.session && req.session.userId === parseInt(id)) {
      return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตนเองที่กำลังใช้งานอยู่ได้' });
    }

    const userCheck = await pool.query(
      `SELECT u.id, u.username, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    }

    const user = userCheck.rows[0];

    // ถ้าเป็น admin ตรวจสอบว่าจะไม่ทำให้ไม่มี admin เหลือ
    if (user.role_name === 'admin') {
      const adminCount = await pool.query(
        `SELECT COUNT(*) as count
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'admin' AND u.is_active = TRUE AND u.id != $1`,
        [id]
      );

      if (parseInt(adminCount.rows[0].count) === 0) {
        return res.status(400).json({ error: 'ต้องมี Admin อย่างน้อย 1 คน' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'ลบ User สำเร็จ' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};


// ========== Audit Logs ==========

// ดู Audit Logs
const getAuditLogs = async (req, res) => {
  const { page = 1, limit = 50, eventType, result: filterResult, userId } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT al.*, u.username
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (eventType) {
      query += ` AND al.event_type = $${paramIndex}`;
      params.push(eventType);
      paramIndex++;
    }

    if (filterResult) {
      query += ` AND al.result = $${paramIndex}`;
      params.push(filterResult);
      paramIndex++;
    }

    if (userId) {
      query += ` AND al.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const logsResult = await pool.query(query, params);
    res.json(logsResult.rows);
  } catch (err) {
    console.error('Get audit logs error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

// ========== Dashboard Stats ==========

// ดูสถิติ Dashboard
const getDashboardStats = async (req, res) => {
  try {
    const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
    const roleCount = await pool.query('SELECT COUNT(*) as count FROM roles');
    const permissionCount = await pool.query('SELECT COUNT(*) as count FROM permissions');
    const activeUserCount = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_active = TRUE');
    const pendingRequests = await pool.query("SELECT COUNT(*) as count FROM supply_requests WHERE status = 'pending'");

    res.json({
      users: parseInt(userCount.rows[0].count),
      roles: parseInt(roleCount.rows[0].count),
      permissions: parseInt(permissionCount.rows[0].count),
      activeUsers: parseInt(activeUserCount.rows[0].count),
      pendingRequests: parseInt(pendingRequests.rows[0].count),
    });
  } catch (err) {
    console.error('Get dashboard stats error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
};

module.exports = {
  // Roles
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  changeUserRole,
  // Permissions
  getPermissions,
  createPermission,
  updatePermission,
  deletePermission,
  // ACL
  getACL,
  updateACL,
  // Endpoint Permissions
  getEndpointRegistry,
  getEndpointPermissions,
  createEndpointPermission,
  deleteEndpointPermission,
  // Users
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  // Audit Logs
  getAuditLogs,
  // Dashboard
  getDashboardStats,
};
