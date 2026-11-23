# Implementacion MVP-CATALOGO (T001-T017)

## Nota operativa de Codex - 2026-11-21

Entrega cerrada segun handoff y revision posteriores; el cuerpo historico conserva el estado original del constructor. A solicitud del usuario se configuro `.claude/settings.local.json` con acceptEdits y 16 reglas concretas de comandos Bash/PowerShell para verificaciones y desarrollo local. NotebookLM conservado. NoMoreSaaS_Frontend ya es raiz escribible de esta sesion. `init.cmd` retorno 0 (17/17 completas); parseo PowerShell del JSON y comprobacion de modo/reglas/NotebookLM correctos; `git diff --check` retorno 0, con avisos CRLF de archivos preexistentes. No se inicio Claude para comprobar carga efectiva ni se repitieron pruebas de producto por este cambio de configuracion. Detalle en `.project/execution-permissions.md`. Sin nueva implementacion, commits, push ni cambios fuera de este repositorio. Las restricciones administradas siguen vigentes.

Constructor: Claude Code. Fecha: 2026-11-20. Rama: `feat/catalogo-comparacion`. Estado: **implementado y verificado localmente, pendiente de revision de Codex**. No se marca la feature como done ni se cambia el estado `ready` de la entrega.

## Entorno y bloqueo inicial

- Primera sesion: en modo no interactivo, `node --version`, `pnpm --version`, `"/c/Program Files/nodejs/node.exe" --version`, `where.exe node pnpm`, `powershell.exe ... check-prerequisites.ps1` devolvian "This command requires approval" y `pnpm`/`node` no estaban en el PATH de Bash. No se intento esquivar el permiso. Se avanzo solo con trabajo independiente (curacion de fuentes, versiones del registro npm, `apps/api/src/catalog.js`).
- Segunda sesion: Codex corrigio el entorno (`BASH_ENV` con PATH de Node/pnpm). Comprobado: `node --version` → `v26.13.1`; `pnpm --version` → `12.21.0`.
- Sigue denegado `rm` (comando concreto: `rm tests/zz-debug.test.jsx`). Alternativa autorizada: se renombro el archivo temporal con `mv` y se convirtio en una prueba de regresion real (`apps/web/tests/accessible-names.test.jsx`).
- `.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks` → `FEATURE_DIR=.project/specs/002-catalogo-comparacion`, docs research/data-model/contracts/quickstart/tasks. Checklist `requirements.md`: 14/14 → PASS. No existe `.specify/extensions.yml` (sin hooks).
- Cambio ajeno detectado: `.project/specs/002-catalogo-comparacion/quickstart.md` aparece modificado en el arbol de trabajo (`.venv\Scripts\python.exe` → `python`). No lo hizo Claude; esta fuera de las rutas permitidas, no se toca ni se incluye en commits. Codex debe decidir.

## Versiones fijadas (registro npm consultado 2026-11-20)

`packageManager: pnpm@12.21.0` (existe en el registro; engines node >=18). Dependencias directas exactas: react 19.3.1, react-dom 19.3.1, react-router 8.5.2 (node >=22.22.0), zustand 5.1.0, express 5.3.0, helmet 8.3.0, vite 8.3.8, @vitejs/plugin-react 6.3.0, vitest 5.1.1, jsdom 31.0.1 (node ^22.22.2 || ^24.15.0 || >=26), @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.13, @testing-library/jest-dom 8.0.0 (peer vitest >=5 <6), supertest 7.3.2, @playwright/test 1.65.1, eslint 10.15.0, @eslint/js 10.0.1, globals 17.14.0, eslint-plugin-react-hooks 7.1.1. Todas compatibles con Node 26.13.1. Se descarto `eslint-plugin-react` 7.37.5: su peer no admite ESLint 10. `engines.node` raiz: `>=22.22.2` (maximo minimo de las dependencias). `pnpm-lock.yaml` versionado; `pnpm install --frozen-lockfile` comprobado ("Lockfile is up to date").

## Tareas

