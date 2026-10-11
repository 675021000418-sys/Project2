const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function runMigration() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://farm_db_zlvu_user:Ufb5D2R3m0LibEf5oEvO3cpTTzQFRc1a@dpg-db5nn92d0e5s7383dgt0-a.oregon-postgres.render.com/farm_db_zlvu';
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const sql = fs.readFileSync('database/migrations/002_create_disposal_system.sql', 'utf8');
    await client.query(sql);
    console.log('✅ Migration 002 applied successfully to Render DB!');

    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables in Render DB:', res.rows.map(r => r.table_name));
  } catch (err) {
    console.error('Error applying migration 002:', err);
  } finally {
    await client.end();
  }
}

runMigration();
