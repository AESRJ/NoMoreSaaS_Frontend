import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_SELECTION, addId, reconcileIds, removeId, useComparison } from '../src/store/comparison.js';

describe('transiciones puras de ComparisonSelection.ids', () => {
  it('añade hasta tres IDs en orden', () => {
    let ids = [];
    for (const id of ['a', 'b', 'c']) {
      const result = addId(ids, id);
      expect(result.status).toBe('added');
      ids = result.ids;
    }
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(MAX_SELECTION).toBe(3);
  });

  it('añadir un ID existente no cambia la selección', () => {
    const ids = ['a'];
    const result = addId(ids, 'a');
    expect(result).toEqual({ status: 'duplicate', ids });
    expect(result.ids).toBe(ids);
  });

  it('añadir un cuarto devuelve límite sin mutar', () => {
    const ids = ['a', 'b', 'c'];
    const result = addId(ids, 'd');
    expect(result.status).toBe('limit');
    expect(result.ids).toBe(ids);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('retirar un ausente no cambia; retirar uno presente conserva el orden', () => {
    const ids = ['a', 'b', 'c'];
    expect(removeId(ids, 'z')).toBe(ids);
    expect(removeId(ids, 'b')).toEqual(['a', 'c']);
  });

  it('reconciliar elimina IDs inexistentes e informa cuántos', () => {
    expect(reconcileIds(['a', 'x', 'b', 'y'], new Set(['a', 'b']))).toEqual({ ids: ['a', 'b'], removed: 2 });
    const ids = ['a'];
    expect(reconcileIds(ids, new Set(['a']))).toEqual({ ids, removed: 0 });
  });
});

describe('store Zustand', () => {
  beforeEach(() => {
    useComparison.getState().clear();
    useComparison.getState().dismissNotice();
  });

  it('empieza vacío y sin aviso', () => {
    expect(useComparison.getState().ids).toEqual([]);
    expect(useComparison.getState().notice).toBeNull();
  });

  it('cubre 0/1/2/3/4 selecciones sin duplicados', () => {
    const { add } = useComparison.getState();
    expect(add('a')).toBe('added');
    expect(add('a')).toBe('duplicate');
    expect(useComparison.getState().ids).toEqual(['a']);
    expect(add('b')).toBe('added');
    expect(add('c')).toBe('added');
    expect(add('d')).toBe('limit');
    expect(useComparison.getState().ids).toEqual(['a', 'b', 'c']);
    expect(useComparison.getState().notice).toMatchObject({ kind: 'limit' });
  });

  it('retira, limpia y reconcilia con aviso', () => {
    const state = useComparison.getState();
    state.add('a');
    state.add('b');
    state.add('c');
    useComparison.getState().remove('b');
    expect(useComparison.getState().ids).toEqual(['a', 'c']);
    expect(useComparison.getState().reconcile(['a'])).toBe(1);
    expect(useComparison.getState().ids).toEqual(['a']);
    expect(useComparison.getState().notice).toMatchObject({ kind: 'removed', count: 1 });
    useComparison.getState().clear();
    expect(useComparison.getState().ids).toEqual([]);
  });

  it('reconciliar sin cambios no emite aviso', () => {
    useComparison.getState().add('a');
    expect(useComparison.getState().reconcile(['a', 'b'])).toBe(0);
    expect(useComparison.getState().notice).toBeNull();
  });

  it('no persiste en almacenamiento del navegador', () => {
    useComparison.getState().add('a');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
