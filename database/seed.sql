-- ข้อมูลเริ่มต้นสำหรับฐานข้อมูล farm_db
-- รันหลังจาก schema.sql: psql -U postgres -d farm_db -f database/seed.sql

-- สร้าง Roles
INSERT INTO roles (name, description, is_system) VALUES
('admin', 'ผู้ดูแลระบบ - ทำได้ทุกฟังก์ชัน', TRUE),
('owner', 'เจ้าของฟาร์ม - ผู้อนุมัติคำขอ', FALSE),
('head', 'หัวหน้าโรงเรือน - จ่ายของ จัดการสต็อก/โรงเรือนของตน', FALSE),
('worker', 'คนงาน - ยื่นคำขอและบันทึกการใช้ของตนเอง', FALSE)
ON CONFLICT (name) DO NOTHING;

-- สร้าง Permissions
INSERT INTO permissions (key, description, module) VALUES
-- ผู้ใช้
('user.read', 'ดูข้อมูลผู้ใช้', 'user'),
('user.create', 'เพิ่มผู้ใช้', 'user'),
('user.update', 'แก้ไขข้อมูลผู้ใช้', 'user'),
('user.delete', 'ลบผู้ใช้', 'user'),
-- บทบาท
('role.read', 'ดูข้อมูลบทบาท', 'role'),
('role.create', 'เพิ่มบทบาท', 'role'),
('role.update', 'แก้ไขบทบาท', 'role'),
('role.delete', 'ลบบทบาท', 'role'),
-- สิทธิ์
('permission.read', 'ดูข้อมูลสิทธิ์', 'permission'),
('permission.create', 'เพิ่มสิทธิ์', 'permission'),
('permission.update', 'แก้ไขสิทธิ์', 'permission'),
('permission.delete', 'ลบสิทธิ์', 'permission'),
-- ACL
('acl.manage', 'จัดการ ACL (ผูก Role-Permission)', 'acl'),
('endpoint.manage', 'จัดการผูก Permission กับ Endpoint', 'endpoint'),
-- โรงเรือน
('house.read', 'ดูข้อมูลโรงเรือน', 'house'),
('house.create', 'เพิ่มโรงเรือน', 'house'),
('house.update', 'แก้ไขโรงเรือน', 'house'),
('house.delete', 'ลบโรงเรือน', 'house'),
-- วัสดุ
('supply.read', 'ดูข้อมูลวัสดุ', 'supply'),
('supply.create', 'เพิ่มวัสดุ', 'supply'),
('supply.update', 'แก้ไขวัสดุ', 'supply'),
('supply.delete', 'ลบวัสดุ', 'supply'),
-- คำขอเบิก
('request.create', 'สร้างคำขอเบิก', 'request'),
('request.read', 'ดูคำขอเบิก', 'request'),
('request.update', 'แก้ไขคำขอเบิก', 'request'),
('request.cancel', 'ยกเลิกคำขอเบิก', 'request'),
('request.approve', 'อนุมัติคำขอเบิก', 'request'),
('request.reject', 'ปฏิเสธคำขอเบิก', 'request'),
('request.dispense', 'จ่ายวัสดุ', 'request'),
('request.complete', 'บันทึกการใช้วัสดุ', 'request'),
-- ไฟล์
('file.upload', 'อัปโหลดไฟล์', 'file'),
('file.download', 'ดาวน์โหลดไฟล์', 'file'),
('file.delete', 'ลบไฟล์', 'file'),
-- คลังวัสดุและเวชภัณฑ์ (Inventory)
('inventory.read', 'ดูข้อมูลคลังวัสดุและเวชภัณฑ์', 'inventory'),
('inventory.create', 'เพิ่มรายการวัสดุและเวชภัณฑ์ใหม่', 'inventory'),
('inventory.update', 'แก้ไขข้อมูลวัสดุและเวชภัณฑ์', 'inventory'),
('inventory.delete', 'ปิดการใช้งาน/ลบรายการวัสดุ', 'inventory'),
('inventory.receive', 'รับวัสดุ/เวชภัณฑ์เข้าคลัง (สร้างล็อต)', 'inventory'),
('inventory.issue', 'จ่ายวัสดุ/เวชภัณฑ์ออกจากคลัง (FEFO/FIFO)', 'inventory'),
('inventory.adjust', 'ปรับยอดสต็อก/ตรวจนับประจำงวด', 'inventory'),
-- Log
('log.view', 'ดู Audit Log', 'log'),
-- รายงาน
('report.usage', 'ดูรายงานการใช้', 'report')
ON CONFLICT (key) DO NOTHING;

