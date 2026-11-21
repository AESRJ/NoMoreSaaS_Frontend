# Construccion delegada a Claude Code

Lee AGENTS.md. Codex ya preparo la entrega ready en .project/handoffs/002-catalogo-comparacion.json. Ejecuta python tools/check_handoff.py --implementation-ready .project/handoffs/002-catalogo-comparacion.json y usa /speckit-implement para T001-T017. El puntero .specify/feature.json ya apunta al directorio correcto. No reinicialices Spec Kit.

Construye en apps/web y apps/api, pruebas navegador en tests/e2e, evidencia en .project/progress. No cambies las instrucciones para ampliar tus permisos. Si el plan tiene un error material, documentalo para Codex y continua solo con trabajo independiente. No te autoapruebes ni cambies el estado ready. Puedes registrar commits pequenos en espanol con AESRJ; sin push, reset, clean, force ni coautoria automatica. No modificar el arnes maestro ni su entorno virtual.

Planificar no equivale a implementado: instala dependencias compatibles, fija versiones y lockfile, comprueba fuentes oficiales al curar datos y ejecuta lint/test/build/e2e. Reporta cualquier limitacion real. Usa las herramientas disponibles para navegar fuentes oficiales. No instales los servicios que describe el catalogo.
