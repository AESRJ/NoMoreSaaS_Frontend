# Implementación AUTH-GOOGLE (006-acceso-google)

## T001 — migración 003 y repositorio de cuentas (Claude, 2026-11-22)
Archivos:
- `apps/api/migrations/003-google-identity.sql` (nuevo): `password_credentials` (PK/FK users ON DELETE CASCADE, CHECK Argon2id), `INSERT … SELECT` exacto desde `users.password_hash`, `ALTER TABLE users DROP COLUMN password_hash` (sin reconstruir users), `external_identities` (PK provider+subject, provider∈{google}, subject 1–255, UNIQUE user+provider, FK CASCADE, sin tokens), `oauth_attempts` (state_hash PK hex64, session_hash FK sessions CASCADE, nonce_hash hex64, verifier PKCE 43–128 caracteres no reservados, purpose login|link coherente con expected_user_id, expires_at, return_to projects|account; consumo por DELETE … RETURNING, sin columna consumed; índices por expiración/sesión/usuario).
- `apps/api/src/identities.js` (nuevo): `createAccountStore` con findLocalByEmail (INNER JOIN credencial), passwordHashOf, createLocalUser y createUserWithIdentity transaccionales, findUserByIdentity (por sub, nunca correo), linkIdentity (idempotente; IdentityConflictError sin mutación), providersOf.
- `apps/api/src/auth.js`: registro/login usan el repositorio; cuenta sin credencial local → mismo verifyDummy y 401 genérico. Origin/CSRF/límites/sesión sin cambios.
- Pruebas: `tests/db.test.js` (003 desde DB real en 002 con 2 usuarios/proyectos/perfil/progreso/sesión: hashes idénticos, columnas, integrity/foreign_key_check, restricciones previas; rollback completo de 003 rota y reintento; cascadas usuario/sesión; restricciones de identidades e intentos; consumo de un solo uso), `tests/identities.test.js` (nuevo), `tests/auth.test.js` (hash en password_credentials; cuenta solo-Google 401 genérico y 409 en registro; cuenta pre-003 entra tras migrar con mismo UUID y Argon2 real), comentario en `tests/projects.test.js`.

Comandos y resultados:
- `pnpm --filter @nomoresaas/api exec vitest run tests/db.test.js tests/identities.test.js tests/auth.test.js tests/projects.test.js` → 4 archivos, 144/144.
- `pnpm --filter @nomoresaas/api exec vitest run` → 10 archivos, 274/274.
- `pnpm lint` → OK.
- `python tools/check_handoff.py --implementation-ready .project/handoffs/006-acceso-google.json` → OK.

Límites: solo DB temporales de pruebas; no se migró la DB local ni preview 3301/5573. Sin endpoints OIDC, dependencias ni UI (T002+). Repositorio de intentos OIDC queda para T002. Sin git add/commit.