-- ผูก Permissions ให้ Admin (ทุกสิทธิ์)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ผูก Permissions ให้ Owner (เจ้าของฟาร์ม)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'owner' AND p.key IN (
    'user.read', 'house.read', 'house.create', 'house.update', 'house.delete',
    'supply.read', 'supply.create', 'supply.update', 'supply.delete',
    'inventory.read',
    'request.read', 'request.approve', 'request.reject',
    'file.download', 'log.view', 'report.usage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ผูก Permissions ให้ Head (หัวหน้าโรงเรือน)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'head' AND p.key IN (
    'house.read', 'house.update',
    'supply.read', 'supply.update',
    'inventory.read', 'inventory.receive', 'inventory.issue', 'inventory.adjust', 'inventory.create', 'inventory.update',
    'request.read', 'request.dispense',
    'file.download', 'report.usage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ผูก Permissions ให้ Worker (คนงาน)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'worker' AND p.key IN (
    'house.read',
    'supply.read',
    'inventory.read',
    'request.create', 'request.read', 'request.update', 'request.cancel', 'request.complete',
    'file.upload', 'file.download'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- สร้าง Users (รหัสผ่านทั้งหมดคือ "test1234")
-- bcrypt hash สำหรับ "test1234": $2b$10$QgExCPmYl88UhzbEqZUb/.waGqEyMgmwLAP7gibyX0FIVIfayz7B2
INSERT INTO users (username, email, password_hash, full_name, role_id) VALUES
('admin', 'admin@farm.local', '$2b$10$QgExCPmYl88UhzbEqZUb/.waGqEyMgmwLAP7gibyX0FIVIfayz7B2', 'ผู้ดูแลระบบ', (SELECT id FROM roles WHERE name = 'admin')),
('owner1', 'owner1@farm.local', '$2b$10$QgExCPmYl88UhzbEqZUb/.waGqEyMgmwLAP7gibyX0FIVIfayz7B2', 'เจ้าของฟาร์ม 1', (SELECT id FROM roles WHERE name = 'owner')),
('head1', 'head1@farm.local', '$2b$10$QgExCPmYl88UhzbEqZUb/.waGqEyMgmwLAP7gibyX0FIVIfayz7B2', 'หัวหน้าโรงเรือน 1', (SELECT id FROM roles WHERE name = 'head')),
('worker1', 'worker1@farm.local', '$2b$10$QgExCPmYl88UhzbEqZUb/.waGqEyMgmwLAP7gibyX0FIVIfayz7B2', 'คนงาน 1', (SELECT id FROM roles WHERE name = 'worker')),
('worker2', 'worker2@farm.local', '$2b$10$QgExCPmYl88UhzbEqZUb/.waGqEyMgmwLAP7gibyX0FIVIfayz7B2', 'คนงาน 2', (SELECT id FROM roles WHERE name = 'worker'))
ON CONFLICT (username) DO NOTHING;

-- สร้าง Houses (โรงเรือน)
INSERT INTO houses (name, animal_type, capacity, status) VALUES
('โรงเรือน A', 'ไก่', 1000, 'active'),
('โรงเรือน B', 'หมู', 500, 'active'),
('โรงเรือน C', 'เป็ด', 800, 'active')
ON CONFLICT DO NOTHING;

-- ผูก Users กับ Houses
-- head1 ดูแลโรงเรือน A และ B
INSERT INTO user_houses (user_id, house_id)
SELECT u.id, h.id
FROM users u, houses h
WHERE u.username = 'head1' AND h.name IN ('โรงเรือน A', 'โรงเรือน B')
ON CONFLICT (user_id, house_id) DO NOTHING;

-- worker1 สังกัดโรงเรือน A
INSERT INTO user_houses (user_id, house_id)
SELECT u.id, h.id
FROM users u, houses h
WHERE u.username = 'worker1' AND h.name = 'โรงเรือน A'
ON CONFLICT (user_id, house_id) DO NOTHING;

-- worker2 สังกัดโรงเรือน B
INSERT INTO user_houses (user_id, house_id)
SELECT u.id, h.id
FROM users u, houses h
WHERE u.username = 'worker2' AND h.name = 'โรงเรือน B'
ON CONFLICT (user_id, house_id) DO NOTHING;

-- สร้าง Items และ Batches เริ่มต้นสำหรับคลังสินค้า (9 รายการ)
INSERT INTO items (item_code, name, category, base_unit, alt_unit, unit_factor, reorder_point, unit_cost, storage_note, is_active) VALUES
('FEED-001', 'อาหารไก่ไข่ระยะให้ผลผลิต (Layer Feed)', 'feed', 'กระสอบ (30 กก.)', 'กก.', 30.00, 20.00, 480.00, 'เก็บในที่แห้ง อากาศถ่ายเทสะดวก พ้นจากแสงแดดและความชื้น', TRUE),
('FEED-002', 'อาหารสุกรขุนรุ่น 3 (Swine Grower Feed)', 'feed', 'กระสอบ (30 กก.)', 'กก.', 30.00, 15.00, 520.00, 'เก็บในที่แห้ง ยกสูงจากพื้นอย่างน้อย 15 ซม.', TRUE),
('FEED-003', 'หัวอาหารสัตว์ผสมพรีมิกซ์ (Mineral Premix)', 'feed', 'ถุง (10 กก.)', 'กก.', 10.00, 5.00, 750.00, 'เก็บในที่ร่ม อุณหภูมิห้อง ปิดปากถุงให้สนิททุกครั้งหลังเปิด', TRUE),
('MED-001', 'Amoxicillin 20% Soluble Powder', 'antibiotic', 'ขวด (500 กรัม)', 'กรัม', 500.00, 10.00, 650.00, 'เก็บในที่แห้ง อุณหภูมิต่ำกว่า 30°C ป้องกันแสงแดด', TRUE),
('MED-002', 'Enrofloxacin 10% Oral Solution', 'antibiotic', 'ขวด (1 ลิตร)', 'มล.', 1000.00, 8.00, 920.00, 'เก็บในที่มิดชิด พ้นแสงแดด อุณหภูมิห้อง', TRUE),
('MED-003', 'Oxytetracycline 20% LA Injectable', 'antibiotic', 'ขวด (100 มล.)', 'มล.', 100.00, 12.00, 380.00, 'เก็บที่อุณหภูมิห้อง 15-25°C ห้ามแช่แข็ง', TRUE),
('VAC-001', 'วัคซีนป้องกันโรคนิวคาสเซิลและหลอดลมอักเสบ (ND+IB)', 'vaccine', 'ขวด (1000 โดส)', 'โดส', 1000.00, 10.00, 450.00, 'เก็บในตู้เย็นอุณหภูมิ 2-8°C อย่างเคร่งครัด ห้ามแช่แข็ง', TRUE),
('VAC-002', 'วัคซีนป้องกันโรคอหิวาต์สุกร (CSF Vaccine)', 'vaccine', 'ขวด (50 โดส)', 'โดส', 50.00, 6.00, 820.00, 'เก็บในตู้เย็นอุณหภูมิ 2-8°C และหลีกเลี่ยงแสง', TRUE),
('VAC-003', 'วัคซีนกัมโบโรเชื้อเป็น (IBD Live Vaccine)', 'vaccine', 'ขวด (1000 โดส)', 'โดส', 1000.00, 8.00, 510.00, 'เก็บในตู้เย็น 2-8°C และตรวจสอบ cold chain อย่างสม่ำเสมอ', TRUE)
ON CONFLICT (item_code) DO NOTHING;

-- เพิ่ม Batches และ Stock Transactions สาธิต
DO $$
DECLARE
  v_uid INTEGER;
  v_bid INTEGER;
  v_i1 INTEGER; v_i2 INTEGER; v_i3 INTEGER;
  v_i4 INTEGER; v_i5 INTEGER; v_i6 INTEGER;
  v_i7 INTEGER; v_i8 INTEGER; v_i9 INTEGER;
BEGIN
  SELECT id INTO v_uid FROM users WHERE username = 'head1';
  IF v_uid IS NULL THEN SELECT id INTO v_uid FROM users WHERE username = 'admin'; END IF;

  SELECT id INTO v_i1 FROM items WHERE item_code = 'FEED-001';
  SELECT id INTO v_i2 FROM items WHERE item_code = 'FEED-002';
  SELECT id INTO v_i3 FROM items WHERE item_code = 'FEED-003';
  SELECT id INTO v_i4 FROM items WHERE item_code = 'MED-001';
  SELECT id INTO v_i5 FROM items WHERE item_code = 'MED-002';
  SELECT id INTO v_i6 FROM items WHERE item_code = 'MED-003';
  SELECT id INTO v_i7 FROM items WHERE item_code = 'VAC-001';
  SELECT id INTO v_i8 FROM items WHERE item_code = 'VAC-002';
  SELECT id INTO v_i9 FROM items WHERE item_code = 'VAC-003';

  -- FEED-001 (FIFO)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i1, 'LOT-F1-OLD', '2026-08-01', '2027-02-01', '2026-08-10', 50, 15, 'ซีพีเอฟ ฟีดมิลล์')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i1, v_bid, 'receive', 50, 15, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i1, 'LOT-F1-NEW', '2026-09-15', '2027-03-15', '2026-09-20', 40, 40, 'ซีพีเอฟ ฟีดมิลล์')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i1, v_bid, 'receive', 40, 40, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- FEED-002 (Low Stock)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i2, 'LOT-F2-LOW', '2026-08-01', '2027-02-01', '2026-08-05', 20, 8, 'เบทาโกร ฟีด')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i2, v_bid, 'receive', 20, 8, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- FEED-003 (Standard)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i3, 'LOT-F3-STD', '2026-09-01', NULL, '2026-09-05', 25, 25, 'ไทยพรีมิกซ์ จำกัด')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i3, v_bid, 'receive', 25, 25, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- MED-001 (FEFO: LOT-M1-FEFO-EARLY หมดอายุก่อน, LOT-M1-FEFO-LATER หมดอายุทีหลัง)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i4, 'LOT-M1-FEFO-EARLY', '2025-12-01', '2026-12-15', '2026-01-10', 20, 10, 'เวทเมดิคอล สยาม')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i4, v_bid, 'receive', 20, 10, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i4, 'LOT-M1-FEFO-LATER', '2026-06-01', '2027-06-30', '2026-07-01', 30, 25, 'เวทเมดิคอล สยาม')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i4, v_bid, 'receive', 30, 25, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- MED-002 (มีล็อตหมดอายุแล้ว LOT-M2-EXPIRED)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i5, 'LOT-M2-EXPIRED', '2024-08-01', CURRENT_DATE - INTERVAL '15 days', '2024-09-01', 15, 15, 'อินเตอร์เวท ฟาร์มา')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i5, v_bid, 'receive', 15, 15, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i5, 'LOT-M2-VALID', '2026-05-01', '2027-05-01', '2026-06-01', 20, 18, 'อินเตอร์เวท ฟาร์มา')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i5, v_bid, 'receive', 20, 18, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- MED-003 (Near Expire < 30 วัน)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i6, 'LOT-M3-NEAR-EXP', '2024-11-01', CURRENT_DATE + INTERVAL '12 days', '2024-11-20', 25, 14, 'ไบโอฟาร์ม เวท')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i6, v_bid, 'receive', 25, 14, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- VAC-001 (FEFO)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i7, 'LOT-V1-EXP-DEC', '2026-03-01', '2026-11-25', '2026-04-01', 20, 8, 'แวคซีนแล็บ สากล')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i7, v_bid, 'receive', 20, 8, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i7, 'LOT-V1-EXP-MAR', '2026-06-01', '2027-03-30', '2026-07-01', 30, 30, 'แวคซีนแล็บ สากล')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i7, v_bid, 'receive', 30, 30, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- VAC-002 (Near Expire & Critical Low)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i8, 'LOT-V2-CRITICAL', '2025-10-01', CURRENT_DATE + INTERVAL '18 days', '2025-10-20', 10, 4, 'สถาบันสุขภาพสัตว์')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i8, v_bid, 'receive', 10, 4, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;

  -- VAC-003 (Normal)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier)
  VALUES (v_i9, 'LOT-V3-HEALTHY', '2026-08-01', '2027-08-01', '2026-08-15', 25, 25, 'สยามแวคซีน เทค')
  ON CONFLICT (item_id, lot_no) DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NOT NULL THEN
    INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
    VALUES (v_i9, v_bid, 'receive', 25, 25, v_uid, 'ยอดยกมาเริ่มต้น');
  END IF;
