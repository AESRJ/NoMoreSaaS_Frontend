# Revision de seguridad breve: MVP-IDENTIDAD (T006)

2026-11-22, Claude Code. Lectura dirigida del codigo y de las pruebas de 003, mas `pnpm audit --prod`. **No es una auditoria de seguridad completa** ni una prueba de intrusion. Pendiente de revision independiente de Codex.

## Hechos comprobados

- **Secretos.** `SESSION_SECRET` (≥32 bytes) se lee solo del entorno o del `.env` raiz, que esta ignorado por Git (`.env`, `.env.*`, salvo `.env.example` sin valores). Los errores de configuracion no muestran su valor. El `.env` local se genero con `crypto.randomBytes(32)` sin imprimirlo y con el flag `wx`, que no sobrescribe. Vite solo lee del `.env` las claves de host y puerto. Tras `pnpm build`, una comprobacion local encontro que ni los nombres ni los valores de `SESSION_SECRET`, `DATABASE_PATH` y `APP_ORIGIN` aparecen en `apps/web/dist`. Las e2e usan un secreto efimero y una DB temporal. La DB (`*.sqlite`), `.local/` y las capturas estan ignorados.
- **Contrasenas.** Argon2id nativo (m=19456, t=2, p=1, salt de 16 B y tag de 32 B), formato PHC estricto, comparacion en tiempo constante y hash ficticio para correos inexistentes. El hash nunca se devuelve (probado en `auth.test.js`). La UI no recorta ni trunca y no guarda la contrasena: Zustand vive en memoria, y no hay `localStorage`, `sessionStorage` ni `innerHTML` en `apps/web/src`.
- **Sesion y cookies.** `express-session` con un store SQLite que guarda el SHA-256 del sid y un payload sin contrasena. Cookie `nomoresaas.sid` HttpOnly, SameSite=Lax, Path=/, sin Domain y Secure si `APP_ORIGIN` es https. Expira por inactividad (30 min) o por limite absoluto (24 h) en el servidor. Login y registro regeneran la sesion; logout la destruye y limpia la cookie. La cookie antigua da 401 (probado en API y e2e).
- **CSRF y origen.** Toda mutacion exige `Origin` igual a `APP_ORIGIN`, `application/json`, un cuerpo ≤16 KiB y el `X-CSRF-Token` sincronizador de la sesion actual. Las e2e reales comprueban el 403 con token ausente, alterado y con origen ajeno. Sin CORS y con `trust proxy` desactivado. Las respuestas de auth y proyectos llevan `Cache-Control: no-store`.
- **IDOR.** El propietario sale solo de la sesion. Toda consulta de proyecto filtra por `id = ? AND owner_id = ?`. Un proyecto ajeno devuelve el mismo 404 que uno inexistente (cuerpo identico), por API (supertest) y en navegador real con dos contextos, tanto por la UI como con el cliente HTTP. Los campos `ownerId`, `id` y fechas del cuerpo se rechazan con 400.
- **SQL.** Todas las consultas con datos usan sentencias preparadas con parametros `?`. Solo hay interpolacion en `db.js`: una constante numerica (pragma) y el SQL de las migraciones, leido de archivos del repositorio. Los errores 500 son genericos y no exponen SQL ni stack (probado).
- **Contenido del usuario.** Nombre y descripcion se representan como texto React, y una prueba de UI con HTML hostil confirma que no se crean elementos. El nombre y la descripcion rechazan caracteres de control (salvo saltos de linea y tabuladores en la descripcion).
- **Privacidad en el cliente.** No hay cache compartida entre identidades. Si la cuenta cambia, las respuestas y escrituras anteriores se descartan y no se envian. El borrador solo vive en memoria y se descarta con otra cuenta o al salir. `history.state` no contiene nombres de proyecto.
- **Dependencias.** `pnpm audit --prod`: «No known vulnerabilities found» (2026-11-22).

## Limites y riesgos conocidos

- Los limitadores de intentos (login 5/15 min por correo y 20 por IP, registro 10 por IP) viven en memoria de un proceso: se reinician con la API y no coordinan varias instancias.
- El 409 del registro permite saber si un correo existe (lo fija el contrato).
- Sin verificacion ni recuperacion de correo, sin MFA y sin borrado de cuenta. Sin HTTPS en desarrollo: la cookie no es Secure con http en loopback.
- SQLite `node:sqlite` en estado release candidate, de un solo proceso. La concurrencia del cupo de 100 se apoya en `BEGIN IMMEDIATE` y en un trigger; no se probo con varios procesos.
- No se ha hecho analisis dinamico (fuzzing, escaneo DAST) ni revision de cabeceras en un despliegue real. No hay despliegue.
