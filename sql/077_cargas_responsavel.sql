-- Keep the historical salesperson separate from the ERP freight owner.
ALTER TABLE cargas_v2 ADD COLUMN IF NOT EXISTS responsavel_erp JSONB;
