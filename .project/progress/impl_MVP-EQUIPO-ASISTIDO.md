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

## T002 — Importación, ayuda del navegador y procedencia (Claude, 2026-11-22)

### Archivos
- Nuevo `apps/api/migrations/004-profile-provenance.sql`: tabla aditiva `project_profile_provenance` (FK proyecto CASCADE, target this-device|other-device, fields JSON objeto ≤4096, collector_version NULL|1–40, updated_at). Sin cambios en tablas previas; perfiles anteriores sin fila = manual/declared. Sin DROP; rollback de aplicación conservando la tabla.
- `apps/api/src/workflow.js`: `parseProvenance`/`parseProfileRequest` (allowlist, combinaciones coherentes: manual→declared sin fecha; browser→approximate solo cpuCores/ramGiB y solo this-device; import→reported solo cpuCores/ramGiB/storageGiB/os/architecture; capturedAt ISO real ≤ ahora+5 min; collectorVersion null o versión ≤40). PUT perfil guarda perfil y procedencia en la misma transacción con owner; la revisión sube si cambian valores u origen/certeza efectivos (invalida plan/avance); destino/fecha solos actualizan metadatos sin revisión; sin procedencia (cliente antiguo) = todo manual y se borra la fila. GET/PUT devuelven `provenance` aparte del perfil (fingerprint igual que antes). Límite JSON 16 KiB intacto; el diagnóstico no llega a la API.
- Nuevo `apps/web/src/diagnostic.js`: validación estricta Diagnostic v1 (≤64 KiB, sin extras/anidamientos, rangos, fechas; aviso >30 días y no-Windows), filas de importación (bytes→GiB hacia abajo a 2 decimales; desconocido/fuera de rango no rellena; hilos lógicos no sustituyen núcleos físicos), `readBrowserHints` (hardwareConcurrency/deviceMemory aproximados; sin storage.estimate).
- Nuevo `apps/web/src/components/ProfileAssist.jsx` y cambios en `apps/web/src/pages/WorkflowPage.jsx`: elección de equipo destino, ayuda del navegador solo para este equipo con confirmación, importación con vista previa y volumen, enlaces a la descarga/guía de T001, insignias de origen por campo, edición manual → manual, cambiar destino vacía lo del navegador, guardado explícito (sin destino se envía como antes). `apps/web/src/api/workflow.js` (envía procedencia con collectorVersion null; lee `provenance` opcional), `apps/web/src/store/projectDraft.js` (borrador conserva procedencia), `apps/web/src/styles.css` (banda sin tarjeta anidada, tokens existentes; alineación de campos en el grid).
- Pruebas: `apps/api/tests/workflow.test.js` (+6 de procedencia, 2 expectativas de forma actualizadas), `apps/api/tests/db.test.js` (expectativas de versión 4 y prueba aditiva 004 sobre DB 003 con datos), nuevo `apps/web/tests/diagnostic.test.jsx` (16), `tests/e2e/workflow.spec.js` (recorrido de importación/navegador añadido al existente para no sumar registros por IP; valores del navegador inyectados con addInitScript y diagnóstico fixture).

### Comandos y resultados
- `pnpm --filter @nomoresaas/api exec vitest run tests/workflow.test.js tests/db.test.js`: 45 previas con 8 fallos esperados por la nueva migración y el campo `provenance`; tras actualizar y ampliar, 52/52.
- `pnpm --filter @nomoresaas/web exec vitest run tests/diagnostic.test.jsx tests/workflow.test.jsx tests/projects.test.jsx`: 70/70 (primera ejecución 14/16 en diagnostic: una aserción sobrante y `readBrowserHints(undefined)`, que leyó el `navigator` de jsdom (refleja el número de CPUs de la máquina de pruebas); el valor solo apareció en la salida del fallo, no se conservó; la prueba usa ahora `null`).
- Suites una vez por el cambio de forma del documento: API 319/319, web 211/211.
- `pnpm lint` PASS; `pnpm build` PASS (dist incluye /downloads con .mjs, .sha256 y guía).
- `pnpm exec playwright test tests/e2e/workflow.spec.js`: 2/2 (movil-360 y escritorio-1280). Capturas `.local/screenshots/flujo-importar-*.png` y `flujo-navegador-*.png` inspeccionadas; se corrigió la alineación del grid y el formato numérico es-ES y se repitió (2/2).
- `node --test tools/diagnostic/test/` 21/21 (T001 sin cambios). `check_handoff --implementation-ready` OK.

