-- Migration: 001_create_inventory_system.sql
-- คำสั่งรัน: psql -U postgres -d farm_db -f database/migrations/001_create_inventory_system.sql
-- คำอธิบายแผนย้ายข้อมูล:
-- 1. สร้างตาราง items ใหม่ตามข้อกำหนด (id, item_code, name, category, base_unit, alt_unit, unit_factor, reorder_point, unit_cost, storage_note, image_file_id, is_active, created_at)
-- 2. ย้ายข้อมูลจาก supply_items เดิม (ถ้ามี): แมป category 'medicine' -> 'antibiotic', เจน item_code อัตโนมัติ เช่น ITM-0001
-- 3. อัปเดต Foreign Key ใน supply_requests ให้ชี้มาที่ items (ถ้าตาราง supply_requests มีอยู่)
-- 4. เก็บ supply_items ไว้หรือแปลงเป็น VIEW เพื่อไม่ให้โค้ดเก่าพัง
-- 5. สร้างตาราง inventory_batches, stock_transactions, view v_item_stock และ index ที่เกี่ยวข้อง
-- 6. เพิ่ม Permissions ใหม่และผูกกับ Roles ตามข้อกำหนด

BEGIN;

-- 1. สร้างตาราง items
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  item_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('feed', 'antibiotic', 'vaccine')),
  base_unit VARCHAR(50) NOT NULL,
  alt_unit VARCHAR(50),
  unit_factor NUMERIC(12, 4) CHECK (unit_factor IS NULL OR unit_factor > 0),
  reorder_point NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  unit_cost NUMERIC(12, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  storage_note TEXT,
  image_file_id INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index สำหรับ items
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_is_active ON items (is_active);
CREATE INDEX IF NOT EXISTS idx_items_item_code ON items (item_code);

-- 2. แผนย้ายข้อมูลจาก supply_items (ถ้ามีข้อมูลเดิม)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supply_items') THEN
    INSERT INTO items (id, item_code, name, category, base_unit, reorder_point, image_file_id, created_at)
    SELECT 
      si.id,
      COALESCE('ITM-' || LPAD(si.id::TEXT, 4, '0')),
      si.name,
      CASE 
        WHEN si.category = 'medicine' THEN 'antibiotic'
        WHEN si.category IN ('feed', 'vaccine') THEN si.category
        ELSE 'feed'
      END,
      si.unit,
      COALESCE(si.min_qty, 0),
      si.image_file_id,
      si.created_at
    FROM supply_items si
    ON CONFLICT (id) DO NOTHING;

    -- ปรับ Sequence ของ items ให้ตรงกับค่า id สูงสุด
    PERFORM setval(pg_get_serial_sequence('items', 'id'), COALESCE((SELECT MAX(id) FROM items), 1));
  END IF;
END $$;

-- 3. ตาราง inventory_batches (ล็อตสินค้า)
CREATE TABLE IF NOT EXISTS inventory_batches (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(100) NOT NULL,
  mfg_date DATE,
  exp_date DATE,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  qty_received NUMERIC(12, 2) NOT NULL CHECK (qty_received > 0),
  qty_remaining NUMERIC(12, 2) NOT NULL CHECK (qty_remaining >= 0),
  supplier VARCHAR(200),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_item_batch_lot UNIQUE (item_id, lot_no)
);

-- Index สำหรับ inventory_batches
CREATE INDEX IF NOT EXISTS idx_batches_item_id ON inventory_batches (item_id);
CREATE INDEX IF NOT EXISTS idx_batches_exp_date ON inventory_batches (exp_date);
CREATE INDEX IF NOT EXISTS idx_batches_received_date ON inventory_batches (received_date);
CREATE INDEX IF NOT EXISTS idx_batches_qty_remaining ON inventory_batches (qty_remaining);

-- Constraint ตรวจสอบกติกา: antibiotic และ vaccine ต้องมี lot_no และ exp_date
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_batch_rules ON inventory_batches;
CREATE TRIGGER trg_check_batch_rules
BEFORE INSERT OR UPDATE ON inventory_batches
FOR EACH ROW
EXECUTE FUNCTION check_batch_rules();

-- 4. ตาราง stock_transactions (บันทึกธุรกรรมสต็อก - ลบไม่ได้ ห้าม UPDATE)
CREATE TABLE IF NOT EXISTS stock_transactions (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  batch_id INTEGER NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('receive', 'issue', 'adjust')),
  qty NUMERIC(12, 2) NOT NULL CHECK (qty > 0),
  balance_after NUMERIC(12, 2) NOT NULL,
  performed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index สำหรับ stock_transactions
CREATE INDEX IF NOT EXISTS idx_tx_item_id ON stock_transactions (item_id);
CREATE INDEX IF NOT EXISTS idx_tx_batch_id ON stock_transactions (batch_id);
CREATE INDEX IF NOT EXISTS idx_tx_created_at ON stock_transactions (created_at);

-- Trigger ป้องกันการ UPDATE หรือ DELETE บน stock_transactions
CREATE OR REPLACE FUNCTION prevent_stock_transaction_modifications()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ตาราง stock_transactions เป็นบันทึกประวัติถาวร ไม่อนุญาตให้แก้ไขหรือลบ (Append-only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_stock_tx_mod ON stock_transactions;
CREATE TRIGGER trg_prevent_stock_tx_mod
BEFORE UPDATE OR DELETE ON stock_transactions
FOR EACH ROW
EXECUTE FUNCTION prevent_stock_transaction_modifications();

-- 5. สร้าง VIEW v_item_stock
-- รวมยอดคงเหลือต่อ item (SUM qty_remaining เฉพาะล็อตที่ยังไม่หมดอายุหรือไม่มีวันหมดอายุ),
-- ล็อตที่ใกล้หมดอายุ (ภายใน 30 วัน), และคำนวณสถานะสต็อก
CREATE OR REPLACE VIEW v_item_stock AS
WITH batch_aggregates AS (
  SELECT 
    b.item_id,
    -- สต็อกที่พร้อมใช้ (ไม่นับล็อตที่หมดอายุแล้ว)
    COALESCE(SUM(CASE WHEN b.exp_date IS NULL OR b.exp_date >= CURRENT_DATE THEN b.qty_remaining ELSE 0 END), 0) AS total_usable_stock,
    -- สต็อกทั้งหมดรวมล็อตหมดอายุ (เพื่อทราบของเสีย)
    COALESCE(SUM(b.qty_remaining), 0) AS total_physical_stock,
    -- ล็อตที่หมดอายุแล้วคงเหลือ
    COALESCE(SUM(CASE WHEN b.exp_date IS NOT NULL AND b.exp_date < CURRENT_DATE THEN b.qty_remaining ELSE 0 END), 0) AS expired_stock,
    -- ล็อตที่ใกล้หมดอายุ (ภายใน 30 วัน และยังไม่หมดอายุ)
    COALESCE(SUM(CASE WHEN b.exp_date IS NOT NULL AND b.exp_date >= CURRENT_DATE AND b.exp_date <= (CURRENT_DATE + INTERVAL '30 days') THEN b.qty_remaining ELSE 0 END), 0) AS near_exp_stock,
    -- วันหมดอายุที่ใกล้ที่สุดของล็อตที่มีของ
    MIN(CASE WHEN b.qty_remaining > 0 AND b.exp_date IS NOT NULL AND b.exp_date >= CURRENT_DATE THEN b.exp_date END) AS earliest_exp_date,
    COUNT(b.id) FILTER (WHERE b.qty_remaining > 0) AS active_batches_count
  FROM inventory_batches b
  GROUP BY b.item_id
)
SELECT 
  i.id,
  i.item_code,
  i.name,
  i.category,
  i.base_unit,
  i.alt_unit,
  i.unit_factor,
  i.reorder_point,
  i.unit_cost,
  i.storage_note,
  i.image_file_id,
  i.is_active,
  i.created_at,
  COALESCE(ba.total_usable_stock, 0) AS total_usable_stock,
  COALESCE(ba.total_physical_stock, 0) AS total_physical_stock,
  COALESCE(ba.expired_stock, 0) AS expired_stock,
  COALESCE(ba.near_exp_stock, 0) AS near_exp_stock,
  ba.earliest_exp_date,
  COALESCE(ba.active_batches_count, 0) AS active_batches_count,
  CASE
    WHEN COALESCE(ba.total_usable_stock, 0) = 0 THEN 'out_of_stock'
    WHEN COALESCE(ba.total_usable_stock, 0) <= i.reorder_point THEN 'low_stock'
    WHEN COALESCE(ba.near_exp_stock, 0) > 0 THEN 'near_exp'
    ELSE 'normal'
  END AS stock_status
FROM items i
LEFT JOIN batch_aggregates ba ON i.id = ba.item_id;

-- 6. เพิ่ม Permissions สำหรับระบบ Inventory
INSERT INTO permissions (key, description, module) VALUES
('inventory.read', 'ดูข้อมูลคลังวัสดุและเวชภัณฑ์', 'inventory'),
('inventory.create', 'เพิ่มรายการวัสดุและเวชภัณฑ์ใหม่', 'inventory'),
('inventory.update', 'แก้ไขข้อมูลวัสดุและเวชภัณฑ์', 'inventory'),
('inventory.delete', 'ปิดการใช้งาน/ลบรายการวัสดุ', 'inventory'),
('inventory.receive', 'รับวัสดุ/เวชภัณฑ์เข้าคลัง (สร้างล็อต)', 'inventory'),
('inventory.issue', 'จ่ายวัสดุ/เวชภัณฑ์ออกจากคลัง (FEFO/FIFO)', 'inventory'),
('inventory.adjust', 'ปรับยอดสต็อก/ตรวจนับประจำงวด', 'inventory')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, module = EXCLUDED.module;

-- ผูก Permissions เริ่มต้นให้กับ Roles ตามข้อกำหนด:
-- Admin: ทุกอย่าง
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.module = 'inventory'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Owner (เจ้าของฟาร์ม): read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'owner' AND p.key = 'inventory.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Head (หัวหน้าโรงเรือน): read + receive + issue + adjust + create + update
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'head' AND p.key IN (
  'inventory.read', 'inventory.receive', 'inventory.issue', 
  'inventory.adjust', 'inventory.create', 'inventory.update'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Worker (คนงาน): read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'worker' AND p.key = 'inventory.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 7. ผูก endpoint_permissions เริ่มต้นสำหรับระบบคลังสินค้า
INSERT INTO endpoint_permissions (method, path_pattern, permission_id) VALUES
('GET', '^/app/inventory$', (SELECT id FROM permissions WHERE key = 'inventory.read')),
('GET', '^/app/inventory/[0-9]+$', (SELECT id FROM permissions WHERE key = 'inventory.read')),
('GET', '^/api/inventory/summary$', (SELECT id FROM permissions WHERE key = 'inventory.read')),
('POST', '^/app/inventory$', (SELECT id FROM permissions WHERE key = 'inventory.create')),
('PUT', '^/app/inventory/[0-9]+$', (SELECT id FROM permissions WHERE key = 'inventory.update')),
('DELETE', '^/app/inventory/[0-9]+$', (SELECT id FROM permissions WHERE key = 'inventory.delete')),
('POST', '^/app/inventory/[0-9]+/receive$', (SELECT id FROM permissions WHERE key = 'inventory.receive')),
('POST', '^/app/inventory/[0-9]+/issue$', (SELECT id FROM permissions WHERE key = 'inventory.issue')),
('POST', '^/app/inventory/[0-9]+/adjust$', (SELECT id FROM permissions WHERE key = 'inventory.adjust'))
ON CONFLICT (method, path_pattern) DO NOTHING;

COMMIT;
