const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runInit() {
  const dbConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'farm_db'
      };

  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database successfully!');

    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    console.log('Running schema.sql...');
    await client.query(schemaSql);
    console.log('schema.sql executed successfully!');

    const seedPath = path.join(__dirname, 'database', 'seed.sql');
    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      console.log('Running seed.sql...');
      await client.query(seedSql);
      console.log('seed.sql executed successfully!');
    }

    console.log('Database initialization completed!');
  } catch (err) {
    console.error('Database initialization error:', err.message);
    if (err.position) {
      console.error('Error position:', err.position);
    }
  } finally {
    await client.end();
  }
}

runInit();
