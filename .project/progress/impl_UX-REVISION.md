# Implementación UX-REVISION (005-ajustes-ui)

## T001 — 2026-11-22 (Claude, pendiente de revisión Codex)
Archivos de producto:
- apps/web/src/components/SearchForm.jsx: label «Encuentra una alternativa», placeholder «Por ejemplo, Google Drive», ayuda «Escribe el nombre del servicio que quieres reemplazar.». Semántica de búsqueda (ExplorerState.query) sin cambios.
- apps/web/src/pages/CatalogPage.jsx: h1 «Tus servicios. Tus reglas.», bajada «Elige lo que usas. Encuentra su reemplazo.»; estado sin resultados ya no exige conocer «SaaS». Imagen Higgsfield y paleta intactas.
- apps/web/src/components/AuthForm.jsx: ayuda de registro «Usa una frase de al menos 15 caracteres.»; máximo 128 solo en el error existente. Validación 15–128 en puntos Unicode, sin trim/truncado, sin cambios de hash ni de reglas.
- apps/web/src/pages/AuthPage.jsx: bajada de registro más breve.

Pruebas adaptadas (nombres accesibles/textos, sin batería nueva): apps/web/tests/hero.test.jsx, catalog.test.jsx, auth.test.jsx; tests/e2e/portada.spec.js, catalog.spec.js, identity.spec.js.

Comandos y resultados:
- `python tools/check_handoff.py --implementation-ready .project/handoffs/005-ajustes-ui.json` → OK (0 de 4 completadas al empezar).
- `pnpm lint` → sin errores.
- `pnpm --filter ./apps/web exec vitest run tests/hero.test.jsx tests/catalog.test.jsx tests/auth.test.jsx tests/accessible-names.test.jsx` → 4 archivos, 73/73 pruebas OK.

Límites: e2e Playwright y smoke 360/1280 no ejecutados en T001 (previstos en T004). El launcher `impeccable context` requirió aprobación no disponible; se aplicaron sus guías leyendo las referencias directamente. `apps/web/index.html` (meta description) sin cambios, fuera del copy pedido. Secciones «Servicios SaaS»/«Alternativas» quedan para T002.
