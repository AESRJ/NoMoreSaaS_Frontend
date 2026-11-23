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

## T002 — proveedor OIDC y endpoints providers/start/callback (Claude, 2026-11-22)
Dependencia: `google-auth-library` 11.3.4 exacta (`pnpm view`: latest 11.3.4, engines node >=22; Node local 26.13.1) en `apps/api/package.json` y `pnpm-lock.yaml` (+20 paquetes). `pnpm install --frozen-lockfile --offline` → lockfile al día.
Archivos:
- `apps/api/src/config.js`: `loadGoogleConfig` todo-o-nada (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI); callback exacto `APP_ORIGIN + /api/auth/google/callback`, nunca inferido de Host; mensajes sin valores.
- `apps/api/src/google.js` (nuevo): URL fija accounts.google.com con client_id, redirect_uri, scopes openid/email/profile, state, nonce, PKCE S256, access_type=online; canje y `verifyIdToken` (firma/iss/aud/exp) con issuers explícitos de Google; errores de la biblioteca (pueden contener el JWT) sustituidos por `GoogleAuthError`; access/refresh tokens descartados.
- `apps/api/src/google-auth.js` (nuevo): `GET /api/auth/providers` → `{google:{enabled}}`; `POST /api/auth/google/start` (Origin, JSON, CSRF, cuerpo `{}`, límite 20/15 min por IP, 503 AUTH_PROVIDER_UNAVAILABLE sin config) guarda hashes de state/nonce + verifier ligado al hash del sid, TTL 5 min, un intento por sesión; `GET /api/auth/google/callback` consume con `DELETE … RETURNING` (state+sesión) antes del canje, vencido/replay/sesión ajena/parámetros inválidos → 303 `/entrar?reason=google_failed`, `access_denied` → google_cancelled, nonce comparado en tiempo constante tras verificar token, alta solo con email_verified=true, Google existente por sub (no correo), correo local ocupado → google_conflict sin mutación, éxito regenera sesión → 303 `/proyectos`. Log solo del tipo de error. purpose=link responde google_failed (vínculo en T003).
- `apps/api/src/auth.js`: monta rutas Google, opción `googleProvider`/`logger`, limitador `googleStartPerIp`, limpieza de intentos vencidos al crear y en el temporizador. `apps/api/src/server.js`: carga config Google antes de abrir la DB.
- Pruebas: `tests/google-auth.test.js` (nuevo, 19), `tests/api.test.js` (+1 arranque con Google off/on/parcial), `tests/auth.test.js` (timeout 20 s explícito en «límite absoluto de 24 h»: 2 timeouts reproducibles a 5 s con la suite completa en paralelo por ~72 escrituras synchronous=FULL; aserciones sin cambios).

Comandos y resultados:
- `pnpm --filter @nomoresaas/api exec vitest run tests/google-auth.test.js` → 19/19.
- `pnpm --filter @nomoresaas/api exec vitest run` → 293/294 dos veces (timeout citado), tras el ajuste 294/294.
- `pnpm lint` → OK (tras quitar un argumento sin uso).
- `python tools/check_handoff.py --implementation-ready .project/handoffs/006-acceso-google.json` → OK.

Límites: cliente Google simulado en flujo HTTP; verificación real de google-auth-library probada sin red con clave RSA local y certificados sustituidos. Sin prueba viva con Google (no hay cliente/consentimiento configurados). Sin UI, `.env.example` ni docs (T004/T005). Sin build/e2e: no cambia web. Solo DB temporales; preview y DB local intactas. Sin git add/commit.

## T002 — corrección Codex: sesión/intento tras el canje (Claude, 2026-11-22)
- `apps/api/src/google-auth.js`: tras `await provider.exchange` y antes de crear usuario/identidad o regenerar sesión, se recomprueba `expires_at` del intento y `isSessionCurrent(req)`; cualquier fallo del callback hace `req.session = null` (con `unset: 'keep'`: sin Set-Cookie rolling, sin save/touch, sin destruir otra sesión). Entre la comprobación y el guardado de la nueva sesión solo hay código síncrono y microtareas.
- `apps/api/src/auth.js`: `isSessionCurrent` relee el sid en el store (borra si vencido) y exige mismo csrfToken, createdAt y userId que al inicio de la petición. Expiración de 003, state/nonce/PKCE y consumo atómico sin cambios.
- `apps/api/tests/google-auth.test.js`: proveedor diferido (gate en getToken) y 4 casos: logout durante el canje, login de otra cuenta con sid rotado, sesión vencida y intento vencido durante el canje; aserciones de 303, Set-Cookie ausente, filas de sessions/users/external_identities y usuario actual de la cookie. Más aserción sin Set-Cookie en cancelación.

Comandos y resultados:
- Antes de corregir: `vitest run tests/google-auth.test.js -t "carreras"` → 4/4 fallan (callback redirigía a /proyectos y autenticaba).
- Tras corregir: `tests/google-auth.test.js` 23/23; google-auth+auth+api+projects 155/155; API completa 298/298 (una ejecución, auth.js cambió); `pnpm lint` OK; check_handoff OK.

Límites: timeout de 20 s del caso «24 h» se mantiene localizado (no global), aserciones intactas. Sin Google vivo. Sin git add/commit.

## T002 — último ajuste Codex: tramo síncrono (Claude, 2026-11-22)
- `apps/api/src/auth.js`: `isSessionCurrent` ahora es síncrono (sin Promise); reutiliza `store.get` (inactividad, límite absoluto y payload de 003, borra si vencido) y lanza error si el store no respondiera de forma síncrona.
- `apps/api/src/google-auth.js`: tras el último await (`provider.exchange`) un único tramo síncrono ejecuta nonce/sub, TTL del intento, relectura de la sesión, alta/recuperación del usuario y el destroy síncrono del sid original dentro de `regenerate`. Corrección de evidencia anterior: la frase «solo código síncrono y microtareas… ninguna otra petición se intercala» no garantizaba la ausencia de otras continuaciones; el `await isSessionCurrent` sí cedía. Ahora no hay cesión entre comprobación y mutación.
- `apps/api/tests/google-auth.test.js`: caso determinista «sin cesión…»: una microtarea encolada al releer el store debe ver identidad creada y sid original destruido. Con `await` temporal en la relectura falla (`{oldSession:1, identities:0}`); restaurado, pasa.

Comandos y resultados: `vitest run tests/google-auth.test.js` 24/24; google-auth+auth+api+projects 156/156; `pnpm lint` OK. API completa no repetida (cambio localizado, sin fallos). Sin Google vivo. Sin git add/commit.
