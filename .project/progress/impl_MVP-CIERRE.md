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