END $$;

-- ผูก endpoint_permissions เริ่มต้นสำหรับระบบคลังสินค้า และระบบอื่นๆ
INSERT INTO endpoint_permissions (method, path_pattern, permission_id) VALUES
-- คลังสินค้า
('GET', '^/app/inventory$', (SELECT id FROM permissions WHERE key = 'inventory.read')),
('GET', '^/app/inventory/[0-9]+$', (SELECT id FROM permissions WHERE key = 'inventory.read')),
('GET', '^/api/inventory/summary$', (SELECT id FROM permissions WHERE key = 'inventory.read')),
('POST', '^/app/inventory$', (SELECT id FROM permissions WHERE key = 'inventory.create')),
('PUT', '^/app/inventory/[0-9]+$', (SELECT id FROM permissions WHERE key = 'inventory.update')),
('DELETE', '^/app/inventory/[0-9]+$', (SELECT id FROM permissions WHERE key = 'inventory.delete')),
('POST', '^/app/inventory/[0-9]+/receive$', (SELECT id FROM permissions WHERE key = 'inventory.receive')),
('POST', '^/app/inventory/[0-9]+/issue$', (SELECT id FROM permissions WHERE key = 'inventory.issue')),
('POST', '^/app/inventory/[0-9]+/adjust$', (SELECT id FROM permissions WHERE key = 'inventory.adjust')),

