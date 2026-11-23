# NoMoreSaaS - aplicacion

Repositorio de codigo separado de [la planificacion y arnes maestro](https://github.com/AESRJ/NoMoreSas).

- `apps/web`: SPA React 19 + Vite 8 + React Router 8 (modo declarativo) + Zustand 5.
- `apps/api`: Node.js + Express 5 + Helmet + express-session; catalogo JSON publico de solo lectura (`apps/api/data/catalog.json`), cuentas y proyectos privados sobre SQLite local (`node:sqlite`).
- `tests/e2e`: Playwright con la API, la DB temporal y la web reales.
- `.project/`: snapshot SDD, tareas y evidencia de construccion.
- `tools/`: comprobacion ligera de la entrega; `.specify/` y skills ocultos conservan GitHub Spec Kit.

## Incrementos

- Catalogo publico de alternativas autoalojables (5 SaaS, 5 alternativas curadas con fuentes oficiales y fecha), busqueda y fichas con fuentes. Sigue sin requerir cuenta.
- Exploracion por servicio (entrega 005): se parte del servicio que se usa; cada servicio es un circulo que despliega el arbol de sus alternativas y, al elegir una, la comparativa servicio/alternativa en la misma pagina (con fuentes oficiales y datos desconocidos marcados como tales). La comparacion global y `/comparar` se retiraron; esa ruta redirige al catalogo. Crear/editar proyecto tambien parte de buscar el servicio y muestra chips «servicio → alternativa».
- Cuentas y proyectos privados (entrega 003): registro, entrada y salida con correo y contrasena (Argon2id, sesion de servidor persistente en SQLite, cookie HttpOnly/SameSite=Lax, CSRF sincronizador). Cada cuenta crea, edita y borra (con confirmacion) hasta 100 proyectos con nombre, descripcion y 1-10 alternativas del catalogo; nadie mas puede verlos. Sin verificacion o recuperacion de correo, borrado de cuenta, instalacion de servicios ni despliegue.
- Acceso con Google (entrega 006): «Continuar con Google» en entrar/registro y vinculacion desde «Mi cuenta» con la contraseña actual (OIDC de servidor, sin SDK ni tokens en el navegador). Una coincidencia de correo nunca vincula cuentas. Solo se activa con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI`; sin ellas no aparece el boton. La migracion 003 separa las contraseñas en `password_credentials` y conserva usuarios, hashes y proyectos (respaldar la DB antes de `pnpm db:migrate`). El acceso real con Google sigue sin probar: guia en `.project/docs/setup-google.md`.

## Flujo final disponible (004)

Catálogo: Nextcloud, Immich, Matrix/Synapse, WireGuard y Outline wiki. Se retiraron GitHub/Gitea/Forgejo de nuevas selecciones; los proyectos antiguos conservan sus referencias. Outline es código disponible bajo BSL1.1, no open source.

1. Buscar el servicio que se usa, abrir sus alternativas y compararlas en la portada; crear cuenta o entrar.
2. Crear proyecto y abrir **Equipo, evaluación y plan**.
3. Guardar hardware y carga prevista; revisar estimación, ecuaciones, fuentes y condiciones pendientes.
4. Abrir Plan, copiar prompts por etapa y marcar avances; recargar conserva datos.
5. Editar equipo/selección recalcula el plan y evita aplicar avances de otra versión.

Recursos orientativos con presupuesto editorial y márgenes explícitos; no son un benchmark ni garantía. Prompts mediante plantillas, sin claves de IA ni instalaciones automáticas. Migración002 aditiva, respaldar DB existente antes de migrar. Preview local configurado en esta máquina: http://127.0.0.1:5573 (API3301).

## Requisitos

- Node.js 26.13.1 (`engines`; `node:sqlite` y `crypto.argon2`) y pnpm 12.21.0 (`packageManager` fijado).
- En PowerShell, usar `pnpm.cmd` si la politica bloquea `pnpm.ps1`.

## Configuracion local

Copiar `.env.example` a `.env` en la raiz (ignorado por Git) y completar `SESSION_SECRET` con al menos 32 bytes aleatorios generados localmente (el ejemplo muestra como). `APP_ORIGIN` debe ser exactamente el origen de la web (http solo en loopback). `DATABASE_PATH` vacio usa `apps/api/.local/data/nomoresaas.sqlite` (ignorado). La API lee el `.env` con `--env-file-if-exists`; Vite solo lee de el `API_HOST`, `API_PORT`, `WEB_HOST` y `WEB_PORT` para el servidor de desarrollo, y ninguna variable de servidor llega al bundle. Las variables del entorno del proceso prevalecen sobre el `.env`.

Sin configuracion valida o con la DB sin migrar la API no arranca (nunca usa memoria como sustituto): ejecutar `pnpm db:migrate` una vez, es idempotente y no borra datos.

## Comandos

```powershell
pnpm install --frozen-lockfile   # dependencias exactas segun pnpm-lock.yaml
pnpm db:migrate                  # aplica migraciones SQLite pendientes a la DB configurada
pnpm dev                         # API y web segun .env (por defecto 127.0.0.1:3001 y :5173; proxy /api)
pnpm lint                        # ESLint sobre apps, pruebas y configuracion propia
pnpm test                        # Vitest: API (Supertest, DB temporales), store, clientes y UI (Testing Library)
pnpm build                       # build de la SPA en apps/web/dist
pnpm exec playwright install chromium   # prerrequisito de e2e (una vez por maquina)
pnpm test:e2e                    # Playwright: API (DB y secreto temporales) y web reales, 1280 y 360 px
```

`pnpm test:e2e` nunca usa el `.env` de desarrollo para datos: cada ejecucion crea una DB nueva en un directorio temporal, un secreto en memoria, `APP_ORIGIN` igual a la web de prueba y fija `CATALOG_PATH` al seed canonico. Usa `API_PORT`/`WEB_PORT` del entorno (por defecto 3001/5173), que deben estar libres. Las capturas se guardan en `.local/screenshots/` (no versionado).

## Limites conocidos

- El servicio y la alternativa abiertos en la portada no se guardan en la URL; solo la busqueda (`?q=`) es compartible.
- La comparativa no publica precios ni paridad de funciones: lo que el catalogo no documenta del servicio SaaS se muestra como desconocido.
- No hay hosting de produccion: el proxy `/api` solo existe en el servidor de desarrollo de Vite. Antes de produccion faltan HTTPS, verificacion/recuperacion de correo, borrado de cuenta y operacion.
- SQLite local de un solo proceso; los limitadores de intentos viven en memoria y se reinician con la API.
- Accesibilidad comprobada en recorridos de teclado y nombres accesibles; no es una auditoria WCAG completa.

Ejecutar `init.cmd` (Python 3.12 para el verificador de la entrega): valida por defecto la entrega actual (puntero local `.specify/feature.json` o, en un clon sin el, `.project/identity-source.json`); `init.cmd --handoff .project/handoffs/002-catalogo-comparacion.json` revisa la entrega anterior. Leer `.project/context.md` antes de trabajar. Configuraciones MCP propias de la maquina son locales e ignoradas. La aplicacion no depende de Python ni de NotebookLM para ejecutarse.