### Límites
- No se pudieron fijar ni leer `API_PORT`/`WEB_PORT` (la herramienta pidió aprobaciones no disponibles); Playwright usó los puertos heredados o sus valores por defecto, siempre con DB temporal de `api-test-env`; no se usaron 3301/5573 ni la DB preview. No se migró ninguna DB local/preview: 004 solo en DB temporales de prueba.
- Sin recopilador ni CIM reales: diagnóstico fixture y valores del navegador inyectados.
- La evaluación todavía no usa la certeza (T003); el aviso de aproximación/pendiente en la evaluación queda para T003. El texto del botón de archivo («Choose File») es nativo del navegador.
- README, archivos 006 e índice Git sin tocar. Sin git add/commit.

### Corrección tras revisión Codex (rango exacto, lecturas obsoletas, claves)
- `apps/web/src/diagnostic.js`: el rango de RAM/disco se comprueba con el valor exacto `bytes / 1024^3` antes de redondear (`bytesRow`); fuera de rango → error y sin `value`. Solo se redondea hacia abajo lo que se muestra/aplica. El mensaje indica si supera el máximo o queda bajo el mínimo (no muestra una cifra redondeada que parezca válida). GiB, nunca GB.
- `apps/web/src/components/ProfileAssist.jsx`: identificador de lectura por selección; elegir otro archivo, cancelar, aplicar o desmontar invalida lecturas pendientes; al empezar a leer se limpia la vista previa anterior y se muestra «Leyendo el archivo…»; solo la selección actual puede poblar la vista previa y aplicar. Claves de volúmenes por índice del JSON leído (etiquetas repetidas ya no duplican claves).
- `apps/web/tests/diagnostic.test.jsx` (+8): máximo exacto aceptado y máximo+1 byte / exceso <0,01 GiB rechazados en RAM y disco (y mínimos), UI con RAM fuera de rango sin mutar formulario ni guardar, A lento/B rápido, A lento/B inválido, cancelación, limpieza de vista previa al elegir otro, desmontaje durante la lectura, etiquetas de volumen repetidas sin aviso de clave. `File.text` controlado por la prueba. Por defecto, todas las pruebas del archivo definen `hardwareConcurrency`/`deviceMemory` como `undefined`; las que usan valores los inyectan. Auditoría: las llamadas directas a `readBrowserHints` usan objetos ficticios o `null`; el e2e inyecta ambos getters antes de cargar.
- Reproducción previa: `vitest run tests/diagnostic.test.jsx` → 24 pruebas, 17 PASS / 7 FAIL (rango exacto, UI de rango, A/B, A/inválido, cancelación, limpieza de vista previa, claves duplicadas con aviso de React).
- Tras corregir: `vitest run tests/diagnostic.test.jsx tests/workflow.test.jsx` 40/40, `pnpm lint` PASS, `pnpm build` PASS, `playwright test tests/e2e/workflow.spec.js` 2/2 (360/1280; fixtures e inyección). API sin cambios: no se repitió su suite.
- Registro honesto: en la primera invocación de T002 hubo una lectura incidental del `navigator` de jsdom (refleja el número de CPUs de la máquina de pruebas) en una prueba fallida; el valor no se conservó. En esta corrección no se consultó hardware real. Sin git add/commit.

## T003/T004 — Evaluación clara con certeza y prompts por bloques (Claude, 2026-11-22)

### Archivos T003 (evaluación, FR-005/006)
- `apps/api/src/evaluation.js` (cambios de la sesión interrumpida revisados y conservados): `evaluate` acepta `provenance` (ProfileProvenance.fields guardados; ausente = manual/declared). Devuelve `summary.resources` (CPU/RAM/disco con requerido, disponible, `fits`, `source`, `certainty`) y `summary.nextAction` (`code`, `target` equipo|plan|proyecto, texto). Aproximado (navegador) nunca da «viable»: aviso `approximate-data` pendiente; si no cabe, `<recurso>-unconfirmed` pendiente en lugar de bloqueo afirmado. Importado (reported) cuenta como dato real con texto «informado por el diagnóstico». Totales numéricos sin cambios.
- `apps/api/src/workflow.js`: la evaluación usa la procedencia GUARDADA (nunca la del formulario). La revisión del perfil ya sube con cambios de origen/certeza (T002), así que el fingerprint invalida el avance.
- `apps/api/data/requirements.json`: `rulesVersion` 2026-11-22.1 → 2026-11-22.2.
- `apps/web/src/pages/WorkflowPage.jsx` (EvaluationView): estado + nota de aproximación + tres tarjetas CPU/RAM/disco con insignia Declarado/Importado/Aproximado y veredicto («Parece suficiente; pendiente de confirmar» si es aproximado) + «Siguiente paso» con enlace (Equipo / Plan / Editar el proyecto); después «Motivos y condiciones»; fuentes, tabla con columna Origen, ecuaciones y desglose por alternativa en `<details>` «Ver fuentes y cálculos» cerrado. Servidor anterior sin `summary`: tarjetas derivadas de los totales (declarado) y sin siguiente paso.
- Pruebas: `apps/api/tests/evaluation.test.js` (+6, certeza/resumen/acción), `apps/api/tests/workflow.test.js` (+1 HTTP: aproximado→pendiente, persistido y recalculado igual en GET, confirmar a mano→viable con revisión+1 y avance stale, insuficiente declarado), `apps/web/tests/workflow.test.jsx` (+4: viable importado, pendiente aproximado, insuficiente, acción proyecto + servidor sin resumen).

