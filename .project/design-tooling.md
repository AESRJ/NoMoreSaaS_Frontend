# Diseño con Impeccable en Claude Code

Instalada por solicitud del usuario el 2026-11-21 en .claude/skills/impeccable/ de este repositorio. Scope de proyecto: no modifica el catalogo global de Claude ni instala skills en Codex.

- Fuente: https://github.com/pbakaus/impeccable/tree/b49177d32788f2dc585c42831d845dacf1ebed2c/.claude/skills/impeccable
- Revision: b49177d32788f2dc585c42831d845dacf1ebed2c; version de SKILL.md: 4.10.0.
- Se instala la carpeta completa con referencias, scripts y manifiesto de checksums. LICENSE y NOTICE.md originales conservados. No se modifica el codigo del proveedor.
- Detalles y hashes de archivos instalados en .project/impeccable-install.json.

## Uso

Abrir una nueva sesion de Claude Code en este repositorio para que vuelva a descubrir las skills. Invocar /impeccable con el objetivo o subcomando concreto. Ejemplos para una futura tarea autorizada: /impeccable critique apps/web o /impeccable shape <pantalla>. Una invocacion sin argumentos presenta un menu; no ejecuta por si sola un rediseño.

CLAUDE.md exige usar la skill para trabajo visual autorizado, y el perfil frontend la precarga mediante skills: impeccable, con acceso a Skill. Codex mantiene la planificacion/revision; Claude diseña e implementa dentro de la entrega. No se reemplaza el stack ni se autoaprueba el resultado.

## Launcher y limites

En Windows el launcher es .claude/skills/impeccable/scripts/impeccable.cmd. El proveedor incluye VERSION y engine-checksums.txt; si no existe el motor, el launcher descarga el binario oficial fijado y verifica su hash. La comprobacion de instalacion debe distinguir descubrir la skill de ejecutar su motor. No se asume que instalar SKILL.md baste para afirmar que el motor funciona.

No se activan hooks de deteccion ni se crean PRODUCT.md/DESIGN.md o cambios de UI durante esta instalacion. Esas acciones requieren una tarea de diseño con contexto y alcance definidos. Capturas, caches y logs locales no se versionan.

## Verificacion realizada: 2026-11-21

Una sesion nueva de Claude Code incluyo impeccable en system.init.skills y termino correctamente sin invocar herramientas. El launcher Windows ejecuto engine-probe y respondio impeccable-engine 0.1.27; cache local ignorada en .local/impeccable-engine. Se comprobaron los hashes de todos los archivos del manifiesto y la precarga del perfil frontend. Evidencia resumida en .project/impeccable-verification.json; logs locales ignorados. No se ejecuto ningun comando de diseño ni se cambio el producto.
