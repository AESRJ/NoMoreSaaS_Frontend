# Verificacion

Entrega: `init.cmd` (verificador del arnes, Python). Sin argumentos valida la entrega actual: el puntero local `.specify/feature.json` (ignorado por Git) o, si falta como en un clon limpio/CI, la referencia versionada `.project/identity-source.json`; nunca vuelve en silencio a otra entrega. `init.cmd --handoff .project/handoffs/002-catalogo-comparacion.json` revisa la 002 cerrada; rutas fuera del checkout se rechazan.

Producto (desde la raiz, Node 26.13.1 y pnpm 12.21.0):

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e` inicia la API y la web mediante `webServer` de Playwright en `API_PORT`/`WEB_PORT` (por defecto 127.0.0.1:3001 y :5173; los puertos deben estar libres) y las cierra al terminar; ejecuta los proyectos `escritorio-1280` y `movil-360`. La API de prueba usa una DB SQLite nueva en un directorio temporal propio (migrada antes de arrancar y borrada al salir), un secreto generado en runtime, `APP_ORIGIN` igual a la web de prueba y `CATALOG_PATH` del seed canonico: el `.env` y la DB de desarrollo no intervienen.

- `tests/e2e/catalog.spec.js`: catalogo publico; carga/error/vacio simulados solo con `page.route`.
- `tests/e2e/identity.spec.js` (API real, sin mocks): acceso directo protegido, registro con teclado, crear/recargar/editar, borrado con cancelacion y confirmacion, salir y entrar; dos identidades (UI y cliente HTTP: mismo 404 que un UUID inexistente, 403 sin CSRF u origen ajeno); 401 sin sesion; errores al guardar (403 real con token alterado, red, 401 por cookie eliminada) con valores conservados y sin reenvio automatico.

La expiracion por inactividad/absoluta y el reinicio con la misma DB se prueban con reloj inyectado y archivo temporal en las pruebas de integracion de la API (`apps/api/tests/auth.test.js`, `projects.test.js`), no esperando 30 minutos en navegador.

Capturas a 360/1280 en `.local/screenshots/` (no versionado). Resultados reales en `.project/progress/impl_MVP-CATALOGO.md` y `impl_MVP-IDENTIDAD.md`; revision de seguridad breve en `security_MVP-IDENTIDAD.md`.

CI: `.github/workflows/catalog.yml` repite los mismos pasos y el verificador de entrega; no se ha comprobado aqui su ejecucion en GitHub.

## Cierre004 — 2026-11-22
Revisión independiente: `pnpm lint`, `pnpm build`, `pnpm test` (254API/169web), `API_PORT=3501 WEB_PORT=5773 pnpm exec playwright test` (38/38, variables establecidas en PowerShell antes de invocar pnpm). Suites completas ejecutadas una vez al cierre tras los últimos cambios; sin repetirlas tras documentación.
Nuevos e2e: workflow.spec.js (perfil/evaluación/plan/avance/401) y portada.spec.js (PNGreal200/hash/dimensiones, paleta calculada y computadora centrada). Prueba adicional del revisor con API3351/web5583/DBtemporal: clipboard real, progreso trasrecarga, sin errores/desbordamiento360/1280. Integración API con reinicio real conserva sesión/perfil/avance y verifica ownership/CSRF/409.
Higgsfieldjob ade277e0-1c97-4ed2-9256-26620b81639d; PNGlocal766682bytes/SHA2566acf743b9e6bd95e06b45d06a2d37b45735b7d4feec26a024f1e8101b46012f4. No depender de URL temporal del proveedor en el producto. Ver review_MVP-CIERRE.md para aceptación y límites. CI conserva comandos equivalentes; ejecución remota de esta rama no comprobada, sin push.

## Revision006 - 2026-11-22 (codigo aceptado, Googlelive pendiente)
Codex: T003 API99/99 + web16/16/lint, T004 web195/195/build, T005 OIDC37/37/lint y navegador14/14 account/google-login/identity en3501/5773 conDBtemporal. Capturas360/1280 inspeccionadas. Claude integracion API312/web195/e2e54/lint/build/initPASS. Reagrupacion de fixtures conserva limite10registros/IP/15min; antes12registros causaron52/54. Pruebas proveedor simulado ySDKconRSA local no sonGooglevivo. Googlelive requiere cliente/consentimiento/variablesprotegidas yprueba entrar/cancelar/logout/vincular. Estado blocked/code_reviewed=true, reporte review_AUTH-GOOGLE.md; no publicacion por buildlocal.
