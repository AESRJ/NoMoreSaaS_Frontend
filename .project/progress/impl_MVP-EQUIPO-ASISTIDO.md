# Implementación MVP-EQUIPO-ASISTIDO (007)

## T001 — Recopilador Windows y guía (Claude, 2026-11-22)

### Archivos (todos nuevos)
- `tools/diagnostic/nomoresaas-diagnostico.mjs`: fuente del recopilador (Node 22+, Windows 10/11). Comprueba la versión de Node y que sea win32, hace una única consulta CIM fija (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -NoLogo -Command <constante>`, `execFile` sin shell, timeout 20 s, windowsHide, maxBuffer 256 KiB), sin ExecutionPolicy Bypass, sin red y sin nada que dependa de la entrada del usuario. Selecciona solo Win32_Processor Name/NumberOfCores/NumberOfLogicalProcessors, Win32_ComputerSystem TotalPhysicalMemory, Win32_LogicalDisk DriveType=3 FreeSpace/Size, Win32_VideoController Name. Normaliza a Diagnostic v1 (`schemaVersion`, `capturedAt`, `os`, `architecture`, `cpu`, `ramBytes`, `volumes` "Volume N", `gpuNames` opcional) con los rangos de data-model.md; los valores ausentes o fuera de rango quedan desconocidos y nunca se truncan a un valor válido (solo el texto se recorta a 200). Recurre a `os.totalmem` si CIM no da la RAM. Exportación ≤64 KiB, un único `writeFileSync` con flag `wx`; si el archivo existe falla sin sobrescribirlo. Solo acepta los argumentos `--output <archivo>`, `--output=<archivo>` y `--help`.
- `tools/diagnostic/build.mjs`: copia la fuente a `apps/web/public/downloads/` y genera `.sha256`.
- `tools/diagnostic/test/collector.test.mjs` y `test/fixtures/cim-typical.json`, `cim-hostile.json` (valores ficticios).
- `apps/web/public/downloads/nomoresaas-diagnostico.mjs` (copia idéntica), `nomoresaas-diagnostico.mjs.sha256`, `nomoresaas-diagnostico-LEEME.txt` (guía: requisitos, qué lee y qué no, uso, verificación del hash y límites).

### Comandos y resultados
- `python tools/check_handoff.py --implementation-ready .project/handoffs/007-equipo-y-plan-seguro.json`: OK, ready (antes y después).
- `node tools/diagnostic/build.mjs`: copia publicada.
- `node --test tools/diagnostic/test/`: 16/16 PASS. Primera ejecución 15/16: una prueba dejó que se usara el `os.totalmem` por defecto y leyó de forma incidental la RAM real de este equipo; el valor solo apareció en la salida del fallo, no se conservó en archivos ni evidencia. La prueba se corrigió para inyectarlo.
- `pnpm lint`: PASS (la copia de `apps/web` necesitó `/* global process, Buffer */` porque la configuración de eslint no da globals de Node a `.mjs`; no se cambió eslint.config).
- `node apps/web/public/downloads/nomoresaas-diagnostico.mjs --help` → ayuda y salida 0; sin argumentos → uso y salida distinta de 0. Ninguna de las dos rutas consulta el sistema.

### Límites
- No se ejecutó la consulta CIM real ni se generó inventario de este equipo: las pruebas inyectan la consulta, la escritura, la plataforma y la RAM. La ejecución real en Windows 10/11 con Node 22 sigue siendo una dependencia externa pendiente (handoff external_dependencies).
- Solo Windows; en otros sistemas termina con un mensaje y sin escribir nada. storageKind y CPU x86-v2 no se exportan (desconocidos).
- No se modificaron README, eslint.config, la UI, la API ni los archivos de 006. Sin enlace en la UI ni import (T002). Nota para Codex: `ProfileProvenance.collectorVersion` no tiene campo en Diagnostic (el esquema rechaza los extra); el script expone `COLLECTOR_VERSION = '1.0.0'`, pero no lo exporta en el JSON.
- Sin git add/commit.

### Corrección tras revisión Codex (arquitectura)
- Motivo: `Diagnostic.architecture` salía de `process.arch`, que describe el binario de Node (x64 puede ir emulado en Windows ARM64).
- Cambio en `tools/diagnostic/nomoresaas-diagnostico.mjs`: la misma consulta Win32_Processor selecciona además `Architecture` (sigue habiendo 4 `Get-CimInstance`). `mapArchitecture(processors)` da 9→amd64 y 12→arm64 solo si todos los procesadores informan el mismo valor entero conocido; si falta, es desconocido, no es entero o hay mezcla, da `unknown`. Se eliminó todo uso de `process.arch`/`os.arch()`. El esquema Diagnostic v1 no cambia.
- Pruebas (fixtures; `cim-typical.json` lleva `Architecture: 9`): x64, ARM64, Node x64 con CIM ARM64→arm64, ausente/0/5/6/99/-1/null/'9'/9.5/'ARM64'→unknown, multiprocesador coherente/mezclado/con faltante, consulta con Architecture y 4 consultas, y la fuente sin `process.arch`/`os.arch()`. Todas inyectan plataforma, RAM, consulta, escritura y entorno.
- Reproducción previa: `node --test tools/diagnostic/test/` → 20 pruebas, 16 PASS / 4 FAIL (consulta sin Architecture, Node x64+CIM ARM64, ausente/desconocido, multiprocesador).
- Tras corregir: `node tools/diagnostic/build.mjs` (copia + SHA-256 `97e0d54c129b1c0fea68629fce2750726385bc6ba4436a48eb85a914a277e720`), `node --test tools/diagnostic/test/` 20/20 PASS, `pnpm lint` PASS.
- Sin consulta CIM real. Decisión Codex para T002 (collectorVersion=null) anotada; no se cambió el JSON. Sin git add/commit.

### Corrección tras revisión Codex (finales de línea)
- Motivo: con `core.autocrlf=true` y `text=auto`, un checkout Windows podía convertir la fuente, la copia y el `.sha256` a CRLF y romper la igualdad y el checksum.
- `.gitattributes` (permitido por Codex en el handoff): se añadieron 3 reglas `text eol=lf` para `tools/diagnostic/nomoresaas-diagnostico.mjs`, `apps/web/public/downloads/nomoresaas-diagnostico.mjs` y `.sha256`. Reglas previas conservadas; sin renormalizar ni tocar el índice.
- Prueba nueva en `collector.test.mjs`: los tres archivos no contienen bytes CR, y `git check-attr text eol` (solo lectura) devuelve `text: set` y `eol: lf` para cada uno.
- `node tools/diagnostic/build.mjs`: contenido sin cambios, SHA-256 `97e0d54c129b1c0fea68629fce2750726385bc6ba4436a48eb85a914a277e720`. `node --test tools/diagnostic/test/` 21/21 PASS. `pnpm lint` PASS.
- Límite: la verificación en un clon temporal aislado con `core.autocrlf=true` (script `%TEMP%\nms-eol-check\verify.sh`, fuera del repo) no se ejecutó porque la herramienta pidió una aprobación no disponible en esta sesión; no se eludió. Queda para Codex si la quiere. Sin hardware real ni git add/commit.
