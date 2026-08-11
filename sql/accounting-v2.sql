BEGIN;

CREATE TABLE IF NOT EXISTS accounting_audit_log (
  id BIGSERIAL PRIMARY KEY,
  appointment_accounting_id BIGINT REFERENCES appointments_accounting(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('corrected','reversed','restored')),
  reason TEXT,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS accounting_audit_log_appointment_idx ON accounting_audit_log(appointment_accounting_id, created_at DESC);

CREATE TABLE IF NOT EXISTS expense_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO expense_categories(name) VALUES
 ('Matériel'),('Produits'),('Loyer'),('Formation'),('Publicité'),('Équipement'),('Frais administratifs'),('Autre')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_name TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMIT;