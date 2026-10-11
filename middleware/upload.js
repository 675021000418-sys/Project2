// Middleware สำหรับอัปโหลดไฟล์รูปภาพสินค้า (Multer)
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ตรวจสอบและสร้างโฟลเดอร์ uploads หากยังไม่มี
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ตั้งค่า Storage บันทึกไฟล์ลงโฟลเดอร์ uploads พร้อมชื่อเฉพาะ
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'item-' + uniqueSuffix + ext);
  },
});

// กรองเฉพาะนามสกุลภาพ jpg, jpeg, png และขนาดไม่เกิน 2MB
const fileFilter = (req, file, cb) => {
  const allowedExts = ['.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedExts.includes(ext) && (file.mimetype.startsWith('image/jpeg') || file.mimetype.startsWith('image/png'))) {
    cb(null, true);
  } else {
    const err = new Error('อนุญาตเฉพาะไฟล์รูปภาพ .jpg, .jpeg หรือ .png เท่านั้น');
    err.status = 400;
    cb(err, false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter,
});

module.exports = upload;
