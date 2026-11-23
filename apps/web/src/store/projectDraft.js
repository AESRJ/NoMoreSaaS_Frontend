// Borrador del formulario de proyecto, SOLO en memoria (sin almacenamiento web
// ni history.state). Se guarda antes de cada envío y se borra al guardar o
// cancelar: si la sesión caduca y el guard redirige a /entrar, al volver la
// MISMA cuenta a la misma ruta recupera sus valores. Nunca se reenvía nada
// automáticamente. En cuanto se autentica otra cuenta (o se sale), se descarta.

let draft = null;

/** @param {{ userId: string, path: string, values: object, meta?: object }} next */
export function saveProjectDraft(next) {
  draft = { userId: next.userId, path: next.path, values: { ...next.values }, meta: next.meta ? structuredClone(next.meta) : null };
}

/** Devuelve los valores si coinciden cuenta y ruta; con otra cuenta lo descarta. */
export function takeProjectDraft(userId, path) {
  retainProjectDraftFor(userId);
  if (!draft) return null;
  return draft.path === path ? { ...draft.values } : null;
}

/** Metadatos adjuntos al borrador (p. ej. procedencia del equipo), con las mismas reglas. */
export function takeProjectDraftMeta(userId, path) {
  retainProjectDraftFor(userId);
  if (!draft || draft.path !== path || !draft.meta) return null;
  return structuredClone(draft.meta);
}

/** Llamado al autenticarse una cuenta: elimina cualquier borrador de otra. */
export function retainProjectDraftFor(userId) {
  if (draft && draft.userId !== userId) draft = null;
}

/** Sin argumento borra siempre (logout); con `userId`, solo si el borrador es suyo. */
export function clearProjectDraft(userId) {
  if (userId === undefined || (draft && draft.userId === userId)) draft = null;
}
