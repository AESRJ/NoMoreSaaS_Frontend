# Bitacora

Entorno aislado preparado por Codex para delegar la construccion a Claude. Snapshot del arnes maestro y rutas agrupadas en .project/. No se crea codigo de producto con Codex.

## 2026-11-20 · Claude Code · construccion MVP-CATALOGO

- Sesion 1: node/pnpm/powershell bloqueados por aprobacion no disponible; registrado sin esquivar. Curadas fuentes oficiales (Nextcloud, Immich, Gitea, Forgejo) y versiones npm; escrito `apps/api/src/catalog.js`.
- Sesion 2 (entorno corregido por Codex): T001-T017 implementadas. Monorepo pnpm con apps/web (React 19, Vite 8, React Router 8 declarativo, Zustand 5) y apps/api (Express 5, Helmet). Seed de 3 SaaS y 4 alternativas con fuentes fechadas.
- Verificacion real: `pnpm lint` 0; `pnpm test` API 80 y web 56 aprobadas; `pnpm build` 0; `pnpm test:e2e` 22 aprobadas; `pnpm audit` sin vulnerabilidades; `init.cmd` OK.
- Corregidos durante la verificacion: nombre accesible del boton, perdida de pulsaciones en la busqueda (transiciones de React Router), desbordamiento a 360 px, codigo de error fuera de contrato.
- Limitaciones: CI no ejecutado (sin push); LICENSE de Forgejo no legible automaticamente (respaldada por README); `rm` denegado (se uso `mv`); cambio ajeno en quickstart.md sin tocar.
- `git commit` bloqueado por aprobacion no disponible: cambios preparados (staged), sin commits nuevos.
- Siguiente: revision de Codex. Sin autoaprobacion.


## Revision y cierre por Codex

Revision independiente: lint, 80 pruebas API, 56 web, build y 22 e2e correctas. Capturas examinadas y R1 visual resuelto en la ultima version de Claude sin necesidad de otra modificacion. Entrega cerrada por el revisor, sin autoaprobacion del constructor. Se conserva la excepcion de proceso T002 declarada en el informe, sin fabricar evidencia. Verificador de infraestructura ajustado para permitir consulta de una entrega cerrada y rechazar reinicio. Commits preparados por Codex con identidad AESRJ; no se usa git -c ni se amplian permisos del constructor para eludir la denegacion que encontro. Sin push.


## Integracion y publicacion automatica

Tras la instruccion de trabajo automatico del usuario, Codex verifico cuenta AESRJ, arbol limpio y remoto aun vacio. Integro por fast-forward en main y publico el incremento revisado 969baf1, sin force y sin despliegue. git ls-remote y HEAD coinciden. La revision y los commits de producto siguen atribuidos a AESRJ con asistencia de Claude/Codex documentada. La CI remota se verifica aparte. Preview localhost iniciado y salud/HTTP comprobados.

## 2026-11-22 · Claude Code · MVP-IDENTIDAD T006

T006 implementada, pendiente de revision de Codex: e2e de identidad con la API real (8 casos en 360/1280), aislamiento de CATALOG_PATH en e2e, lectura de puertos del .env raiz en Vite sin exponer secretos, verificador de entrega portable (puntero local o identity-source.json; 002 con --handoff) y CI, README, verification y revision de seguridad breve. Lint 0, API 213, web 149, build OK, e2e 30/30 solo en puertos alternativos (3301 ocupado por un proceso ajeno, no detenido), init.cmd 6/6. Se crearon .env y la DB local por defecto, ignorados y sin usuarios. Sin commit, push ni cierre de entrega.

## 2026-11-22 · Claude Code · MVP-IDENTIDAD T006 ronda 2

Se aisla `vite-config.test.js` de los puertos heredados con vi.stubEnv/unstubAllEnvs (sin cambios de produccion). Comandos oficiales con API_PORT=3501/WEB_PORT=5773 en el entorno del proceso: lint 0, test web 150 y API 213, build OK, `pnpm test:e2e` 30/30. Esto supera la limitacion anterior: 3301 lo ocupaba el preview de Codex. Sin commit, push ni cierre.

## 2026-11-22 - Revision y cierre003 por Codex

T001-T006 aceptadas tras revision independiente:lint,213API,150web,build y30e2e correctos, verificador actual/clon limpio y reinicio realAPI a360/1280. Entrega003closed; MVP-IDENTIDADdone. Cuota deClaude restablecida y correcciones terminadas; sin sustituirconstructor ni publicar. Evidencia:review_MVP-IDENTIDAD.md.
