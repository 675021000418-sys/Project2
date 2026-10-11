// การตั้งค่า Session ด้วย PostgreSQL
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./database');
require('dotenv').config();

const sessionConfig = {
  store: new pgSession({
    pool: pool,
    tableName: 'session',
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SESSION_COOKIE_SECURE === 'true',
    maxAge: 24 * 60 * 60 * 1000, // 24 ชั่วโมง
  },
  name: 'farm.sid',
};

module.exports = sessionConfig;
