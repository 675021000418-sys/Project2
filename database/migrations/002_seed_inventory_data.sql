-- สคริปต์ Seed ตัวอย่างสำหรับคลังวัสดุและเวชภัณฑ์
-- คำสั่งรัน: psql -U postgres -d farm_db -f database/migrations/002_seed_inventory_data.sql

BEGIN;

-- 1. เพิ่ม Items 9 รายการ (อาหารสัตว์ 3, ยาปฏิชีวนะ 3, วัคซีน 3)
INSERT INTO items (item_code, name, category, base_unit, alt_unit, unit_factor, reorder_point, unit_cost, storage_note, is_active)
VALUES
-- อาหารสัตว์ (feed)
('FEED-001', 'อาหารไก่ไข่ระยะให้ผลผลิต (Layer Feed)', 'feed', 'กระสอบ (30 กก.)', 'กก.', 30.00, 20.00, 480.00, 'เก็บในที่แห้ง อากาศถ่ายเทสะดวก พ้นจากแสงแดดและความชื้น', TRUE),
('FEED-002', 'อาหารสุกรขุนรุ่น 3 (Swine Grower Feed)', 'feed', 'กระสอบ (30 กก.)', 'กก.', 30.00, 15.00, 520.00, 'เก็บในที่แห้ง ยกสูงจากพื้นอย่างน้อย 15 ซม.', TRUE),
('FEED-003', 'หัวอาหารสัตว์ผสมพรีมิกซ์ (Mineral Premix)', 'feed', 'ถุง (10 กก.)', 'กก.', 10.00, 5.00, 750.00, 'เก็บในที่ร่ม อุณหภูมิห้อง ปิดปากถุงให้สนิททุกครั้งหลังเปิด', TRUE),

-- ยาปฏิชีวนะ (antibiotic)
('MED-001', 'Amoxicillin 20% Soluble Powder', 'antibiotic', 'ขวด (500 กรัม)', 'กรัม', 500.00, 10.00, 650.00, 'เก็บในที่แห้ง อุณหภูมิต่ำกว่า 30°C ป้องกันแสงแดด', TRUE),
('MED-002', 'Enrofloxacin 10% Oral Solution', 'antibiotic', 'ขวด (1 ลิตร)', 'มล.', 1000.00, 8.00, 920.00, 'เก็บในที่มิดชิด พ้นแสงแดด อุณหภูมิห้อง', TRUE),
('MED-003', 'Oxytetracycline 20% LA Injectable', 'antibiotic', 'ขวด (100 มล.)', 'มล.', 100.00, 12.00, 380.00, 'เก็บที่อุณหภูมิห้อง 15-25°C ห้ามแช่แข็ง', TRUE),

