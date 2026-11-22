import { useCallback, useEffect, useState } from 'react';
import { AuthRequestError } from '../api/auth.js';
import { useAuth } from '../store/auth.js';

/**
 * Lectura de datos privados de la identidad actual, sin caché compartida.
 * El resultado se asocia a (usuario, clave, intento): si cambia la identidad o
 * la clave, la respuesta anterior se aborta y se descarta. Un 401 expira la
 * sesión (el guard redirige a /entrar y limpia la identidad).
 * @param {(signal: AbortSignal) => Promise<any>} load
 * @param {string} key
 */
export function useOwnedRequest(load, key) {
  const userId = useAuth((state) => state.user?.id ?? null);
  const expireSession = useAuth((state) => state.expireSession);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const requestKey = userId ? `${userId}|${key}|${attempt}` : null;

  useEffect(() => {
    if (!requestKey) return undefined;
    const controller = new AbortController();
    let pending;
    try {
      pending = Promise.resolve(load(controller.signal));
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, status: 'success', data, error: null });
      },
      (error) => {
        if (controller.signal.aborted) return;
        if (error instanceof AuthRequestError && error.status === 401) {
          expireSession();
          return;
        }
        const normalized =
          error instanceof AuthRequestError ? error : new AuthRequestError('network', 'No se pudieron cargar los datos.');
        setResult({ key: requestKey, status: 'error', data: null, error: normalized });
      },
    );
    return () => controller.abort();
    // `load` se identifica por `key`; así no se repite la petición en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** Sustituye los datos ya cargados (p. ej. tras guardar) sin volver a pedirlos. */
  const replace = useCallback((data) => setResult((current) => (current ? { ...current, data } : current)), []);

  if (!result || result.key !== requestKey) return { status: 'loading', data: null, error: null, retry, replace };
  return { status: result.status, data: result.data, error: result.error, retry, replace };
}
