import { createContext, createElement, useContext, useEffect, useSyncExternalStore } from 'react';
import { defaultCatalogResource } from '../api/catalog.js';
import { indexCatalog } from '../catalog-index.js';

const CatalogResourceContext = createContext(defaultCatalogResource);

/** Permite inyectar un recurso (p. ej. fixtures en pruebas). */
export function CatalogProvider({ resource = defaultCatalogResource, children }) {
  return createElement(CatalogResourceContext.Provider, { value: resource }, children);
}

/**
 * Estado del catálogo compartido por sesión: una sola petición para todas las
 * rutas, sin copia en Zustand. Devuelve también un índice derivado y `retry`.
 */
export function useCatalog() {
  const resource = useContext(CatalogResourceContext);
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);

  useEffect(() => {
    resource.load();
  }, [resource]);

  const status = state.status === 'idle' ? 'loading' : state.status;
  return {
    status,
    error: state.error,
    index: state.data ? indexCatalog(state.data) : null,
    retry: resource.retry,
  };
}
