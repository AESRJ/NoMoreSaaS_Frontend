import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { AUTH_STATUS, useAuth } from '../store/auth.js';

// Destino tras entrar o registrarse (contracts/ui.md): /proyectos o una ruta
// privada interna validada.
export const DEFAULT_AFTER_AUTH = '/proyectos';
export const REDIRECT_PARAM = 'siguiente';

const INTERNAL_BASE = 'http://interno.invalid';
const PRIVATE_PATHS = /^\/(proyectos(\/|$)|cuenta$)/;

/**
 * Devuelve una ruta privada interna segura o `fallback`. Rechaza URLs
 * absolutas, protocolo relativo (//), barras invertidas, caracteres de control
 * y cualquier ruta que no sea privada (incluidas las páginas de acceso).
 */
export function safeRedirectTarget(value, fallback = DEFAULT_AFTER_AUTH) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url;
  try {
    url = new URL(value, INTERNAL_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== INTERNAL_BASE || !PRIVATE_PATHS.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Ruta de acceso que conserva el destino interno solicitado. */
export function authPathFor(base, target) {
  const safe = safeRedirectTarget(target, null);
  return safe && safe !== DEFAULT_AFTER_AUTH ? `${base}?${REDIRECT_PARAM}=${encodeURIComponent(safe)}` : base;
}

/**
 * Guard de rutas privadas: espera a conocer la sesión antes de mostrar nada
 * privado; si no hay identidad, redirige a /entrar conservando el destino.
 */
export function RequireAuth({ children }) {
  const status = useAuth((state) => state.status);
  const error = useAuth((state) => state.error);
  const ensureSession = useAuth((state) => state.ensureSession);
  const reloadSession = useAuth((state) => state.reloadSession);
  const location = useLocation();

  useEffect(() => {
    ensureSession();
  }, [ensureSession]);

  if (status === AUTH_STATUS.unknown || status === AUTH_STATUS.loading) {
    return (
      <div className="page page--narrow" role="status">
        <p className="loading__label">Comprobando tu sesión…</p>
      </div>
    );
  }

  if (status === AUTH_STATUS.error) {
    return (
      <div className="state state--error" role="alert">
        <h2>No se pudo comprobar tu sesión</h2>
        <p>{error?.message || 'Se produjo un error inesperado.'}</p>
        <button type="button" className="button button--primary" onClick={reloadSession}>
          Reintentar
        </button>
      </div>
    );
  }

  if (status !== AUTH_STATUS.authenticated) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={authPathFor('/entrar', target)} replace />;
  }

  return children ?? <Outlet />;
}
