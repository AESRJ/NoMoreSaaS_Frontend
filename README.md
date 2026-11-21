# NoMoreSaaS - aplicacion

Repositorio de codigo separado de [la planificacion y arnes maestro](https://github.com/AESRJ/NoMoreSas).

- `apps/web`: SPA React 19 + Vite 8 + React Router 8 (modo declarativo) + Zustand 5.
- `apps/api`: Node.js + Express 5 + Helmet; API JSON de solo lectura sobre `apps/api/data/catalog.json`.
- `tests/e2e`: Playwright con la API y la web reales.
- `.project/`: snapshot SDD, tareas y evidencia de construccion.
- `tools/`: comprobacion ligera de la entrega; `.specify/` y skills ocultos conservan GitHub Spec Kit.

## Incremento actual

Catalogo publico de alternativas autoalojables (3 SaaS, 4 alternativas curadas con fuentes oficiales y fecha), busqueda por nombre, fichas con fuentes y evaluaciones editoriales identificadas, y comparacion de 2 a 3 alternativas. Sin cuentas, base de datos, estimador, instalacion de servicios ni despliegue.

## Requisitos

- Node.js 26.13.1 (minimo efectivo por dependencias: >=22.22.2) y pnpm 12.21.0 (`packageManager` fijado).
- En PowerShell, usar `pnpm.cmd` si la politica bloquea `pnpm.ps1`.

## Comandos

```powershell
pnpm install --frozen-lockfile   # dependencias exactas segun pnpm-lock.yaml
pnpm dev                         # API en 127.0.0.1:3001 y web en http://127.0.0.1:5173 (proxy /api)
pnpm lint                        # ESLint sobre apps, pruebas y configuracion propia
pnpm test                        # Vitest: API (Supertest), store, cliente y UI (Testing Library)
pnpm build                       # build de la SPA en apps/web/dist
pnpm exec playwright install chromium   # prerrequisito de e2e (una vez por maquina)
pnpm test:e2e                    # Playwright: arranca y cierra API y web reales, 1280 y 360 px
```

Variables opcionales en `.env.example` (`API_HOST`, `API_PORT`, `WEB_HOST`, `WEB_PORT`). Por defecto todo escucha solo en `127.0.0.1`. La API valida el catalogo al arrancar y no inicia si es invalido.

Las capturas que genera `pnpm test:e2e` se guardan en `.local/screenshots/` (no versionado).

## Limites conocidos

- La seleccion de comparacion vive en memoria y se reinicia al recargar (por diseno).
- No hay hosting de produccion: el proxy `/api` solo existe en el servidor de desarrollo de Vite.
- Accesibilidad comprobada en recorridos de teclado y nombres accesibles; no es una auditoria WCAG completa.

Ejecutar `init.cmd` (Python 3.12 para el verificador de la entrega). Leer `.project/context.md` antes de trabajar. Configuraciones MCP propias de la maquina son locales e ignoradas. La aplicacion no depende de Python ni de NotebookLM para ejecutarse.
