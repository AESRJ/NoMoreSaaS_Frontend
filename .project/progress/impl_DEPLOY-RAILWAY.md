# Implementación DEPLOY-RAILWAY (008) - 2026-11-22

Decisión del usuario (2026-11-22): retirar el acceso con Google y dejar el proyecto desplegable en Railway sin esperar más invocaciones. Implementado en una sesión de Claude Code.

## Archivos
- API: `src/config.js` (production, trustProxyHops, origen desde RAILWAY_PUBLIC_DOMAIN), `src/server.js` (0.0.0.0/PORT, staticDir, SIGTERM), `src/app.js` (SPA mismo origen, 404 JSON), `src/auth.js` (sin Google/account).
- Eliminados: `google.js`, `google-auth.js`, página Mi cuenta, GoogleSignIn, cliente account, sus pruebas y e2e, `setup-google.md`, dependencia `google-auth-library`.
- Despliegue: `Dockerfile`, `docker-entrypoint.sh`, `.dockerignore`, `railway.json`, `.gitattributes` (LF para sh/Dockerfile), script `start`.
- Docs: `README.md`, `.env.example`, `.project/docs/deployment-railway.md` (runbook: variables, volumen, verificación, backup/rollback).

## Verificación
- `pnpm lint` OK; `pnpm test` API 293/293, web 193/193; `pnpm build` OK.
- `pnpm test:e2e` (puertos 3521/5793, DB temporal) 48/48 en 1280 y 360 px.
- Smoke local de producción con DB temporal: `/` y deep link 200 HTML, `/api/health` 200, `/api/x` y `/assets/x.js` 404 JSON, cookie `Secure; HttpOnly; SameSite=Lax` tras `X-Forwarded-Proto: https`, log `escuchando en http://0.0.0.0:PORT`.
- Tag `node:26.13.1-bookworm-slim` verificado en Docker Hub.

## Limitaciones
- Sin Docker local: la imagen no se construyó aquí; la primera compilación real será en Railway.
- Despliegue vivo, volumen, variables y costos dependen de la cuenta de Railway del usuario; no verificados desde esta sesión.
- Cuentas creadas solo con Google (si existieran) ya no pueden entrar; las tablas se conservan.
