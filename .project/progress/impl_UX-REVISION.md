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

## T003 — 2026-11-22 (Claude, pendiente de revisión Codex)
Producto:
- Nuevo apps/web/src/components/ServiceReplacementPicker.jsx: buscador «Servicio que quieres reemplazar» (misma coincidencia searchCatalog, agrupada por servicio; Enter no envía), grupos por servicio con casillas de sus alternativas, chips ordenados «servicio → alternativa» con «Quitar …», sin duplicados (una alternativa de dos servicios se marca una vez y su chip nombra ambos), límite 10 con casillas deshabilitadas, estado sin coincidencias con «Ver todos los servicios». Retiradas visibles como «No disponible» con indicación de quitarlas y elegir otro reemplazo; no aparecen como seleccionables.
- apps/web/src/pages/ProjectFormPage.jsx: usa el selector; sin cambios en validación 1–10/únicos, payload (alternativeIds solo si cambia al editar), CSRF, 401/borrador por cuenta, 403/404/red ni aislamiento. Textos «reemplazos».
- apps/web/src/catalog-index.js: servicesForResult compartido por catálogo y selector (antes privado en CatalogPage). CSS de grupos/buscador del selector.

Pruebas: projects.test.jsx adaptado (lista «Reemplazos elegidos», chips, grupo y orden de Tab) y bloque nuevo 005 US3 (dos servicios por búsqueda, Enter en buscador, quitar/repetir sin duplicar, payload, sin coincidencias, alternativa en dos servicios). e2e identity.spec.js adaptado (orden por servicio, chips, «Quitar Google Fotos → Immich»).

Comandos y resultados:
- `python tools/check_handoff.py --implementation-ready …` → OK (2 de 4 al empezar).
- `pnpm lint` → sin errores.
- `pnpm --filter ./apps/web exec vitest run` → 10 archivos, 164/164.
- `pnpm exec playwright test tests/e2e/identity.spec.js tests/e2e/workflow.spec.js` (3501/5773 heredados, DB temporal) → 10/10 en 360 y 1280: crear con dos servicios, recargar, editar quitando/añadiendo, 403/red/401 conservan valores, dos identidades aisladas, 401 sin sesión, flujo completo de plan.

Límites: build no repetido (sin cambios de configuración; se ejecutará al integrar en T004). catalog.spec.js y portada.spec.js siguen pendientes de T004.

## T004 — 2026-11-22 (Claude, pendiente de revisión Codex; no cierra la feature)
Integración y regresiones:
- tests/e2e/catalog.spec.js: recorrido global obsoleto (añadir/banda/tabla /comparar) sustituido conservando su intención: teclado búsqueda → círculo → alternativa → comparativa → ficha; búsqueda por alternativa; cada servicio inicial con fuente oficial; /comparar redirige sin menú, botones ni tabla; sin resultados/restablecer; estados simulados; responsive 360/1280 con capturas. Contrato API: metadatos oficiales de Service.
- tests/e2e/portada.spec.js: bloque de banda de selección sustituido por abrir/cerrar el explorador y color lima/negro del círculo activo. tests/e2e/workflow.spec.js: comentario.
- README.md (incremento 005, flujo y límites) y .project/context.md (estado 005) actualizados brevemente.
- Sin cambios de producto adicionales: no se encontraron regresiones en src.

Comandos y resultados:
- `pnpm lint` → sin errores. `pnpm build` → OK.
- `pnpm test` → web 164/164; API 262/263: falla por timeout (5 s) `apps/api/tests/db.test.js` «limita a 100 proyectos por cuenta» al correr en paralelo con la web (6,5 s); aislado `vitest run tests/db.test.js` → 28/28. Archivo fuera de allowed_paths de 005 y no tocado; se informa a Codex.
- `pnpm test:e2e` (3501/5773 heredados, DB temporal) → 48/48 en 360 y 1280 (catálogo, explorador, portada, identidad, flujo). Capturas en .local/screenshots/.
- `.\init.cmd` → OK (handoff 005 ready).

Límites: sin despliegue, Google ni Railway. El estado abierto del explorador no se refleja en la URL (solo ?q=). Revisión y cierre de 005 corresponden a Codex.

### T004 — corrección solicitada por Codex (2026-11-22)
- apps/api/tests/db.test.js («limita a 100 proyectos por cuenta»): la preparación de los 100 proyectos va en una transacción `BEGIN IMMEDIATE`/`COMMIT` (ROLLBACK y relanzar si falla). Se mantienen el intento 101 fuera de la transacción (PROJECT_QUOTA_EXCEEDED), el recuento 100 y la segunda cuenta; sin cambios de aserciones, límites, timeout, configuración de DB ni producto.
- `vitest run tests/db.test.js -t "limita a 100"` → PASS en 73 ms. `vitest run tests/db.test.js` → 28/28.
- `pnpm test` integrado → API 263/263, web 164/164. `pnpm lint` → sin errores.
- e2e no repetido (cambio solo en fixtures de prueba; última ejecución 48/48).

### T004 — segunda corrección solicitada por Codex (2026-11-22)
- Fallo informado por Codex en su ejecución completa: 47/48, `tests/e2e/portada.spec.js:85` en movil-360; la lectura puntual con `evaluate` tras `drive.click` captó la transición de color en curso (rgb(197, 252, 14) frente a rgb(198, 253, 14)).
- Corrección: la comprobación usa aserciones reintentables `toHaveCSS('background-color', 'rgb(198, 253, 14)')` y `toHaveCSS('color', 'rgb(0, 0, 0)')`. RGB exacto, sin pausas fijas ni tolerancias, sin cambios de paleta, animación ni producto.
- `pnpm exec playwright test tests/e2e/portada.spec.js` → 4/4 (360 y 1280).
- `pnpm test:e2e` (3501/5773 heredados, DB temporal) → 48/48.
- Unit/lint/build no repetidos (solo cambió una aserción e2e). Checkbox T004 estaba en [ ] tras reapertura; marcado tras estos checks.
