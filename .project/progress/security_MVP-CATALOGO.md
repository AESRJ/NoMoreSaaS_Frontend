# Revision de seguridad MVP-CATALOGO (T016)

Fecha: 2026-11-20. Autor: Claude Code (constructor). Esta revision no sustituye la revision final de Codex.

## Alcance revisado

| Punto | Resultado | Evidencia |
| --- | --- | --- |
| Catalogo como texto | Sin `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function` en `apps/` (busqueda con Grep, 0 coincidencias). React escapa todo el contenido. | `apps/web/tests/detail.test.jsx` (HTML y `<script>` en descripcion/capacidades se muestran como texto; no se crean `img`/`b`/`script`) |
| Enlaces permitidos | `safeHref` solo acepta URL absolutas `http:`/`https:`; otros esquemas muestran "enlace no disponible". El validador del API rechaza `javascript:`, `data:`, `file:`, `ftp:` y relativas en el seed. Enlaces externos con `rel="noopener noreferrer external"`, sin `target="_blank"`. | `detail.test.jsx` (no hay `a[href^=javascript]`), `catalog.test.js` (URL rechazadas) |
| Entradas de ID | API valida `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1-80, antes de buscar; IDs solo se comparan con la instantanea en memoria. En la SPA los parametros de ruta solo se usan para buscar en el indice local; nunca se envian a la API ni se interpolan en HTML. | `api.test.js` (400 para mayusculas, `_`, 81 caracteres, `..%2F..%2Fetc`, `-x`, `x--y`) |
| Errores sin stack | Manejador central; 500 con mensaje generico y diagnostico local solo con `err.message`. | `api.test.js` (500 sin la cadena interna ni stack) |
| API sin escrituras | Solo rutas GET; POST/PUT/PATCH/DELETE responden 404 JSON; catalogo congelado en profundidad (`Object.freeze`); no hay `express.json` ni lectura de rutas de disco a partir de la peticion. | `api.test.js`, `security.test.js` |
| Sin exposicion externa | API en `127.0.0.1:3001` y Vite en `127.0.0.1:5173` por defecto; `strictPort`. Sin CORS (verificado tambien con preflight OPTIONS). Helmet activo y `X-Powered-By` desactivado. | `api.test.js` (`server.address().address === '127.0.0.1'`, cabeceras), `security.test.js` |
| Dependencias | `pnpm audit`: "No known vulnerabilities found" (2026-11-20). Versiones directas exactas y lockfile. | salida de `pnpm audit` |
| Datos personales | No se recogen; la seleccion vive en memoria (sin `localStorage`/`sessionStorage`). | `comparison.test.js` |

## Hallazgos y correcciones

1. **Codigo de error fuera de contrato (corregido)**. Una URL con codificacion porcentual invalida (`/api/alternatives/%E0%A4%A`) respondia 400 con `INVALID_REQUEST`, codigo no definido en `contracts/http-api.md`. Ahora responde `INVALID_ID`. Prueba: `apps/api/tests/security.test.js`. Verificaciones repetidas: `pnpm test` (API 80/80).
2. **Nombre accesible defectuoso (corregido, no de seguridad pero detectado en la revision)**: el boton de seleccion exponia "Añadir Archiveroa la comparacion". Prueba de regresion `apps/web/tests/accessible-names.test.jsx`.

## Limites conocidos (no corregidos, fuera de alcance)

- La CSP de Helmet aplica a las respuestas de la API. La SPA se sirve con el servidor de desarrollo de Vite, sin CSP propia; un despliegue futuro necesitara definir hosting y cabeceras (no forma parte de este incremento).
- No hay limitacion de tasa en la API; es local y de solo lectura.
- La licencia de Forgejo se respalda con el README oficial: el archivo LICENSE de Codeberg no pudo leerse automaticamente (pagina antiscraping). Se declara en la nota de la fuente.