-- คำขอเบิก
('GET', '^/app/requests$', (SELECT id FROM permissions WHERE key = 'request.read')),
('POST', '^/app/requests/[0-9]+/approve$', (SELECT id FROM permissions WHERE key = 'request.approve')),
('POST', '^/app/requests/[0-9]+/reject$', (SELECT id FROM permissions WHERE key = 'request.reject')),
('POST', '^/app/requests/[0-9]+/dispense$', (SELECT id FROM permissions WHERE key = 'request.dispense')),
('POST', '^/app/requests/[0-9]+/cancel$', (SELECT id FROM permissions WHERE key = 'request.cancel')),
('POST', '^/app/inventory/[0-9]+/request$', (SELECT id FROM permissions WHERE key = 'request.create')),

-- ผู้ใช้ (Users API)
('GET', '^/api/admin/users$', (SELECT id FROM permissions WHERE key = 'user.read')),
('POST', '^/api/admin/users$', (SELECT id FROM permissions WHERE key = 'user.create')),
('PUT', '^/api/admin/users/[0-9]+$', (SELECT id FROM permissions WHERE key = 'user.update')),
('DELETE', '^/api/admin/users/[0-9]+$', (SELECT id FROM permissions WHERE key = 'user.delete')),
('POST', '^/api/admin/users/role$', (SELECT id FROM permissions WHERE key = 'user.update')),

