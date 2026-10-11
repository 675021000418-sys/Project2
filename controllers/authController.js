// Controller สำหรับ Authentication
const bcrypt = require('bcrypt');
const pool = require('../config/database');
const auditLogger = require('../middleware/auditLogger');

// แสดงหน้าล็อกอิน
const showLogin = (req, res) => {
  res.render('auth/login', { error: null });
};

// ล็อกอิน
const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('auth/login', { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  try {
    // ค้นหาผู้ใช้
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.password_hash, u.full_name, u.is_active,
              r.id as role_id, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.username = $1`,
      [username]
    );


    if (result.rows.length === 0) {
      // บันทึก log กรณีล็อกอินล้มเหลว
      await pool.query(
        `INSERT INTO audit_logs (username_attempted, event_type, result, ip, detail)
         VALUES ($1, $2, $3, $4, $5)`,
        [username, 'login', 'fail', req.ip, JSON.stringify({ reason: 'user_not_found' })]
      );
      
      return res.render('auth/login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = result.rows[0];

    // ตรวจสอบว่าบัญชีถูกปิดใช้งานหรือไม่
    if (!user.is_active) {
      await pool.query(
        `INSERT INTO audit_logs (user_id, username_attempted, event_type, result, ip, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, username, 'login', 'fail', req.ip, JSON.stringify({ reason: 'account_inactive' })]
      );
      
      return res.render('auth/login', { error: 'บัญชีถูกปิดใช้งาน' });
    }

    // ตรวจสอบรหัสผ่าน
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      await pool.query(
        `INSERT INTO audit_logs (user_id, username_attempted, event_type, result, ip, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, username, 'login', 'fail', req.ip, JSON.stringify({ reason: 'invalid_password' })]
      );
      
      return res.render('auth/login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    // สร้าง session ใหม่ (regenerate session)
    req.session.regenerate((err) => {
      if (err) {
        console.error('Regenerate session error:', err);
        return res.render('auth/login', { error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
      }

      // เก็บข้อมูลใน session
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.fullName = user.full_name;
      req.session.roleId = user.role_id;
      req.session.role = user.role_name;

      // บันทึก log ล็อกอินสำเร็จ
      pool.query(
        `INSERT INTO audit_logs (user_id, username_attempted, event_type, result, ip, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, user.username, 'login', 'success', req.clientIp || req.ip, JSON.stringify({ role: user.role_name })]
      ).catch(err => console.error('บันทึก audit log ล้มเหลว:', err));

      // ต้องบันทึก session ให้เสร็จสมบูรณ์ก่อน redirect ป้องกัน race condition กับ connect-pg-simple
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          return res.render('auth/login', { error: 'เกิดข้อผิดพลาดในการบันทึก session' });
        }

        // เปลี่ยนเส้นทางตาม role
        if (user.role_name === 'admin') {
          return res.redirect('/admin/dashboard');
        } else {
          return res.redirect('/dashboard');
        }
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
};

// ล็อกเอาท์
const logout = async (req, res) => {
  const userId = req.session?.userId;
  const username = req.session?.username;

  if (userId) {
    pool.query(
      `INSERT INTO audit_logs (user_id, username_attempted, event_type, result, ip, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, username, 'logout', 'success', req.clientIp || req.ip, null]
    ).catch(err => console.error('บันทึก audit log ล้มเหลว:', err));
  }

  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Destroy session error:', err);
      }
      res.clearCookie('farm.sid');
      res.redirect('/login');
    });
  } else {
    res.clearCookie('farm.sid');
    res.redirect('/login');
  }
};

module.exports = {
  showLogin,
  login,
  logout,
};
