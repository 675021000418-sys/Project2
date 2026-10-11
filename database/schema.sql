-- สร้างฐานข้อมูล farm_db
-- รันคำสั่ง: createdb farm_db
-- แล้วรัน: psql -U postgres -d farm_db -f database/schema.sql

-- ตาราง session สำหรับ connect-pg-simple
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

-- ตาราง roles (บทบาท)
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ตาราง permissions (สิทธิ์)
CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  module VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ตาราง role_permissions (ผูกบทบาทกับสิทธิ์)
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ตาราง users (ผู้ใช้)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users (role_id);

-- ตาราง houses (โรงเรือน)
CREATE TABLE IF NOT EXISTS houses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  animal_type VARCHAR(50),
  capacity INTEGER,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_houses_status ON houses (status);

-- ตาราง user_houses (ผู้ใช้สังกัดโรงเรือนไหน)
CREATE TABLE IF NOT EXISTS user_houses (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  house_id INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, house_id)
);

-- ตาราง items (คลังวัสดุและเวชภัณฑ์)
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
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_is_active ON items (is_active);
CREATE INDEX IF NOT EXISTS idx_items_item_code ON items (item_code);

-- ตาราง inventory_batches (ล็อตสินค้า)
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
CREATE INDEX IF NOT EXISTS idx_batches_item_id ON inventory_batches (item_id);
CREATE INDEX IF NOT EXISTS idx_batches_exp_date ON inventory_batches (exp_date);
CREATE INDEX IF NOT EXISTS idx_batches_received_date ON inventory_batches (received_date);
CREATE INDEX IF NOT EXISTS idx_batches_qty_remaining ON inventory_batches (qty_remaining);

-- Constraint เช็คกติกา lot_no และ exp_date สำหรับ antibiotic และ vaccine
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

-- ตาราง stock_transactions (บันทึกธุรกรรมสต็อก - ลบไม่ได้ ห้าม UPDATE)
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
CREATE INDEX IF NOT EXISTS idx_tx_item_id ON stock_transactions (item_id);
CREATE INDEX IF NOT EXISTS idx_tx_batch_id ON stock_transactions (batch_id);
CREATE INDEX IF NOT EXISTS idx_tx_created_at ON stock_transactions (created_at);

-- Trigger ป้องกัน UPDATE/DELETE บน stock_transactions
CREATE OR REPLACE FUNCTION prevent_stock_transaction_modifications()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ตาราง stock_transactions เป็นบันทึกประวัติถาวร ไม่อนุญาตให้แก้ไขหรือลบ';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_stock_tx_mod ON stock_transactions;
CREATE TRIGGER trg_prevent_stock_tx_mod
BEFORE UPDATE OR DELETE ON stock_transactions
FOR EACH ROW
EXECUTE FUNCTION prevent_stock_transaction_modifications();

-- View v_item_stock
CREATE OR REPLACE VIEW v_item_stock AS
WITH batch_aggregates AS (
  SELECT 
    b.item_id,
    COALESCE(SUM(CASE WHEN b.exp_date IS NULL OR b.exp_date >= CURRENT_DATE THEN b.qty_remaining ELSE 0 END), 0) AS total_usable_stock,
    COALESCE(SUM(b.qty_remaining), 0) AS total_physical_stock,
    COALESCE(SUM(CASE WHEN b.exp_date IS NOT NULL AND b.exp_date < CURRENT_DATE THEN b.qty_remaining ELSE 0 END), 0) AS expired_stock,
    COALESCE(SUM(CASE WHEN b.exp_date IS NOT NULL AND b.exp_date >= CURRENT_DATE AND b.exp_date <= (CURRENT_DATE + INTERVAL '30 days') THEN b.qty_remaining ELSE 0 END), 0) AS near_exp_stock,
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

-- View สำหรับความเข้ากันได้ย้อนหลังกับ supply_items เดิม
CREATE OR REPLACE VIEW supply_items AS
SELECT 
  id,
  name,
  CASE WHEN category = 'antibiotic' THEN 'medicine' ELSE category END AS category,
  base_unit AS unit,
  total_usable_stock::INTEGER AS stock_qty,
  reorder_point::INTEGER AS min_qty,
  image_file_id,
  created_at
FROM v_item_stock;

-- ตาราง supply_requests (คำขอเบิกวัสดุ)
CREATE TABLE IF NOT EXISTS supply_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  house_id INTEGER REFERENCES houses(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  qty NUMERIC(12, 2) NOT NULL CHECK (qty > 0),
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'dispensed', 'completed', 'cancelled')),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approve_note TEXT,
  dispensed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supply_requests_requester_id ON supply_requests (requester_id);
CREATE INDEX IF NOT EXISTS idx_supply_requests_house_id ON supply_requests (house_id);
CREATE INDEX IF NOT EXISTS idx_supply_requests_status ON supply_requests (status);
CREATE INDEX IF NOT EXISTS idx_supply_requests_created_at ON supply_requests (created_at);

-- ตาราง usage_records (บันทึกการใช้วัสดุ)
CREATE TABLE IF NOT EXISTS usage_records (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES supply_requests(id) ON DELETE CASCADE,
  used_qty INTEGER NOT NULL CHECK (used_qty > 0),
  note TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_records_request_id ON usage_records (request_id);

-- ตาราง files (ไฟล์ที่อัปโหลด)
CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) UNIQUE NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  ref_type VARCHAR(50),
  ref_id INTEGER,
  is_restricted BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_files_ref ON files (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_files_stored_name ON files (stored_name);

-- ตาราง endpoint_permissions (ผูก Permission กับ Endpoint)
CREATE TABLE IF NOT EXISTS endpoint_permissions (
  id SERIAL PRIMARY KEY,
  method VARCHAR(10) NOT NULL,
  path_pattern VARCHAR(200) NOT NULL,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (method, path_pattern)
);
CREATE INDEX IF NOT EXISTS idx_endpoint_permissions_pattern ON endpoint_permissions (path_pattern);

-- ตาราง audit_logs (บันทึกการกระทำ)
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username_attempted VARCHAR(50),
  event_type VARCHAR(50) NOT NULL,
  resource VARCHAR(100),
  resource_id INTEGER,
  result VARCHAR(20) NOT NULL CHECK (result IN ('success', 'fail', 'denied')),
  ip VARCHAR(45),
  detail JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_result ON audit_logs (result);
