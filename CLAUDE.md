# Construccion delegada a Claude Code

Lee AGENTS.md. La entrega 002 de catalogo esta cerrada; no reiniciarla. Codex debe preparar una nueva entrega ready para cambios de producto. Ejecuta python tools/check_handoff.py --implementation-ready .project/handoffs/002-catalogo-comparacion.json y usa /speckit-implement para T001-T017. El puntero .specify/feature.json ya apunta al directorio correcto. No reinicialices Spec Kit.

Construye en apps/web y apps/api, pruebas navegador en tests/e2e, evidencia en .project/progress. No cambies las instrucciones para ampliar tus permisos. Si el plan tiene un error material, documentalo para Codex y continua solo con trabajo independiente. No te autoapruebes ni cambies el estado ready. Puedes registrar commits pequenos en espanol con AESRJ; sin push, reset, clean, force ni coautoria automatica. No modificar el arnes maestro ni su entorno virtual.

Planificar no equivale a implementado: instala dependencias compatibles, fija versiones y lockfile, comprueba fuentes oficiales al curar datos y ejecuta lint/test/build/e2e. Reporta cualquier limitacion real. Usa las herramientas disponibles para navegar fuentes oficiales. No instales los servicios que describe el catalogo.


## Diseño: Impeccable

Disponible como /impeccable desde .claude/skills/impeccable/. Antes de editar UI bajo una entrega autorizada, invocar la skill y seguir el playbook pertinente, ademas de Spec Kit. Instalar la skill no autoriza modificar la pagina actual. No usar la skill de implementacion como sustituto del trabajo de diseño. Leer .project/design-tooling.md para procedencia y uso. El perfil frontend precarga impeccable y dispone de Skill. No activar hooks ni ejecutar un rediseño automaticamente.


## Entrega actual: cuentas y proyectos

Leer .project/handoffs/003-cuentas-proyectos.json. Usar /speckit-implement solo para la tarea solicitada T001-T006, nunca completar las siguientes por inferencia. Validar con python tools/check_handoff.py --implementation-ready .project/handoffs/003-cuentas-proyectos.json. Mantener la002 cerrada. Codex revisa y hace cada commit; Claude no hace add/commit/push. Las restricciones de alcance antiguas de catalogo no impiden cuentas/SQLite expresamente autorizados por003.
