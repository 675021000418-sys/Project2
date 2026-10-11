// Middleware จัดการ Error กลาง
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  const status = err.status || 500;

  // สำหรับ API ส่ง JSON (ไม่แสดง stack trace ให้ client)
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: err.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
    });
  }

  // สำหรับหน้า Web View แสดง Error Page สวยงาม (ไม่ส่ง stack trace)
  res.status(status).render('error', {
    status,
    error: err.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
  });
};

module.exports = errorHandler;
