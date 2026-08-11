BEGIN;

CREATE TABLE IF NOT EXISTS appointments_accounting (
  id BIGSERIAL PRIMARY KEY,
  calendar_event_id TEXT NOT NULL UNIQUE,
  appointment_date DATE NOT NULL,
  appointment_start_time TIME,
  customer_first_name TEXT NOT NULL,
  customer_last_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  booked_service_name TEXT NOT NULL,
  booked_service_amount_cents INTEGER NOT NULL CHECK (booked_service_amount_cents >= 0),
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CHF' CHECK (currency = 'CHF'),
  accounting_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (accounting_status IN ('confirmed', 'reversed')),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_accounting_date
  ON appointments_accounting (appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_accounting_status_date
  ON appointments_accounting (accounting_status, appointment_date);

CREATE TABLE IF NOT EXISTS appointment_items (
  id BIGSERIAL PRIMARY KEY,
  appointment_accounting_id BIGINT NOT NULL REFERENCES appointments_accounting(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('booked', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_items_appointment
  ON appointment_items (appointment_accounting_id);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'CHF' CHECK (currency = 'CHF'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date
  ON expenses (expense_date);

COMMIT;
