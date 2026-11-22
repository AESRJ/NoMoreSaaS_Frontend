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

## T002 — 2026-11-22 (Claude, pendiente de revisión Codex)
Producto:
- Nuevo apps/web/src/components/ServiceExplorer.jsx: círculos de servicio (botones con aria-expanded/aria-controls, monograma decorativo aria-hidden), árbol DOM de alternativas y comparativa integrada (región «X frente a Y»). Estado ExplorerState: servicio/alternativa activos solo si forman par válido; cambiar de servicio borra la alternativa; único resultado de búsqueda se abre solo; cerrarlo se respeta hasta otra búsqueda. Anuncio polite. Comparativa: qué es, cobertura, capacidades, limitaciones, licencia, alojamiento/mantenimiento y fuentes; lo no documentado del servicio se marca «Desconocido», sin precios ni paridad. Texto siempre como texto.
- apps/web/src/pages/CatalogPage.jsx: usa el explorador; búsqueda searchCatalog sin cambios (coincidencias de alternativa se agrupan en su servicio); aviso tras /comparar.
- apps/web/src/App.jsx: /comparar → Navigate interno a / con aviso. Fichas /alternativas/:id y /saas/:id intactas.
- Retirados: menú Comparar, SelectionBar, SelectButton, Cards, ComparePage y store/comparison.js (Layout, ServicePage, AlternativePage sin botones de selección). CSS: estilos del explorador con animación CSS (prefers-reduced-motion global ya la anula); eliminado CSS muerto de tabla/banda/contador. `.chip` se conserva.
- apps/api/src/catalog.js: Service.officialUrl (HTTPS) y Service.sources (1–8, url HTTPS, checkedAt no futura, kind official, note 1–1000) opcionales; schemaVersion 1; fixtures sin ellos válidos.
- apps/api/data/catalog.json: officialUrl y una fuente oficial por servicio (Google Drive, Google Fotos, Slack, Tailscale KB 1151, Notion), revisadas el 2026-11-22 cargando cada página; notas solo con lo que la página dice. No se afirma alojamiento SaaS donde la página no lo dice (la UI lo muestra desconocido).

Pruebas: nuevas apps/web/tests/explorer.test.jsx y tests/e2e/explorer.spec.js; API catalog.test.js con casos de metadatos de Service. Adaptadas: catalog, detail, accessible-names, auth (rutas /comparar → /saas/drive), helpers y beforeEach (sin store de selección). Eliminadas compare.test.jsx y comparison.test.js (probaban la interfaz retirada).

Comandos y resultados:
- `python tools/check_handoff.py --implementation-ready …` → OK (1 de 4 al empezar).
- `pnpm --filter ./apps/api exec vitest run tests/catalog.test.js` → 66/66.
- `pnpm lint` → sin errores. `pnpm build` → OK.
- `pnpm --filter ./apps/web exec vitest run` → 10 archivos, 161/161.
- `pnpm exec playwright test tests/e2e/explorer.spec.js` (puertos heredados 3501/5773 comprobados con node; DB temporal del config) → 8/8 en 360 y 1280: Google Drive→Nextcloud→comparativa en /, teclado, /comparar redirige, movimiento reducido sin animación, sin desbordamiento horizontal. Capturas en .local/screenshots/explorador-{360,1280}.png.
- `pnpm --filter ./apps/api exec vitest run` → 262/263; el fallo fue timeout de 5 s en db.test.js «limita a 100 proyectos» (archivo no tocado); repetido aislado → 28/28.

Límites: specs e2e antiguos (catalog.spec.js, portada.spec.js, workflow.spec.js) aún esperan la comparación global/tarjetas y no se ejecutaron; su actualización corresponde a T004. Launcher Impeccable sin aprobación (guías leídas directamente).
