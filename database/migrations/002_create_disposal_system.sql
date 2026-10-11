-- Migration: เพิ่มประเภทการทำลายสินค้าหมดอายุ (dispose / waste)
-- อนุญาตให้ stock_transactions.type มีค่า 'dispose' เพิ่มเติม
ALTER TABLE stock_transactions DROP CONSTRAINT IF EXISTS stock_transactions_type_check;
ALTER TABLE stock_transactions ADD CONSTRAINT stock_transactions_type_check 
  CHECK (type IN ('receive', 'issue', 'adjust', 'dispose'));

-- สร้างตาราง disposal_records สำหรับเก็บบันทึกประวัติและหลักฐานการทำลายสินค้าหมดอายุโดยละเอียด
CREATE TABLE IF NOT EXISTS disposal_records (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  batch_id INTEGER NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  qty NUMERIC(12, 2) NOT NULL CHECK (qty > 0),
  reason TEXT NOT NULL,
  disposal_method VARCHAR(100) NOT NULL, -- เช่น ฝังกลบ, เผาทำลาย, ส่งกำจัดขยะอันตราย/ติดเชื้อ
  witness_name VARCHAR(100),            -- พยานผู้ร่วมตรวจสอบการทำลาย
  disposed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  disposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'completed', -- บันทึกสถานะว่าทำลายแล้ว (completed)
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_disposal_item_id ON disposal_records (item_id);
CREATE INDEX IF NOT EXISTS idx_disposal_batch_id ON disposal_records (batch_id);
CREATE INDEX IF NOT EXISTS idx_disposal_at ON disposal_records (disposed_at);

-- เพิ่ม Permission inventory.dispose
INSERT INTO permissions (key, description, module) 
VALUES ('inventory.dispose', 'บันทึกทำลายสินค้าและเวชภัณฑ์หมดอายุ', 'inventory')
ON CONFLICT (key) DO NOTHING;

-- กำหนดสิทธิ์ inventory.dispose ให้กับ admin และ owner
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('admin', 'owner') AND p.key = 'inventory.dispose'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ผูก Endpoint กับ Permission ใน endpoint_permissions
INSERT INTO endpoint_permissions (method, path_pattern, permission_id)
SELECT 'POST', '^/app/inventory/[0-9]+/dispose$', p.id
FROM permissions p
WHERE p.key = 'inventory.dispose'
ON CONFLICT (method, path_pattern) DO NOTHING;

INSERT INTO endpoint_permissions (method, path_pattern, permission_id)
SELECT 'GET', '^/app/inventory/disposal/history$', p.id
FROM permissions p
WHERE p.key = 'inventory.read'
ON CONFLICT (method, path_pattern) DO NOTHING;
