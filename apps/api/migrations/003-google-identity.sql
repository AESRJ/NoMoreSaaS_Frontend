-- 003: credenciales locales separadas, identidades externas (Google) e
-- intentos OIDC efímeros (entrega 006, ADR 0008). Se ejecuta dentro de la
-- transacción BEGIN IMMEDIATE de src/db.js; no incluir BEGIN/COMMIT. Un fallo
-- revierte toda la migración (incluida la copia de hashes y el DROP COLUMN).
-- Rollback de aplicación: no hay downgrade; restaurar la copia previa de la DB.

-- PasswordCredential: una por cuenta local; opcional para cuentas Google.
CREATE TABLE password_credentials (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL CHECK (password_hash GLOB '$argon2id$v=*')
) STRICT, WITHOUT ROWID;

-- Copia exacta de los hashes Argon2id existentes antes de retirar la columna.
INSERT INTO password_credentials (user_id, password_hash)
SELECT id, password_hash FROM users;

-- Conserva IDs, correos, created_at, el índice único de correo y las FK de
-- projects/sessions: no se reconstruye la tabla.
ALTER TABLE users DROP COLUMN password_hash;

-- ExternalIdentity: sub verificado por proveedor; nunca tokens del proveedor.
CREATE TABLE external_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z'),
  PRIMARY KEY (provider, subject)
) STRICT, WITHOUT ROWID;

-- MVP: un único vínculo por proveedor y usuario.
CREATE UNIQUE INDEX external_identities_user_provider ON external_identities (user_id, provider);

-- OAuthAttempt: transacción OIDC ligada a la presesión (SHA-256 del sid),
-- 5 minutos y un solo uso (consumo atómico con DELETE … RETURNING; no hay
-- columna "consumed"). state y nonce solo como SHA-256 hex; el verifier PKCE
-- es transitorio y se borra al consumir o expirar. Borrar la sesión borra
-- sus intentos.
CREATE TABLE oauth_attempts (
  state_hash TEXT NOT NULL PRIMARY KEY
    CHECK (length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  session_hash TEXT NOT NULL REFERENCES sessions (id_hash) ON DELETE CASCADE
    CHECK (length(session_hash) = 64 AND session_hash NOT GLOB '*[^0-9a-f]*'),
  nonce_hash TEXT NOT NULL
    CHECK (length(nonce_hash) = 64 AND nonce_hash NOT GLOB '*[^0-9a-f]*'),
  verifier TEXT NOT NULL
    CHECK (length(verifier) BETWEEN 43 AND 128 AND verifier NOT GLOB '*[^A-Za-z0-9._~-]*'),
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'link')),
  expected_user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  return_to TEXT NOT NULL CHECK (return_to IN ('projects', 'account')),
  CHECK ((purpose = 'login' AND expected_user_id IS NULL)
      OR (purpose = 'link' AND expected_user_id IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE INDEX oauth_attempts_expires_at ON oauth_attempts (expires_at);
CREATE INDEX oauth_attempts_session ON oauth_attempts (session_hash);
CREATE INDEX oauth_attempts_expected_user ON oauth_attempts (expected_user_id);