-- วัคซีน (vaccine)
('VAC-001', 'วัคซีนป้องกันโรคนิวคาสเซิลและหลอดลมอักเสบ (ND+IB)', 'vaccine', 'ขวด (1000 โดส)', 'โดส', 1000.00, 10.00, 450.00, 'เก็บในตู้เย็นอุณหภูมิ 2-8°C อย่างเคร่งครัด ห้ามแช่แข็ง', TRUE),
('VAC-002', 'วัคซีนป้องกันโรคอหิวาต์สุกร (CSF Vaccine)', 'vaccine', 'ขวด (50 โดส)', 'โดส', 50.00, 6.00, 820.00, 'เก็บในตู้เย็นอุณหภูมิ 2-8°C และหลีกเลี่ยงแสง', TRUE),
('VAC-003', 'วัคซีนกัมโบโรเชื้อเป็น (IBD Live Vaccine)', 'vaccine', 'ขวด (1000 โดส)', 'โดส', 1000.00, 8.00, 510.00, 'เก็บในตู้เย็น 2-8°C และตรวจสอบ cold chain อย่างสม่ำเสมอ', TRUE)
ON CONFLICT (item_code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  base_unit = EXCLUDED.base_unit,
  reorder_point = EXCLUDED.reorder_point,
  unit_cost = EXCLUDED.unit_cost,
  storage_note = EXCLUDED.storage_note;

-- ดึง User ID สำหรับบันทึกธุรกรรมเริ่มต้น (head1 หรือ admin)
DO $$
DECLARE
  v_user_id INTEGER;
  -- Item IDs
  v_feed1 INTEGER; v_feed2 INTEGER; v_feed3 INTEGER;
  v_med1 INTEGER; v_med2 INTEGER; v_med3 INTEGER;
  v_vac1 INTEGER; v_vac2 INTEGER; v_vac3 INTEGER;

  -- Batch ID ตัวแปรชั่วคราว
  v_batch_id INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE username = 'head1';
  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id FROM users WHERE username = 'admin';
  END IF;

  SELECT id INTO v_feed1 FROM items WHERE item_code = 'FEED-001';
  SELECT id INTO v_feed2 FROM items WHERE item_code = 'FEED-002';
  SELECT id INTO v_feed3 FROM items WHERE item_code = 'FEED-003';
  SELECT id INTO v_med1 FROM items WHERE item_code = 'MED-001';
  SELECT id INTO v_med2 FROM items WHERE item_code = 'MED-002';
  SELECT id INTO v_med3 FROM items WHERE item_code = 'MED-003';
  SELECT id INTO v_vac1 FROM items WHERE item_code = 'VAC-001';
  SELECT id INTO v_vac2 FROM items WHERE item_code = 'VAC-002';
  SELECT id INTO v_vac3 FROM items WHERE item_code = 'VAC-003';

  -- ลบข้อมูลเก่าใน batches และ transactions เพื่อให้ seed สะอาดและถูกต้อง
  DELETE FROM stock_transactions;
  DELETE FROM inventory_batches;

  --------------------------------------------------------------------------------
  -- 1) FEED-001: มี 2 ล็อต (FIFO สาธิต: ล็อตเก่ารับก่อน vs ล็อตใหม่รับทีหลัง)
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_feed1, 'LOT-F1-OLD', '2026-08-01', '2027-02-01', '2026-08-10', 50, 15, 'ซีพีเอฟ ฟีดมิลล์', 'ล็อตเก่า รับมาก่อน')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_feed1, v_batch_id, 'receive', 50, 15, v_user_id, 'ยอดยกมาเริ่มต้น');

  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_feed1, 'LOT-F1-NEW', '2026-09-15', '2027-03-15', '2026-09-20', 40, 40, 'ซีพีเอฟ ฟีดมิลล์', 'ล็อตใหม่ รับมาทีหลัง')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_feed1, v_batch_id, 'receive', 40, 40, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 2) FEED-002: สต็อกต่ำกว่า reorder_point (reorder_point=15, มีเหลือ 8)
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_feed2, 'LOT-F2-LOW', '2026-08-01', '2027-02-01', '2026-08-05', 20, 8, 'เบทาโกร ฟีด', 'ล็อตใกล้หมด สต็อกต่ำกว่าเกณฑ์')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_feed2, v_batch_id, 'receive', 20, 8, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 3) FEED-003: สต็อกปกติ ไม่มีวันหมดอายุ
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_feed3, 'LOT-F3-STD', '2026-09-01', NULL, '2026-09-05', 25, 25, 'ไทยพรีมิกซ์ จำกัด', 'หัวอาหารผสมพรีมิกซ์')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_feed3, v_batch_id, 'receive', 25, 25, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 4) MED-001 (ยาปฏิชีวนะ): มี 2 ล็อตปกติ วันหมดอายุต่างกัน เพื่อทดสอบ FEFO (ก)
  -- ล็อต A: หมดอายุ 2026-12-15 (หมดก่อน)
  -- ล็อต B: หมดอายุ 2027-06-30 (หมดทีหลัง)
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_med1, 'LOT-M1-FEFO-EARLY', '2025-12-01', '2026-12-15', '2026-01-10', 20, 10, 'เวทเมดิคอล สยาม', 'ล็อตหมดอายุก่อน (ต้องตัดล็อตนี้ก่อน)')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_med1, v_batch_id, 'receive', 20, 10, v_user_id, 'ยอดยกมาเริ่มต้น');

  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_med1, 'LOT-M1-FEFO-LATER', '2026-06-01', '2027-06-30', '2026-07-01', 30, 25, 'เวทเมดิคอล สยาม', 'ล็อตหมดอายุทีหลัง')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_med1, v_batch_id, 'receive', 30, 25, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 5) MED-002 (ยาปฏิชีวนะ): มีล็อตหมดอายุแล้ว (จงใจสร้าง) เพื่อทดสอบกติกาข้ามล็อตหมดอายุ (ค)
  --------------------------------------------------------------------------------
  -- ล็อตหมดอายุแล้ว (เช่น หมดอายุเมื่อเดือนที่แล้ว)
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_med2, 'LOT-M2-EXPIRED', '2024-08-01', CURRENT_DATE - INTERVAL '15 days', '2024-09-01', 15, 15, 'อินเตอร์เวท ฟาร์มา', 'ล็อตนี้หมดอายุแล้ว ห้ามตัดออกไปใช้')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_med2, v_batch_id, 'receive', 15, 15, v_user_id, 'ยอดยกมาเริ่มต้น');

  -- ล็อตปกติที่ใช้ได้
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_med2, 'LOT-M2-VALID', '2026-05-01', '2027-05-01', '2026-06-01', 20, 18, 'อินเตอร์เวท ฟาร์มา', 'ล็อตปกติพร้อมใช้งาน')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_med2, v_batch_id, 'receive', 20, 18, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 6) MED-003 (ยาปฏิชีวนะ): ใกล้หมดอายุ (<30 วัน)
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_med3, 'LOT-M3-NEAR-EXP', '2024-11-01', CURRENT_DATE + INTERVAL '12 days', '2024-11-20', 25, 14, 'ไบโอฟาร์ม เวท', 'ล็อตใกล้หมดอายุภายใน 12 วัน')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_med3, v_batch_id, 'receive', 25, 14, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 7) VAC-001 (วัคซีน ND+IB): 2 ล็อต FEFO
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_vac1, 'LOT-V1-EXP-DEC', '2026-03-01', '2026-11-25', '2026-04-01', 20, 8, 'แวคซีนแล็บ สากล', 'ล็อตหมดอายุ พ.ย. 2026')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_vac1, v_batch_id, 'receive', 20, 8, v_user_id, 'ยอดยกมาเริ่มต้น');

  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_vac1, 'LOT-V1-EXP-MAR', '2026-06-01', '2027-03-30', '2026-07-01', 30, 30, 'แวคซีนแล็บ สากล', 'ล็อตหมดอายุ มี.ค. 2027')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_vac1, v_batch_id, 'receive', 30, 30, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 8) VAC-002 (วัคซีนอหิวาต์สุกร): สต็อกต่ำ + ใกล้หมดอายุ
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_vac2, 'LOT-V2-CRITICAL', '2025-10-01', CURRENT_DATE + INTERVAL '18 days', '2025-10-20', 10, 4, 'สถาบันสุขภาพสัตว์', 'ล็อตใกล้หมดอายุและสต็อกต่ำกว่าเกณฑ์')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_vac2, v_batch_id, 'receive', 10, 4, v_user_id, 'ยอดยกมาเริ่มต้น');

  --------------------------------------------------------------------------------
  -- 9) VAC-003 (วัคซีนกัมโบโร): สต็อกปกติ
  --------------------------------------------------------------------------------
  INSERT INTO inventory_batches (item_id, lot_no, mfg_date, exp_date, received_date, qty_received, qty_remaining, supplier, note)
  VALUES (v_vac3, 'LOT-V3-HEALTHY', '2026-08-01', '2027-08-01', '2026-08-15', 25, 25, 'สยามแวคซีน เทค', 'ล็อตสภาพสมบูรณ์')
  RETURNING id INTO v_batch_id;
  INSERT INTO stock_transactions (item_id, batch_id, type, qty, balance_after, performed_by, note)
  VALUES (v_vac3, v_batch_id, 'receive', 25, 25, v_user_id, 'ยอดยกมาเริ่มต้น');

END $$;

COMMIT;
