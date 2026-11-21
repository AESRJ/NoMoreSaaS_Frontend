# Verificacion

Entrega: `init.cmd` (verificador del arnes, Python).

Producto (desde la raiz, Node 26.13.1 y pnpm 12.21.0):

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e` inicia la API (127.0.0.1:3001) y la web (127.0.0.1:5173) mediante `webServer` de Playwright y las cierra al terminar; ejecuta los proyectos `escritorio-1280` y `movil-360`. Los estados de carga, error y vacio se simulan solo con `page.route` dentro de las pruebas; el seed real no se modifica. Si falta el navegador o un permiso, registrar el prerrequisito real y no dar la prueba por superada.

Las capturas de catalogo, ficha y comparacion a 360/1280 quedan en `.local/screenshots/` (no versionado). Seguir `.project/specs/002-catalogo-comparacion/quickstart.md` para la aceptacion manual. Resultados reales de cada ejecucion en `.project/progress/impl_MVP-CATALOGO.md`.

CI: `.github/workflows/catalog.yml` repite los mismos pasos; no se ha ejecutado en GitHub (sin push autorizado).
