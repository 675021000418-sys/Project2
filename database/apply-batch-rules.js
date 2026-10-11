const { Client } = require('pg');
require('dotenv').config();

async function updateTrigger() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://farm_db_zlvu_user:Ufb5D2R3m0LibEf5oEvO3cpTTzQFRc1a@dpg-db5nn92d0e5s7383dgt0-a.oregon-postgres.render.com/farm_db_zlvu';
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. อัปเดต Trigger ตรวจสอบวันหมดอายุย้อนหลัง
    const triggerSql = `
      CREATE OR REPLACE FUNCTION check_batch_rules()
      RETURNS TRIGGER AS $$
      DECLARE
        v_category VARCHAR(20);
      BEGIN
        SELECT category INTO v_category FROM items WHERE id = NEW.item_id;
        IF v_category IN ('antibiotic', 'vaccine') THEN
          IF NEW.lot_no IS NULL OR TRIM(NEW.lot_no) = '' THEN
            RAISE EXCEPTION 'หมวด % ต้องระบุหมายเลขล็อต (lot_no)', v_category;
          END IF;
          IF NEW.exp_date IS NULL THEN
            RAISE EXCEPTION 'หมวด % ต้องระบุวันหมดอายุ (exp_date)', v_category;
          END IF;
        END IF;

        -- กติกาสำหรับทุกล็อตที่มีวันหมดอายุ: ห้ามหมดอายุย้อนหลังจากวันที่รับเข้า
        IF NEW.exp_date IS NOT NULL AND NEW.exp_date <= NEW.received_date THEN
          RAISE EXCEPTION 'วันหมดอายุ (exp_date) ต้องอยู่หลังจากวันที่รับเข้า (received_date)';
        END IF;

        IF NEW.mfg_date IS NOT NULL AND NEW.mfg_date > NEW.received_date THEN
          RAISE EXCEPTION 'วันผลิต (mfg_date) ต้องไม่อยู่หลังวันที่รับเข้า (received_date)';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;

    await client.query(triggerSql);
    console.log('✅ Trigger check_batch_rules updated in Render DB successfully!');

    // 2. เพิ่ม Permissions ใหม่ (inventory.dispose และอื่นๆ)
    const newPermissions = [
      { key: 'inventory.dispose', desc: 'บันทึกทำลายสินค้าและเวชภัณฑ์หมดอายุ', module: 'inventory' },
      { key: 'inventory.export', desc: 'ส่งออกรายงานสต็อก (Excel/PDF)', module: 'inventory' },
      { key: 'inventory.audit', desc: 'ตรวจสอบประวัติสต็อกและการเคลื่อนไหว', module: 'inventory' },
      { key: 'batch.manage', desc: 'จัดการและตรวจสอบล็อตสินค้า', module: 'inventory' },
      { key: 'report.export', desc: 'ดาวน์โหลดรายงานสรุปประจำเดือน', module: 'report' },
    ];

    for (const p of newPermissions) {
      await client.query(`
        INSERT INTO permissions (key, description, module)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE
        SET description = EXCLUDED.description, module = EXCLUDED.module
      `, [p.key, p.desc, p.module]);
    }
    console.log(`✅ Added ${newPermissions.length} new permissions!`);

    // 3. ผูก permissions ใหม่ให้ Admin และ Owner ตามความเหมาะสม
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'admin'
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'owner' AND p.key IN ('inventory.dispose', 'inventory.export', 'inventory.audit', 'report.export')
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'head' AND p.key IN ('inventory.dispose', 'inventory.export', 'batch.manage')
      ON CONFLICT DO NOTHING;
    `);

    // 4. ผูก endpoint_permissions
    await client.query(`
      INSERT INTO endpoint_permissions (method, path_pattern, permission_id)
      SELECT 'POST', '^/app/inventory/[0-9]+/dispose$', p.id
      FROM permissions p WHERE p.key = 'inventory.dispose'
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Roles and endpoint permissions updated successfully!');

    const countRes = await client.query('SELECT count(*) FROM permissions');
    console.log('Total Permissions now:', countRes.rows[0].count);

  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await client.end();
  }
}

updateTrigger();
