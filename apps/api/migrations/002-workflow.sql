-- 002: perfil de equipo y avance del flujo por proyecto (entrega 004).
-- Aditiva: no modifica ni borra tablas de 001. Se ejecuta dentro de la
-- transacción de src/db.js; no incluir BEGIN/COMMIT. Límites del prototipo
-- (data-model.md 004), no mínimos oficiales. Rollback de aplicación: conservar
-- estas tablas; sin DROP automático.

-- Profile: una fila por proyecto, borrada en cascada con él. El propietario
-- se obtiene del proyecto; nunca se guarda aquí.
CREATE TABLE project_profiles (
  project_id TEXT NOT NULL PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  cpu_cores INTEGER NOT NULL CHECK (cpu_cores BETWEEN 1 AND 256),
  ram_gib REAL NOT NULL CHECK (ram_gib BETWEEN 0.5 AND 4096),
  storage_gib REAL NOT NULL CHECK (storage_gib BETWEEN 1 AND 100000),
  os TEXT NOT NULL CHECK (os IN ('linux', 'windows', 'macos', 'unknown')),
  architecture TEXT NOT NULL CHECK (architecture IN ('amd64', 'arm64', 'unknown')),
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('ssd', 'hdd', 'network', 'unknown')),
  users INTEGER NOT NULL CHECK (users BETWEEN 1 AND 10000),
  data_gib REAL NOT NULL CHECK (data_gib BETWEEN 0 AND 100000),
  access TEXT NOT NULL CHECK (access IN ('local', 'internet')),
  has_domain INTEGER NOT NULL CHECK (has_domain IN (0, 1)),
  cpu_features_known INTEGER NOT NULL CHECK (cpu_features_known IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z')
) STRICT, WITHOUT ROWID;

-- Progress: pasos marcados para una versión (fingerprint) del plan. Solo IDs
-- y marcas de tiempo; nunca prompts ni credenciales. Lo usa el plan (T004).
CREATE TABLE project_progress (
  project_id TEXT NOT NULL PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 128),
  completed_step_ids TEXT NOT NULL
    CHECK (json_valid(completed_step_ids) AND json_type(completed_step_ids) = 'array'
      AND json_array_length(completed_step_ids) <= 100),
  updated_at TEXT NOT NULL
    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z')
) STRICT, WITHOUT ROWID;
