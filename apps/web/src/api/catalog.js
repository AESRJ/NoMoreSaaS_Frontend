// Cliente de lectura del catálogo y caché compartida por sesión.
// El catálogo vive aquí, no en Zustand.

export class CatalogLoadError extends Error {
  /** @param {'network' | 'http' | 'invalid'} kind */
  constructor(kind, message, status) {
    super(message);
    this.name = 'CatalogLoadError';
    this.kind = kind;
    this.status = status;
  }
}

function hasCatalogShape(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    data.schemaVersion === 1 &&
    Array.isArray(data.services) &&
    Array.isArray(data.alternatives) &&
    Array.isArray(data.relations)
  );
}

export async function fetchCatalog({ signal } = {}) {
  let response;
  try {
    response = await fetch('/api/catalog', { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new CatalogLoadError('network', 'No se pudo conectar con el servidor del catálogo.');
  }
  if (!response.ok) {
    throw new CatalogLoadError('http', `El servidor respondió con el estado ${response.status}.`, response.status);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new CatalogLoadError('invalid', 'La respuesta del catálogo no es JSON válido.');
  }
  if (!hasCatalogShape(data)) {
    throw new CatalogLoadError('invalid', 'La respuesta del catálogo no tiene el formato esperado.');
  }
  return data;
}

const IDLE = Object.freeze({ status: 'idle', data: null, error: null });

/**
 * Recurso observable compatible con useSyncExternalStore.
 * - load(): inicia la carga solo si aún no se ha intentado (comparte la petición).
 * - retry(): fuerza una nueva carga y cancela la anterior.
 * Las respuestas de peticiones anteriores se descartan.
 */
export function createCatalogResource({ fetcher = fetchCatalog } = {}) {
  let state = IDLE;
  let controller = null;
  let requestId = 0;
  const listeners = new Set();

  function setState(next) {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  function start() {
    if (controller) controller.abort();
    const current = ++requestId;
    const own = new AbortController();
    controller = own;
    setState({ status: 'loading', data: null, error: null });
    let pending;
    try {
      pending = Promise.resolve(fetcher({ signal: own.signal }));
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
        (data) => {
          if (current !== requestId) return;
          controller = null;
          setState({ status: 'success', data, error: null });
        },
        (error) => {
          if (current !== requestId) return;
          controller = null;
          const normalized =
            error instanceof CatalogLoadError ? error : new CatalogLoadError('network', 'No se pudo cargar el catálogo.');
          setState({ status: 'error', data: null, error: normalized });
        },
      );
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load() {
      if (state.status === 'idle') start();
    },
    retry: start,
  };
}

export const defaultCatalogResource = createCatalogResource();