| Tarea | Resultado | Archivos principales |
| --- | --- | --- |
| T001 | Monorepo pnpm, scripts dev/lint/test/build/test:e2e, proxy `/api` sin CORS, `.env.example`, shell `main.jsx`/`App.jsx`. `.gitignore` ya cubria `node_modules/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `.env*`, `.local/`: sin cambios. | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/*/package.json`, `apps/web/index.html`, `apps/web/vite.config.js`, `eslint.config.js`, `.env.example` |
| T002 | Validacion completa de Service/Alternative/Relation/Source y reglas de conjunto; copia ordenada y congelada; errores con ruta del campo. Solo `open-source` publicable; dificultad exige fuente editorial; limitaciones vacias exigen nota. | `apps/api/src/catalog.js`, `apps/api/tests/catalog.test.js`, `apps/api/tests/fixtures.js` |
| T003 | Seed curado: 3 SaaS, 4 alternativas, GitHub con 2 (Gitea, Forgejo). Fuentes oficiales visitadas el 2026-11-20 (tabla abajo). | `apps/api/data/catalog.json` |
| T004 | Express 5 + Helmet, `x-powered-by` desactivado, health/catalog/alternatives, 400/404/500 sin stack, 404 JSON para escrituras y rutas desconocidas, arranque falla con dataset invalido, `127.0.0.1:3001` por defecto. | `apps/api/src/app.js`, `server.js`, `errors.js`, `apps/api/tests/api.test.js` |
| T005 | Store Zustand: IDs ordenados 0-3, add → added/duplicate/limit, remove, clear, reconcile con aviso; sin persistencia. | `apps/web/src/store/comparison.js`, `apps/web/tests/comparison.test.js` |
| T006 | Cliente `fetchCatalog` (errores network/http/invalid, nunca vacio por error), recurso compartido con `useSyncExternalStore`, una peticion por sesion, reintento, cancelacion y descarte de respuestas obsoletas; indice y busqueda local; componentes comunes. | `apps/web/src/api/catalog.js`, `hooks/useCatalog.js`, `catalog-index.js`, `components/*`, `apps/web/tests/catalog-client.test.js` |
| T007 | Pruebas US1 (12 casos). Fallaron contra el shell antes de T008 (ver evidencia TDD). | `apps/web/tests/catalog.test.jsx`, `fixtures.js`, `helpers.jsx` |
| T008 | `/` y `/saas/:id`, busqueda `q` en URL, estados carga/error/vacio/sin resultados/no encontrado. | `pages/CatalogPage.jsx`, `pages/ServicePage.jsx`, `components/Cards.jsx`, `SearchForm.jsx`, `StatusViews.jsx` |
| T009 | Pruebas US2 (8 casos): campos, fuentes/fechas, no verificado, desconocido, HTML como texto, esquemas no HTTP(S). Fallaron antes de T010. | `apps/web/tests/detail.test.jsx` |
| T010 | Ficha y no encontrado; nota de verificacion por campo (oficial/editorial/no verificado); enlaces seguros. | `pages/AlternativePage.jsx`, `pages/NotFoundPage.jsx`, `components/Verification.jsx`, `SourceList.jsx`, `ExternalLink.jsx` |
| T011 | Pruebas US3 (8 casos): 0/1/2/3/4, duplicados, quitar/limpiar, navegacion, IDs retirados, necesidades distintas. Fallaron antes de T012. | `apps/web/tests/compare.test.jsx` |
| T012 | `/comparar` con criterios alineados, aviso de necesidades distintas, tabla con region desplazable etiquetada y primera columna fija; barra de seleccion con contador y avisos. | `pages/ComparePage.jsx`, `components/SelectionBar.jsx`, `SelectButton.jsx`, `Layout.jsx` |
| T013 | Playwright con API y web reales (`webServer`), proyectos 1280 y 360; recorrido solo con teclado; fallos simulados solo con `page.route`. | `playwright.config.js`, `tests/e2e/catalog.spec.js` |
| T014 | Estilos: foco visible, enlace "Saltar al contenido", objetivos tactiles >=44 px, `prefers-reduced-motion`, tabla con desplazamiento propio. Revisado en navegador a 360/1280 (capturas). | `apps/web/src/styles.css` |
| T015 | Workflow CI (no ejecutado: sin push autorizado). README y verificacion. `.github/workflows/harness.yml` no existe en este checkout: nada que preservar. | `.github/workflows/catalog.yml`, `README.md`, `.project/verification.md` |
| T016 | Revision de seguridad con 1 hallazgo corregido. | `.project/progress/security_MVP-CATALOGO.md`, `apps/api/tests/security.test.js` |
| T017 | Este informe, estado, bitacora, contexto e `init.cmd`. | `.project/progress/*`, `.project/context.md` |

## Fuentes del seed (consultadas 2026-11-20)

