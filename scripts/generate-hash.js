// Script สำหรับ generate bcrypt hash สำหรับรหัสผ่านทดสอบ
// รัน: node scripts/generate-hash.js

const bcrypt = require('bcrypt');

const password = 'test1234';
const saltRounds = 10;

async function generateHash() {
  try {
    const hash = await bcrypt.hash(password, saltRounds);
    console.log('Password:', password);
    console.log('Hash:', hash);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

generateHash();
