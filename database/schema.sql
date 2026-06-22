CREATE TABLE days (
  date_key TEXT PRIMARY KEY,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL REFERENCES days(date_key) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  asignado TEXT NOT NULL DEFAULT '',
  plano TEXT NOT NULL DEFAULT '' CHECK (plano IN ('', 'si', 'no')),
  referencia TEXT NOT NULL DEFAULT '',
  localidad TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '',
  entregado INTEGER NOT NULL DEFAULT 0 CHECK (entregado IN (0, 1))
);

CREATE INDEX idx_entries_date_key_order ON entries(date_key, sort_order);

CREATE TABLE vacations (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_vacations_start_end ON vacations(start_date, end_date);
