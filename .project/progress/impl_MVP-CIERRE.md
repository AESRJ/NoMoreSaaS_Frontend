# Implementación MVP-CIERRE (entrega 004)

## T001 — Catálogo vigente (2026-11-22, Claude)
- Seed `apps/api/data/catalog.json`: 5 SaaS (Google Drive, Google Fotos, Slack, Tailscale, Notion) y 5 alternativas con relación 1:1 (Nextcloud, Immich sin cambios; nuevas Matrix (Synapse), WireGuard, Outline). GitHub/Gitea/Forgejo retirados del seed; proyectos históricos se leen como `{id, name:null, available:false}` (código de projects sin cambios).
- Fuentes nuevas visitadas 2026-11-22 (HTTP 200): spec.matrix.org/latest, Synapse installation + README licencia (AGPL v3 o comercial); wireguard.com, /install, /quickstart, /known-limitations, wireguard-tools COPYING (GPL v2; sin RAM/CPU publicados); getoutline.com, requisitos/docker/file-storage de docs.getoutline.com, LICENSE (BSL 1.1, no open source, Document Service, cambio a Apache 2.0 2030-11-15). Dificultades como fuente `editorial`. Descripciones de SaaS: resúmenes neutrales sin fuente (como antes).
- `apps/api/src/catalog.js`: publica `open-source` y `source-available`; `unknown` sigue rechazada. Cobertura del seed sustituida: ≥5 servicios y ≥5 alternativas; eliminada la regla «un servicio con dos alternativas» (sin relaciones inventadas).
- Web: `LicenseBadge` muestra visible la clasificación si no es open source; portada dice «alternativas autoalojadas» en lugar de «código abierto»; placeholder sin Gitea.
- Fixtures/pruebas: `catalog.test.js` (5/5, source-available aceptada, unknown rechazada, seed exacto y retirados ausentes); `projects.test.js` nuevo caso proyecto histórico Gitea/Forgejo con seed real → no disponible, sustituible por WireGuard/Outline; `detail.test.jsx` etiqueta source-available; e2e `catalog.spec.js`/`identity.spec.js` adaptados al seed vigente.

Verificación (real):
- `pnpm --filter @nomoresaas/api exec vitest run tests/catalog.test.js tests/projects.test.js` → 2 archivos, 101/101 pasan (primera ejecución: 2 fallos en mis pruebas por fixture 3/4 con cobertura 5/5; corregidas).
- `pnpm --filter @nomoresaas/web exec vitest run tests/detail.test.jsx tests/catalog.test.jsx tests/compare.test.jsx` → 3 archivos, 31/31 pasan.
- `pnpm exec eslint` sobre los 9 archivos modificados → sin errores.
- NO ejecutado: Playwright (`API_PORT=3501 WEB_PORT=5773 pnpm exec playwright test tests/e2e/catalog.spec.js tests/e2e/identity.spec.js`) — permiso de ejecución denegado en la sesión. Los specs e2e editados quedan sin verificar; pendiente para revisión/T007.

## T002 — Perfil privado y documento workflow (2026-11-22, Claude)
- `apps/api/migrations/002-workflow.sql` (aditiva, sin tocar 001): `project_profiles` (13 campos de Profile + `updated_at`, CHECK con límites de data-model, FK cascade) y `project_progress` (fingerprint, JSON array ≤100, cascade) — esta última sin uso hasta T004.
- `apps/api/src/workflow.js`: `GET /api/projects/:id/workflow` → `{profile|null, evaluation:null, plan:null, progress:{completedStepIds:[], stale:false, updatedAt:null}}`; `PUT /api/projects/:id/profile` reemplazo completo validado (11 campos obligatorios, tipos estrictos, rechaza projectId/revision/ownerId/desconocidos), upsert en transacción `BEGIN IMMEDIATE`, revisión +1 solo si cambia el contenido normalizado. Montado dentro del router de proyectos (`projects.js`): misma sesión, no-store, Origin/tipo/parser/CSRF, propiedad por `id AND owner_id`, ajeno = 404 inexistente.
- `apps/api/src/errors.js`: `ApiError` admite `fields` opcional; la respuesta añade `error.fields` solo cuando existe (resto de errores sin cambios).
- `apps/api/tests/db.test.js`: expectativas a migraciones [1,2]; nueva prueba DB existente en 001 → aplica solo 2, conserva datos, idempotente, CHECK y cascada. `apps/api/tests/workflow.test.js` (10 casos): vacío, 401/400/404, persistencia tras reabrir la DB temporal, revisión estable/incrementada, 17 inválidos con campo exacto + obligatorio + varios, límites inclusivos, 403 CSRF/Origin, 415, dos usuarios aislados, cascada al borrar.

Verificación (real):
- `pnpm --filter @nomoresaas/api exec vitest run tests/workflow.test.js tests/db.test.js tests/projects.test.js` → 3 archivos, 82/82.
- `pnpm --filter @nomoresaas/api exec vitest run tests/security.test.js tests/api.test.js` → 2 archivos, 27/27 (cambio de errors.js sin regresión).
- `pnpm exec eslint apps/api/src apps/api/tests` → sin errores (tras corregir una variable sin uso en mi prueba); `workflow.test.js` reejecutado 10/10.
- No ejecutado: suite completa ni e2e (fuera del foco). La DB de preview 3301 NO se migró: al reiniciar ese API exigirá `pnpm db:migrate` (con respaldo previo, según plan).

### T002 — corrección tras revisión Codex (clave `__proto__`)
- Causa: `parseProfile` acumulaba errores en `{}`; asignar `fields['__proto__']` cambiaba el prototipo en vez de crear una clave propia, así que un cuerpo válido con `__proto__` extra se aceptaba.
- Corrección en `apps/api/src/workflow.js`: `fields = Object.create(null)`; `__proto__`/`constructor`/`prototype` se rechazan como «Campo no permitido.» igual que cualquier extra.
- Prueba nueva en `apps/api/tests/workflow.test.js`: para las tres claves, `JSON.parse` de un cuerpo crudo (clave propia comprobada) → `parseProfile` lanza VALIDATION_ERROR con `fields` = esa clave; vía HTTP con cuerpo JSON crudo → 400 con ese campo; sin contaminación de `Object.prototype` y 0 perfiles escritos.
- `pnpm --filter @nomoresaas/api exec vitest run tests/workflow.test.js tests/db.test.js` → 2 archivos, 39/39. `pnpm exec eslint apps/api/src/workflow.js apps/api/tests/workflow.test.js` → sin errores. No verifiqué la prueba contra el código anterior (no revertí el cambio).