-- บทบาท (Roles API)
('GET', '^/api/admin/roles$', (SELECT id FROM permissions WHERE key = 'role.read')),
('POST', '^/api/admin/roles$', (SELECT id FROM permissions WHERE key = 'role.create')),
('PUT', '^/api/admin/roles/[0-9]+$', (SELECT id FROM permissions WHERE key = 'role.update')),
('DELETE', '^/api/admin/roles/[0-9]+$', (SELECT id FROM permissions WHERE key = 'role.delete')),

-- สิทธิ์ (Permissions API)
('GET', '^/api/admin/permissions$', (SELECT id FROM permissions WHERE key = 'permission.read')),
('POST', '^/api/admin/permissions$', (SELECT id FROM permissions WHERE key = 'permission.create')),
('PUT', '^/api/admin/permissions/[0-9]+$', (SELECT id FROM permissions WHERE key = 'permission.update')),
('DELETE', '^/api/admin/permissions/[0-9]+$', (SELECT id FROM permissions WHERE key = 'permission.delete')),

-- ACL Matrix API
('GET', '^/api/admin/acl$', (SELECT id FROM permissions WHERE key = 'acl.manage')),
('POST', '^/api/admin/acl$', (SELECT id FROM permissions WHERE key = 'acl.manage')),

-- Endpoint Permissions API
('GET', '^/api/admin/endpoints$', (SELECT id FROM permissions WHERE key = 'endpoint.manage')),
('GET', '^/api/admin/endpoint-permissions$', (SELECT id FROM permissions WHERE key = 'endpoint.manage')),
('POST', '^/api/admin/endpoint-permissions$', (SELECT id FROM permissions WHERE key = 'endpoint.manage')),
('DELETE', '^/api/admin/endpoint-permissions/[0-9]+$', (SELECT id FROM permissions WHERE key = 'endpoint.manage')),

-- Audit Logs & Reports
('GET', '^/api/admin/logs$', (SELECT id FROM permissions WHERE key = 'log.view')),
('GET', '^/api/admin/stats$', (SELECT id FROM permissions WHERE key = 'user.read')),
('GET', '^/api/reports/usage$', (SELECT id FROM permissions WHERE key = 'report.usage'))
ON CONFLICT (method, path_pattern) DO NOTHING;


