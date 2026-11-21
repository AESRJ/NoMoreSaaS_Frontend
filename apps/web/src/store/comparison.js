import { create } from 'zustand';

// Selección de comparación: solo IDs ordenados en memoria. No se persiste
// entre recargas por diseño (sin middleware persist ni almacenamiento web).
export const MAX_SELECTION = 3;

/** @returns {{ status: 'added' | 'duplicate' | 'limit', ids: string[] }} */
export function addId(ids, id) {
  if (ids.includes(id)) return { status: 'duplicate', ids };
  if (ids.length >= MAX_SELECTION) return { status: 'limit', ids };
  return { status: 'added', ids: [...ids, id] };
}

export function removeId(ids, id) {
  return ids.includes(id) ? ids.filter((current) => current !== id) : ids;
}

/** @param {Set<string>} validIds */
export function reconcileIds(ids, validIds) {
  const kept = ids.filter((id) => validIds.has(id));
  return kept.length === ids.length ? { ids, removed: 0 } : { ids: kept, removed: ids.length - kept.length };
}

let noticeSequence = 0;

export const useComparison = create((set, get) => ({
  ids: [],
  notice: null,

  add(id) {
    const result = addId(get().ids, id);
    if (result.status === 'added') {
      set({ ids: result.ids, notice: null });
    } else if (result.status === 'limit') {
      set({ notice: { kind: 'limit', id: ++noticeSequence } });
    }
    return result.status;
  },

  remove(id) {
    const ids = removeId(get().ids, id);
    if (ids !== get().ids) set({ ids, notice: null });
  },

  clear() {
    if (get().ids.length) set({ ids: [], notice: null });
  },

  /** Elimina IDs que ya no existen en el catálogo y avisa cuántos. */
  reconcile(validIds) {
    const result = reconcileIds(get().ids, new Set(validIds));
    if (result.removed > 0) {
      set({ ids: result.ids, notice: { kind: 'removed', count: result.removed, id: ++noticeSequence } });
    }
    return result.removed;
  },

  dismissNotice() {
    if (get().notice) set({ notice: null });
  },
}));