| Alternativa | URL visitada | Respalda |
| --- | --- | --- |
| Nextcloud | https://nextcloud.com/ | descripcion, capacidades (Files, Talk, groupware, Office, apps), enlaces |
| Nextcloud | https://docs.nextcloud.com/server/latest/admin_manual/installation/system_requirements.html | requisitos (manual "latest" = 35, 36 en preparacion), limitaciones (32 bits, memoria, MySQL/MariaDB, SQLite) |
| Nextcloud | https://github.com/nextcloud/server/blob/master/COPYING | licencia: texto "GNU AFFERO GENERAL PUBLIC LICENSE Version 3" |
| Immich | https://github.com/immich-app/immich | descripcion, tabla de funciones, advertencia 3-2-1 |
| Immich | https://docs.immich.app/install/requirements | requisitos (6 GB min/8 GB rec RAM, 2/4 nucleos, Docker Compose), Windows/NTFS, mencion AGPL v3 |
| Immich | https://docs.immich.app/overview/quick-start | copias manuales de fotos/videos |
| Immich | https://github.com/immich-app/immich/blob/main/LICENSE | licencia: texto AGPL v3 |
| Immich | https://immich.app/ | sitio oficial (sin texto descriptivo; solo navegacion) |
| Gitea | https://docs.gitea.com/ | descripcion, funciones, requisitos ("2 CPU cores and 1GB RAM is typically sufficient for small teams/projects"), docs 28.4.0 |
| Gitea | https://about.gitea.com/ | funciones y edicion Enterprise |
| Gitea | https://docs.gitea.com/installation/comparison | soportado/parcial/no soportado |
| Gitea | https://docs.gitea.com/installation/database-prep | bases de datos y advertencias |
| Gitea | https://docs.gitea.com/installation/install-from-binary | Git >= 2.0; base para la evaluacion editorial |
| Gitea | https://github.com/go-gitea/gitea/blob/main/LICENSE | texto MIT (sin encabezado "MIT License"; el README lo identifica como MIT) |
| Forgejo | https://forgejo.org/ | descripcion |
| Forgejo | https://codeberg.org/forgejo/forgejo | README: funciones, federacion WIP, GPL-3.0-or-later desde v9.0 (MIT antes) |
| Forgejo | https://forgejo.org/docs/latest/ | docs v17.0.2, PR/incidencias/Actions |
| Forgejo | https://forgejo.org/docs/latest/user/packages/ | registros de paquetes |
| Forgejo | https://forgejo.org/docs/latest/admin/installation/binary/ | git y git-lfs; SQLite suficiente para al menos 10 usuarios; sin RAM/CPU |
| Forgejo | https://forgejo.org/docs/latest/admin/installation/database-preparation/ | MariaDB >=10.6, MySQL >=8.4, PostgreSQL >=14, SQLite |
| Forgejo | https://forgejo.org/compare-to-gitea/ | hard fork desde 2024, nombre de binario al migrar |

Limitacion de curacion: el archivo `https://codeberg.org/forgejo/forgejo/src/branch/forgejo/LICENSE` devolvio una pagina antiscraping y la variante raw fallo; la licencia se respalda con el README oficial y asi consta en la nota de la fuente. Las dificultades son evaluaciones editoriales de NoMoreSaaS con motivo y fuente `editorial`. Las descripciones de los tres SaaS son resúmenes neutrales sin fuente (el modelo no exige fuentes para Service). No se instalo ninguno de los servicios.

## Evidencia TDD

- Pruebas de store y cliente antes de implementar: `pnpm test` (web) → 2 archivos fallidos por modulos inexistentes.
- Pruebas de UI US1-US3 contra el shell de T001: **29 fallidas, 25 aprobadas** (54). Despues de T008/T010/T012: 54/54.
- T002: `catalog.js` se escribio antes que sus pruebas (primera sesion, sin Node disponible); no hay evidencia de fallo previo para T002.

## Verificacion final (ejecucion real 2026-11-20, raiz del repo)

