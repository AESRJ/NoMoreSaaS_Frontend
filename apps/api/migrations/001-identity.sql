-- 001: cuentas, sesiones persistentes y proyectos privados.
-- Se ejecuta dentro de una transacción gestionada por src/db.js; no incluir
-- BEGIN/COMMIT aquí. Los UUID se generan en el servidor (minúsculas) y las
-- fechas son UTC ISO 8601 con sufijo Z.

CREATE TABLE users (
  id TEXT NOT NULL PRIMARY KEY
    CHECK (length(id) = 36
      AND id GLOB '????????-????-????-????-????????????'
      AND id NOT GLOB '*[^0-9a-f-]*'),
  email TEXT NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254
      AND email = lower(trim(email))
      AND instr(email, ' ') = 0
      AND instr(email, char(9)) = 0
      AND instr(email, char(10)) = 0
      AND instr(email, char(13)) = 0
      AND email GLOB '?*@?*.?*'),
  password_hash TEXT NOT NULL CHECK (password_hash GLOB '$argon2id$v=*'),
  created_at TEXT NOT NULL
    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z')
) STRICT;

CREATE UNIQUE INDEX users_email_unique ON users (email);

-- id_hash = SHA-256 hexadecimal del sid; nunca la cookie completa.
-- expires_at = milisegundos UTC desde epoch.
CREATE TABLE sessions (
  id_hash TEXT NOT NULL PRIMARY KEY
    CHECK (length(id_hash) = 64 AND id_hash NOT GLOB '*[^0-9a-f]*'),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0)
) STRICT, WITHOUT ROWID;

CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE projects (
  id TEXT NOT NULL PRIMARY KEY
    CHECK (length(id) = 36
      AND id GLOB '????????-????-????-????-????????????'
      AND id NOT GLOB '*[^0-9a-f-]*'),
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 80 AND name = trim(name)),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000 AND description = trim(description)),
  created_at TEXT NOT NULL
    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z'),
  updated_at TEXT NOT NULL
    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z'
      AND updated_at >= created_at)
) STRICT;

-- Listado propio: updatedAt descendente, id ascendente como desempate.
CREATE INDEX projects_owner_updated ON projects (owner_id, updated_at DESC, id);

-- Cupo de 100 proyectos por cuenta, comprobado dentro de la misma transacción
-- de escritura para que la concurrencia no lo sobrepase.
CREATE TRIGGER projects_owner_quota
BEFORE INSERT ON projects
WHEN (SELECT count(*) FROM projects WHERE owner_id = NEW.owner_id) >= 100
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_QUOTA_EXCEEDED');
END;

-- Project.alternativeIds: selección ordenada de 1 a 10 IDs únicos del catálogo.
-- Sin FK al catálogo JSON: las alternativas retiradas se conservan.
CREATE TABLE project_selections (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  alternative_id TEXT NOT NULL
    CHECK (length(alternative_id) BETWEEN 1 AND 80
      AND alternative_id NOT GLOB '*[^a-z0-9-]*'
      AND alternative_id NOT GLOB '-*'
      AND alternative_id NOT GLOB '*-'
      AND alternative_id NOT GLOB '*--*'),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
  PRIMARY KEY (project_id, position),
  UNIQUE (project_id, alternative_id)
) STRICT, WITHOUT ROWID;
