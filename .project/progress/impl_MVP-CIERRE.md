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

## T003 — Reglas versionadas y evaluación (2026-11-22, Claude)
- `apps/api/data/requirements.json` (`rulesVersion` 2026-11-22.1): presupuestos editoriales exactos de data-model (Nextcloud 2/2/4, Immich 8/4/10, Synapse 2/2/4, WireGuard 0,25/1/0,25, Outline 2/2/4 GiB/núcleos/GiB), margen RAM 25 %, datos ×1,25, paso de carga 10 usuarios; por alternativa resumen oficial con fuentes oficiales fechadas (separadas de la fuente editorial) y reglas de plataforma/almacenamiento/CPU/red/dominio/notas. Fuentes: catálogo T001 y research.md 004 (Immich x86-64-v2 tomado de research.md, no revisitado).
- `apps/api/src/evaluation.js`: `validateRules`/`loadRules` (al arrancar, congeladas) y `evaluate` determinista → `{status, rulesVersion, checkedAt, editorialSource, items, totals, warnings}`. RAM = Σbase × techo(users/10 si >10) × 1,25; CPU = Σ núcleos × factor (sin garantía de concurrencia); disco = Σbase + datos × 1,25 (una vez); ecuaciones textuales con números y unidades. Avisos con severidad blocking/pending/info: insuficiencia RAM/CPU/disco primero; SO/arquitectura/almacenamiento desconocidos, retirada, sin reglas, dominio/HTTPS, UDP WireGuard, CPU x86-64-v2, proveedor auth Outline → pendiente; Outline en Windows → bloqueo. status = insufficient si hay bloqueo, pending si hay pendiente, viable solo sin ambos; siempre aviso «estimación orientativa, no garantiza». Sin persistencia: se recalcula en cada respuesta.
- Integración: `workflow.js` incluye `evaluation` en GET workflow y PUT profile (null sin perfil; plan null y avance vacío hasta T004); `projects.js` inyecta nombres de catálogo y reglas (`rules` opcional, por defecto las publicadas).
- Pruebas: nueva `apps/api/tests/evaluation.test.js` (11 casos con reglas y seed reales: reproducibilidad y ecuación exacta, viable con descargo, insuficiente con orden de motivos, desconocidos, retirada sin inventar recursos, carga 25 usuarios ×3, plataforma Windows, internet/dominio/UDP, cobertura de reglas, validación de reglas). `workflow.test.js`: expectativa de evaluación con fixture (pendiente) y caso HTTP con seed real (viable → insuficiente al reducir equipo; GET = PUT).

Verificación (real):
- `pnpm --filter @nomoresaas/api exec vitest run tests/evaluation.test.js tests/workflow.test.js` → 2 archivos, 23/23.
- `pnpm --filter @nomoresaas/api exec vitest run tests/projects.test.js` → 44/44 (createProjects/startServer con reglas por defecto).
- `pnpm exec eslint apps/api/src apps/api/tests` → sin errores.
- No ejecutado: suite completa, web y e2e (fuera de foco). DB de preview sin tocar.

### T003 — corrección tras revisión Codex (Immich en macOS)
- `apps/api/data/requirements.json`: Immich `os.macos` → pending `platform-discouraged` (Docker Desktop posible pero desaconsejado por la experiencia de Docker; no afirma que no funcione), fuente oficial `https://docs.immich.app/install/requirements/`. `rulesVersion` sin cambiar.
- `apps/api/tests/evaluation.test.js`: caso macOS + amd64 + CPU comprobada + recursos amplios → status `pending`, aviso con severidad, alternativa y fuente, sin «no funciona».
- `pnpm --filter @nomoresaas/api exec vitest run tests/evaluation.test.js tests/workflow.test.js` → 2 archivos, 24/24. `pnpm exec eslint apps/api/src/evaluation.js apps/api/tests/evaluation.test.js` → sin errores. Plan sigue null hasta T004; índice Git no tocado.

## T004 — Plan, prompts y avance privado (2026-11-22, Claude)
- `apps/api/src/plan-templates.js` (`TEMPLATES_VERSION` 2026-11-22.1): plantillas deterministas para las cinco alternativas × preparación/instalación/comprobación/recuperación con tareas, validación y fuentes oficiales (URLs de research.md/catálogo). WireGuard nativo con claves generadas localmente; Matrix protocolo / Synapse servidor; Outline con BSL y proveedor de auth. Restricciones comunes de prompt: explicar sin ejecutar, no pedir claves/tokens (marcadores), basarse en docs oficiales, preguntar si falta dato, estimación no garantizada.
- `apps/api/src/plan.js`: `planFingerprint` = SHA-256 de projectId + alternativas ordenadas + perfil normalizado con revisión + rulesVersion + templatesVersion (sin nombre/descripción ni secretos). `buildPlan` → `{fingerprint, rulesVersion, templatesVersion, blocked, blockedReasons, steps}`; null sin perfil; IDs `<alternativa>.<etapa>`; cada paso con `pending` (avisos no informativos de su alternativa o globales) y `prompt` de texto con contexto del proyecto/equipo/estimación, condiciones pendientes, tareas, restricciones, fuentes y validación. `blocked` con motivos si hay insuficiencia, retirada, sin reglas o sin plantillas; los pasos informativos siguen visibles.
- `apps/api/src/workflow.js`: GET workflow y PUT profile devuelven `plan` y `progress` reales; avance aplicado solo si su fingerprint coincide (si no: `{[], stale:true, updatedAt:null}`). Nuevo `PUT /api/projects/:id/progress` `{fingerprint, completedStepIds}`: cuerpo exacto (diccionario sin prototipo), IDs únicos ≤100, plan recalculado y escritura dentro de `BEGIN IMMEDIATE`; obsoleto o sin plan 409 `PLAN_STALE`; paso ajeno 400; ajeno/inexistente 404; guarda solo IDs ordenados al plan y timestamp del servidor en `project_progress` (migración 002, cascada). Sin migración nueva.
- Pruebas: nueva `apps/api/tests/plan.test.js` (13 casos: cinco alternativas × 4 etapas, determinismo, fingerprint por perfil/revisión/selección/reglas y no por nombre/orden, prompt con contexto/restricciones/fuentes/validación/pendientes y sin secretos/comandos peligrosos, WireGuard/Matrix, bloqueo por insuficiencia/retirada, parseProgress incl. `__proto__`, HTTP: marcar → recargar → reiniciar API con la misma DB temporal, cambio de equipo → stale + 409 + nuevo avance vacío, cambio de selección invalida y renombrar no, 400/409/403, aislamiento entre cuentas y borrado en cascada). `workflow.test.js`: expectativa de plan bloqueado sin pasos con el fixture.

Verificación (real):
- `pnpm --filter @nomoresaas/api exec vitest run tests/plan.test.js tests/workflow.test.js tests/evaluation.test.js` → 3 archivos, 37/37 (primera ejecución previa: 1 fallo esperado en workflow.test por `plan:null`, actualizado).
- `pnpm --filter @nomoresaas/api exec vitest run tests/projects.test.js tests/db.test.js` → 72/72.
- `pnpm exec eslint apps/api/src apps/api/tests` → sin errores.
- No ejecutado: suite completa, web, e2e. DB de preview sin tocar. Sin UI (T005).
