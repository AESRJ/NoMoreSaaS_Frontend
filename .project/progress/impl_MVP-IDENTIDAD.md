# Implementacion MVP-IDENTIDAD

Entrega003; constructor Claude, revision y commits Codex. Registrar por tarea solo archivos, comprobaciones y limites reales.

## T001 Persistencia y configuración (2026-11-21, Claude; pendiente de revisión Codex)

Archivos: `apps/api/src/config.js`, `apps/api/src/db.js`, `apps/api/migrations/001-identity.sql`, `apps/api/tests/db.test.js` (nuevos); `.env.example`, `.gitignore`, `package.json`, `apps/api/package.json` (modificados). Sin dependencias nuevas (`node:sqlite` integrado); lockfile y `apps/web` sin cambios; `app.js`/`server.js` sin tocar (auth no conectada).

- DB: `Database` de `node:sqlite`, pragmas journal DELETE, synchronous FULL, foreign_keys ON, busy_timeout 5000 verificados tras abrir. Ruta inválida o archivo no SQLite fallan con `DatabaseError`, sin memoria y sin modificar el archivo.
- Migraciones: `schema_migrations`, una transacción `BEGIN IMMEDIATE` por versión con su registro; rollback completo si falla; idempotente; versión desconocida en DB detiene (sin downgrade).
- Esquema: `users` (UUID, email normalizado UNIQUE, hash `$argon2id$v=`, fecha UTC), `sessions` (`id_hash` SHA-256 hex, payload JSON objeto, `expires_at` ms epoch, índice), `projects` (FK owner RESTRICT, nombre 3–80 y descripción ≤1000 en puntos Unicode, fechas, índice owner/updated_at DESC/id, trigger de cupo 100 `PROJECT_QUOTA_EXCEEDED`), `project_selections` (FK CASCADE, posición 0–9, UNIQUE posición y alternativa por proyecto, sin FK al catálogo).
- Config: `DATABASE_PATH` vacío → `apps/api/.local/data/nomoresaas.sqlite`; si se define, absoluta, no `:memory:`/URI, nunca bajo `dist`/`public` y dentro del repo solo bajo `.local`. `loadConfig` exige `SESSION_SECRET` ≥32 bytes (sin revelarlo en errores) y `APP_ORIGIN` exacto, http solo loopback; `cookieSecure` se deriva del protocolo. Aún no se usa en el servidor (T002).
- `pnpm db:migrate` → `node --env-file-if-exists=../../.env src/db.js`; crea la carpeta solo para la ruta por defecto. `.gitignore` añade `*.sqlite`, `*.sqlite-journal`, `*.sqlite3`, `*.db`, `*.db-journal`.
- Node fijado en `engines` a `26.13.1` (raíz y API); CI ya usa 26.13.1.

Verificación (Node 26.13.1, pnpm 12.21.0):
- `pnpm --filter @nomoresaas/api exec vitest run tests/db.test.js` → 27/27 OK.
- `pnpm test` → API 107/107 (4 archivos), web 56/56 (6 archivos).
- `pnpm lint` → código 0, sin avisos. `pnpm build` → OK.
- `pnpm install --frozen-lockfile --offline` → lockfile al día.
- CLI real `src/db.js` vía `spawnSync` con `DATABASE_PATH` temporal: 1ª ejecución rc=0 aplica 1; 2ª rc=0 sin pendientes; relativa, carpeta inexistente y `:memory:` rc=1 con mensaje y sin crear carpetas. Temporal borrado.

Límites: no se ejecutó `pnpm db:migrate` sobre la ruta por defecto para no crear una DB de desarrollador; no se ejecutaron `pnpm test:e2e` ni `init.cmd` (T001 no toca servidor ni web; quedan para T006). El script `check-prerequisites.ps1` de Spec Kit y `git check-ignore` requerían aprobación no disponible; los artefactos se leyeron manualmente y el validador `check_handoff.py --implementation-ready` dio OK. Queda en `%TEMP%\probe-*` un directorio de sondeo propio (dos archivos SQLite de prueba) que no pude borrar sin aprobación. SQLite `trim()`/`lower()` solo cubren espacios/ASCII: la normalización completa de correo y textos corresponde a la validación de la API (T002/T004).

Revision Codex T001 aceptada: diff de configuracion/esquema/migracion revisado; lint y107 pruebas API independientes correctos. Sin nuevos fallos bloqueantes. No ejecutar DB del desarrollador.
