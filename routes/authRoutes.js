// Routes สำหรับ Authentication
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requestContext } = require('../middleware/auth');
const auditLogger = require('../middleware/auditLogger');
const rateLimit = require('express-rate-limit');

// Rate Limiting สำหรับล็อกอิน (5 ครั้งใน 15 นาที)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(429).json({ error: 'พยายามล็อกอินมากเกินไป กรุณารอสักครู่ (15 นาที)' });
    }
    return res.status(429).render('auth/login', { error: 'พยายามล็อกอินมากเกินไป กรุณารอสักครู่ (15 นาที)' });
  },
});

// หน้าล็อกอิน
router.get('/login', requestContext, authController.showLogin);

// ล็อกอิน
router.post('/login', loginLimiter, requestContext, auditLogger('login'), authController.login);

// ล็อกเอาท์
router.post('/logout', requestContext, auditLogger('logout'), authController.logout);

module.exports = router;

