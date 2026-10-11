// Server Entry Point
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const sessionConfig = require('./config/session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // ปิด CSP เพื่อให้ใช้ CDN ได้ง่ายใน development
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session(sessionConfig));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware กลาง
const { requestContext } = require('./middleware/auth');
app.use(requestContext);

// Routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const { registerEndpoint } = require('./middleware/aclGuard');

app.use('/', authRoutes);
app.use('/', adminRoutes);
app.use('/', inventoryRoutes);

// Route หน้าแรก (/) redirect ไปหน้า dashboard หรือ login
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});


// ลงทะเบียน endpoint ตัวอย่างสำหรับรายงานการใช้ (ยังไม่ผูก permission เพื่อทดสอบเฟส 3)
registerEndpoint('GET', '/api/reports/usage', 'ดูรายงานการใช้');

// Protected routes (จะเพิ่มในเฟสถัดไป)
const { requireLogin } = require('./middleware/auth');
const { aclGuard } = require('./middleware/aclGuard');

app.get('/dashboard', requireLogin, (req, res) => {
  res.render('dashboard', {
    fullName: req.session.fullName,
    role: req.session.role,
  });
});

// Endpoint ตัวอย่างสำหรับรายงานการใช้ (ยังไม่ผูก permission)
app.get('/api/reports/usage', requireLogin, aclGuard, async (req, res) => {
  try {
    const pool = require('./config/database');
    const result = await pool.query(
      `SELECT sr.id, u.username as requester, h.name as house_name, 
              si.name as item_name, sr.qty, sr.status, sr.created_at
       FROM supply_requests sr
       JOIN users u ON sr.requester_id = u.id
       JOIN houses h ON sr.house_id = h.id
       JOIN supply_items si ON sr.item_id = si.id
       WHERE sr.status = 'completed'
       ORDER BY sr.created_at DESC
       LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// ดักจับ 404 Not Found
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'ไม่พบ Endpoint ที่ต้องการ' });
  }
  res.status(404).render('error', {
    status: 404,
    error: 'ไม่พบหน้าที่คุณต้องการ หรือเส้นทางนี้ถูกย้ายไปแล้ว',
  });
});

// Error Handler
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server รันที่ http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;

