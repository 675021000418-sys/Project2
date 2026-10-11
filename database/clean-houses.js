const { Client } = require('pg');
require('dotenv').config();

async function cleanHouses() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://farm_db_zlvu_user:Ufb5D2R3m0LibEf5oEvO3cpTTzQFRc1a@dpg-db5nn92d0e5s7383dgt0-a.oregon-postgres.render.com/farm_db_zlvu';
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // หาแถวที่ชื่อซ้ำกัน
    const duplicates = await client.query(`
      SELECT name, MIN(id) as keep_id, ARRAY_AGG(id) as all_ids
      FROM houses
      GROUP BY name
      HAVING COUNT(*) > 1
    `);

    console.log('Duplicates found:', duplicates.rows);

    for (const row of duplicates.rows) {
      const keepId = row.keep_id;
      const removeIds = row.all_ids.filter(id => id !== keepId);

      // ย้าย Foreign Key ใน supply_requests
      await client.query('UPDATE supply_requests SET house_id = $1 WHERE house_id = ANY($2)', [keepId, removeIds]);

      // ย้าย user_houses
      for (const remId of removeIds) {
        await client.query(`
          INSERT INTO user_houses (user_id, house_id)
          SELECT user_id, ${keepId} FROM user_houses WHERE house_id = ${remId}
          ON CONFLICT DO NOTHING
        `);
        await client.query('DELETE FROM user_houses WHERE house_id = $1', [remId]);
      }

      // ลบโรงเรือน ID ที่ซ้ำ
      await client.query('DELETE FROM houses WHERE id = ANY($1)', [removeIds]);
    }

    // เพิ่ม UNIQUE constraint บนชื่อโรงเรือนเพื่อป้องกันการซ้ำในอนาคต
    try {
      await client.query('ALTER TABLE houses ADD CONSTRAINT uq_houses_name UNIQUE (name)');
      console.log('Added UNIQUE constraint on houses.name successfully');
    } catch (e) {
      console.log('Constraint note:', e.message);
    }

    const remaining = await client.query('SELECT * FROM houses ORDER BY id ASC');
    console.log('Cleaned houses successfully. Remaining:', remaining.rows);

  } catch (err) {
    console.error('Error cleaning houses:', err);
  } finally {
    await client.end();
  }
}

cleanHouses();
