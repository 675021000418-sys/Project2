// การตั้งค่าการเชื่อมต่อฐานข้อมูล PostgreSQL
const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };

const pool = new Pool(dbConfig);

// ทดสอบการเชื่อมต่อ
pool.on('connect', () => {
  console.log('เชื่อมต่อฐานข้อมูลสำเร็จ');
});

pool.on('error', (err) => {
  console.error('ข้อผิดพลาดการเชื่อมต่อฐานข้อมูล:', err);
});

module.exports = pool;
