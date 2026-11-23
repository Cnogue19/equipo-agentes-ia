-- Esquema de la base de datos (Neon Postgres). Idempotente: se puede ejecutar varias veces.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La web de cada usuario sobre la que trabajan los agentes (ficheros HTML/CSS/JS).
CREATE TABLE IF NOT EXISTS sites (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  files      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una ejecución = una petición del usuario procesada por el equipo de agentes.
CREATE TABLE IF NOT EXISTS runs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendiente',
  mode        TEXT NOT NULL DEFAULT 'ia',
  summary     TEXT,
  base_files  JSONB NOT NULL,
  files       JSONB NOT NULL,
  agents      JSONB NOT NULL,
  error       TEXT,
  steps       INT NOT NULL DEFAULT 0,
  lock_until  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS runs_user_idx ON runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id          BIGSERIAL PRIMARY KEY,
  run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx         INT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  criteria    JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendiente',
  assignee    TEXT,
  attempts    INT NOT NULL DEFAULT 0,
  feedback    JSONB,
  checks      JSONB,
  changed     JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_run_idx ON tasks(run_id, idx);

-- Registro de todo lo que hace cada agente (lo que se ve en pantalla).
CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  run_id     BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id    BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  agent      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  message    TEXT NOT NULL,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_run_idx ON events(run_id, id);
