const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runSeedOnly() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://farm_db_zlvu_user:Ufb5D2R3m0LibEf5oEvO3cpTTzQFRc1a@dpg-db5nn92d0e5s7383dgt0-a.oregon-postgres.render.com/farm_db_zlvu';
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to Render database successfully!');

    const seedPath = path.join(__dirname, 'seed.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf8');

    console.log('Running updated seed.sql...');
    await client.query(seedSql);
    console.log('seed.sql executed successfully!');

    const resUsers = await client.query('SELECT username, full_name FROM users');
    console.log('Users in database:', resUsers.rows);

    const resEP = await client.query('SELECT count(*) FROM endpoint_permissions');
    console.log('Total endpoint permissions mapped:', resEP.rows[0].count);

  } catch (err) {
    console.error('Error running seed.sql:', err.message);
  } finally {
    await client.end();
  }
}

runSeedOnly();
