-- One ERP reference per local trip; intentionally no uniqueness across trips.
ALTER TABLE viagens_v2 ADD COLUMN IF NOT EXISTS documento_erp JSONB;
