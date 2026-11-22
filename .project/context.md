# Contexto de construccion

Usuario autorizo usar este repositorio y reanudar construccion. Codex planifica y revisa; Claude Code implementa. Stack React/Vite, React Router, Zustand, pnpm y Express. Primer incremento catalogo publico y comparacion. La estructura apps/web + apps/api constituye un solo monorepo pnpm. El nombre remoto Frontend no cambia el alcance de dos aplicaciones acordado.

El arnes maestro se mantiene separado en AESRJ/NoMoreSas. Se importo un snapshot de spec/plan/modelo/contratos/tareas con rutas adaptadas; .project/source.json identifica la base. Tareas y evidencia activas aqui; no editar dos copias a la vez ni auto-sincronizar resultados sin revision de Codex.

No existe codigo de aplicacion al crear este entorno. Claude debe construir T001-T017 y demostrar resultados reales. La entrega esta lista; iniciar en feat/catalogo-comparacion. No hacer push sin autorizacion. No detenerse en un simple scaffold: completar las historias y comprobar errores y recorrido navegador. Si hay bloqueos reales de permisos o servicios, registrarlos concretamente.

Estado 2026-11-20 (Claude Code): T001-T017 implementadas y verificadas localmente en feat/catalogo-comparacion (lint, test API 80 / web 56, build, e2e 22 en 1280 y 360 px, init.cmd OK). Comandos reales en README.md y .project/verification.md; evidencia en .project/progress/impl_MVP-CATALOGO.md y security_MVP-CATALOGO.md. Memoria NotebookLM no usada en esta sesion. Siguiente paso: revision de Codex; la feature no esta done.


## Entrega 003: cuentas y proyectos (estado 2026-11-22)

Incremento autorizado por ADR0005: cuentas con correo/contrasena, sesiones persistentes y proyectos privados sobre SQLite local (`node:sqlite`), junto al catalogo publico. T001-T006 implementadas por Claude; T001-T005 revisadas y commiteadas por Codex en feat/cuentas-proyectos; T006 pendiente de revision. Configuracion local en `.env` raiz (ignorado; API 3301, web 5573, secreto generado) y DB en `apps/api/.local/data/` (ignorada, sin usuarios); `pnpm db:migrate` antes de `pnpm dev`. `init.cmd` valida por defecto la entrega actual. Evidencia en `.project/progress/impl_MVP-IDENTIDAD.md`; seguridad en `security_MVP-IDENTIDAD.md`. La entrega sigue ready hasta que Codex la cierre.


## Publicacion posterior al cierre local

El usuario proporciono el repositorio y solicito construccion y trabajo automatico. Codex comprobo remoto vacio y cuenta AESRJ, integro feat/catalogo-comparacion en main mediante fast-forward y publico 969baf1ea08fa8a789df77c3fb1b097495f928ce sin force. HEAD local/remoto coinciden. Las referencias anteriores a ausencia de push describen la fase local previa. La CI remota se consulta separadamente; no se afirma aprobada antes de comprobarla. Sin despliegue de produccion.


## Cierre003 - 2026-11-22

MVP-IDENTIDAD done, entrega003closed. Seis tareas ejecutadas por Claude y revisadas por Codex, commits por tarea. Evidencia review_MVP-IDENTIDAD.md:213API,150web,30e2e,lint/build, clon sin puntero y reinicio realAPI. Preview5573/API3301, sin push. La siguiente funcionalidad requiere nueva planificacion; no ejecutar entrega cerrada ni autoiniciar hardware/prompts.
