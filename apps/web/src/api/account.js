import { createContext, createElement, useContext } from 'react';
import { AuthRequestError, send } from './auth.js';

// Cliente de /api/account (cuenta propia y vínculo Google). No guarda nada:
// la URL de Google solo se usa para navegar y jamás se persisten tokens.

export const GOOGLE_AUTHORIZATION_ORIGIN = 'https://accounts.google.com';
const INVALID_MESSAGE = 'El servidor devolvió una respuesta inesperada. Inténtalo de nuevo.';

/** Estado de la cuenta: {hasPassword, google:{enabled, linked}} validado. */
export async function fetchAccount({ signal } = {}) {
  const data = await send('/api/account', { signal });
  if (
    !data ||
    typeof data.hasPassword !== 'boolean' ||
    !data.google ||
    typeof data.google.enabled !== 'boolean' ||
    typeof data.google.linked !== 'boolean'
  ) {
    throw new AuthRequestError('invalid', INVALID_MESSAGE);
  }
  return { hasPassword: data.hasPassword, google: { enabled: data.google.enabled, linked: data.google.linked } };
}

/** Acepta solo una URL https del host de autorización de Google. */
export function safeGoogleAuthorizationUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === GOOGLE_AUTHORIZATION_ORIGIN ? url.toString() : null;
  } catch {
    return null;
  }
}

/** POST /api/account/google/link/start con la contraseña actual → URL de Google. */
export async function startGoogleLink({ password, csrfToken }) {
  const data = await send('/api/account/google/link/start', { method: 'POST', body: { password }, csrfToken });
  const url = safeGoogleAuthorizationUrl(data && data.authorizationUrl);
  if (!url) throw new AuthRequestError('invalid', INVALID_MESSAGE);
  return url;
}

export const defaultAccountClient = Object.freeze({
  fetchAccount,
  startGoogleLink,
  // Navegación de página completa hacia Google (sin SDK, popup ni iframe).
  navigate: (url) => window.location.assign(url),
});

const AccountClientContext = createContext(defaultAccountClient);

/** Permite inyectar un cliente simulado en pruebas. */
export function AccountProvider({ client = defaultAccountClient, children }) {
  return createElement(AccountClientContext.Provider, { value: client }, children);
}

export function useAccountClient() {
  return useContext(AccountClientContext);
}