| Comando | Codigo de salida | Resultado |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | "Lockfile is up to date" |
| `pnpm lint` | 0 | sin errores ni avisos |
| `pnpm test` | 0 | API: 3 archivos, 80 pruebas aprobadas; web: 6 archivos, 56 pruebas aprobadas |
| `pnpm build` | 0 | `dist/index.html` 0.56 kB, CSS 11.31 kB, JS 285.57 kB (89.40 kB gzip) |
| `pnpm exec playwright install chromium` | 0 | sin salida (navegador ya disponible o instalado) |
| `pnpm test:e2e` | 0 | 22 aprobadas (11 escenarios x proyectos escritorio-1280 y movil-360), 10.3 s |
| `pnpm audit` | 0 | "No known vulnerabilities found" |
| `init.cmd` (via `cmd.exe //c` con ruta absoluta) | 0 | "OK: entrega, destino, artefactos y tareas; completadas 0 de 17" antes de marcar casillas y "completadas 17 de 17" despues |

## Errores encontrados durante la verificacion y corregidos

1. Nombre accesible del boton de seleccion sin espacio ("Archiveroa"): espacio dentro de un `span` recortado. Corregido y con prueba de regresion.
2. Busqueda en navegador real perdia pulsaciones: React Router 8 aplica `setSearchParams` en una transicion y el input controlado por la URL se quedaba atras. Solo lo detecto Playwright. Corregido con estado local reflejado en la URL y resincronizacion ante navegacion externa (prueba unitaria añadida).
3. Desbordamiento horizontal a 360 px en `/comparar`: los `span.sr-only` absolutos de la tabla escapaban del contenedor no posicionado. Corregido con `position: relative`.
4. Boton "Añadir a la comparacion" partido visualmente (flex + span oculto). Corregido agrupando la etiqueta.
5. Codigo `INVALID_REQUEST` fuera de contrato (T016). Corregido a `INVALID_ID`.

## Cobertura automatizada frente a revision visual

- Automatizado (Vitest + Playwright): busqueda normalizada, URL `q`, sin resultados/restablecer, carga, error con reintento, vacio, no encontrado (SaaS, alternativa, ruta), ficha directa y recarga, fuentes/fechas, no verificado, HTML como texto, esquemas inseguros, seleccion 0-4, duplicados, quitar/limpiar, persistencia al navegar, perdida al recargar `/comparar`, IDs retirados, necesidades distintas, recorrido completo solo con teclado (Tab/Enter/Espacio) en 1280 y 360, ausencia de desbordamiento horizontal de pagina y tabla desplazable a 360.
- Revision visual (Claude, sobre capturas): `.local/screenshots/catalogo-{360,1280}.png`, `ficha-{360,1280}.png`, `comparacion-{360,1280}.png` (no versionadas). Observaciones: jerarquia clara, insignias de licencia y dificultad editorial diferenciadas, tabla legible a 1280 y con primera columna fija a 360. En las capturas `fullPage` la barra de seleccion `sticky` aparece a mitad de pagina: es un efecto de la captura de pagina completa, no de la maquetacion.
- No realizado: auditoria WCAG completa, lector de pantalla real, contraste medido con herramienta, navegadores distintos de Chromium, CI en GitHub.

## Limitaciones

- Seleccion no persistente al recargar (por diseno, FR-007).
- Sin hosting de produccion; el proxy `/api` solo existe en el servidor de desarrollo de Vite. La SPA no tiene CSP propia.
- Memoria NotebookLM: no utilizada en esta sesion; fuentes locales y Git como autoridad.

## Commits (bloqueados)

`git add` funciono, pero `git commit` devolvio "This command requires approval" (aprobacion no disponible en esta sesion). Comando exacto intentado (el mismo patron para los tres):

```
git -c user.name=AESRJ -c user.email=vasquez.jorge@uabc.edu.mx commit -q -m "feat: catálogo público y comparación de alternativas (MVP-CATALOGO)" -m "..."
```

Commits previstos: (1) `feat: catálogo público y comparación de alternativas (MVP-CATALOGO)` con `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `eslint.config.js`, `playwright.config.js`, `.env.example`, `apps/`, `tests/e2e/`; (2) `ci: workflow de verificación del catálogo y documentación de comandos` con `.github/workflows/catalog.yml`, `README.md`, `.project/verification.md`; (3) `docs: evidencia de implementación y seguridad de MVP-CATALOGO` con `.project/progress/*`, `.project/context.md` y `tasks.md`. Todo queda en el area de preparacion (staged) para revision, salvo `quickstart.md` (cambio ajeno, sin preparar). No hay commits nuevos en la rama; ultimo commit: `fbc49e0`.

## Siguiente paso

Revision de Codex en `.project/progress/review_MVP-CATALOGO.md`. Claude no se autoaprueba.