### Archivos T004 (prompts, FR-007/008)
- `apps/api/src/plan-templates.js`: `TEMPLATES_VERSION` 2026-11-22.1 → 2026-11-22.2; nuevo `STEP_BLOCKS`. Cada una de las 20 etapas (5 alternativas × 4) tiene `prechecks` (solo lectura), `tasks`, `security`, `validation` y `rollback` pertinentes a la etapa: cuentas sin privilegios, marcadores en lugar de secretos, BD/Redis/PostgreSQL no publicados, solo puertos necesarios y HTTPS, volúmenes persistentes, copias cifradas y restauración en entorno separado, WireGuard nativo con AllowedIPs mínimas y solo el UDP del túnel, no borrar sin copia y confirmación. Restricciones comunes: +confirmación antes de borrar/sobrescribir/reiniciar y +no dar por comprobados puertos/NAT/copias.
- `apps/api/src/plan.js`: prompt con bloques en orden fijo (Objetivo, Contexto relevante, Condiciones pendientes, Antes de empezar, Acciones propuestas, Seguridad, Cómo comprobar, Cómo volver atrás, Reglas para tu respuesta, Fuentes oficiales). El contexto añade «Origen de los datos» desde `evaluation.summary` (declarado/importado/aproximado pendiente); solo números y enumerados del perfil, sin cadenas importadas. Los pasos exponen `prechecks`, `security`, `rollback`. Invalidación: el fingerprint ya incluye `templatesVersion` y `rulesVersion` (mecanismo 004), por lo que el avance anterior queda obsoleto.
- `apps/web/src/pages/WorkflowPage.jsx` (PlanView): «Objetivo:» y bloques con encabezado en el orden del prompt; Seguridad destacada; un servidor anterior sin bloques nuevos muestra solo los que envía.
- `apps/web/src/styles.css`: bloque añadido al final (resumen, siguiente paso, desplegable, bloque de seguridad) con tokens existentes; tono también por texto/insignia y borde discontinuo para aproximado.
- Pruebas: `apps/api/tests/plan.test.js` (expectativas de encabezados actualizadas; +2: bloques y orden en las 20 etapas sin secretos/ssh/sudo/curl/rm -rf/http://, seguridad pertinente por alternativa; origen de los datos en el prompt; versión de plantillas), `apps/web/tests/workflow.test.jsx` (+1 y fixture con bloques), `tests/e2e/workflow.spec.js` (abre el desplegable antes de comprobar ecuaciones; texto de contexto nuevo). E2E no ejecutado.

### Comandos y resultados
- Estado inicial (cambios parciales de T003): `cd apps/api && npx vitest run tests/evaluation.test.js tests/workflow.test.js tests/plan.test.js` → 50/50.
- Tras T004: misma orden → 1 fallo esperado (encabezado «Restricciones:» antiguo en plan.test.js); actualizado → 52/52.
- `cd apps/web && npx vitest run tests/workflow.test.jsx` → 20/21 en la primera ejecución (consulta ambigua «Insuficiente» en la prueba nueva); corregida → 21/21. Con `tests/diagnostic.test.jsx` 45/45; `tests/accessible-names.test.jsx tests/projects.test.jsx` 39/39 (solo ejecución).
- `pnpm lint`: primero 3 errores no-unused-vars en la prueba nueva; corregido → PASS.

### Límites
- No se ejecutaron `pnpm build`, Playwright ni el navegador 360/1280 (alcance indicado por el coordinador; además otro escritor trabajaba en paralelo y no se tocó `dist` ni la preview 3301/5573). La comprobación visual de las tarjetas y bloques queda pendiente para la revisión/integración.
- `apps/web/src/styles.css` tenía cambios simultáneos de otra persona (retirada de estilos Google y CRLF); solo se añadió un bloque al final y se igualaron los finales de línea del archivo a CRLF como estaba. Revisar al integrar.
- Los prompts siguen siendo guías: NoMoreSaaS no comprueba puertos, NAT, copias ni requisitos del servidor y lo dice en el propio prompt. Sin git add/commit.
