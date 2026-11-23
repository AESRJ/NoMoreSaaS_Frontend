// Cliente central de autenticación (same-origin vía proxy /api).
// No guarda nada: el token CSRF y la identidad viven solo en memoria (store/auth.js).

export class AuthRequestError extends Error {
  /**
   * @param {'network' | 'http' | 'invalid'} kind
   * @param {string} message
   * @param {{ status?: number, code?: string, retryAfterSeconds?: number, fields?: Record<string, string> }} [details]
   */
  constructor(kind, message, { status, code, retryAfterSeconds, fields } = {}) {
    super(message);
    this.name = 'AuthRequestError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    // Errores de validación por campo (p. ej. perfil del equipo); solo texto.
    if (fields) this.fields = fields;
  }
}

const NETWORK_MESSAGE = 'No se pudo conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.';
const INVALID_MESSAGE = 'El servidor devolvió una respuesta inesperada. Inténtalo de nuevo.';

/** Mensajes por defecto si el servidor no envía el envelope {error:{code,message}}. */
const STATUS_MESSAGES = {
  401: 'Necesitas iniciar sesión.',
  403: 'La sesión de seguridad no es válida. Vuelve a enviar el formulario.',
  409: 'No es posible registrar una cuenta con ese correo.',
  413: 'Los datos enviados son demasiado grandes.',
  429: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
};

function isUser(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    typeof value.email === 'string' &&
    value.email !== ''
  );
}

/** {user:null|{id,email}, csrfToken} validado; solo copia los campos del contrato. */
function toSession(data, { requireUser = false } = {}) {
  if (data === null || typeof data !== 'object' || typeof data.csrfToken !== 'string' || data.csrfToken === '') {
    throw new AuthRequestError('invalid', INVALID_MESSAGE);
  }
  if (data.user === null && !requireUser) return { user: null, csrfToken: data.csrfToken };
  if (!isUser(data.user)) throw new AuthRequestError('invalid', INVALID_MESSAGE);
  return { user: { id: data.user.id, email: data.user.email }, csrfToken: data.csrfToken };
}

/** Copia solo pares campo → texto, en un objeto sin prototipo. */
function toFieldErrors(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fields = Object.create(null);
  for (const [key, text] of Object.entries(value)) {
    if (typeof text === 'string') fields[key] = text;
  }
  return Object.keys(fields).length ? fields : undefined;
}

/** Petición JSON same-origin compartida por los clientes de auth y proyectos. */
export async function send(path, { method = 'GET', body, csrfToken, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new AuthRequestError('network', NETWORK_MESSAGE);
  }

  if (response.status === 204) return null;

  let data = null;
  try {
    data = await response.json();
  } catch {
    if (response.ok) throw new AuthRequestError('invalid', INVALID_MESSAGE);
  }

  if (!response.ok) {
    const envelope = data && typeof data === 'object' && data.error && typeof data.error === 'object' ? data.error : {};
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new AuthRequestError(
      'http',
      typeof envelope.message === 'string' && envelope.message
        ? envelope.message
        : STATUS_MESSAGES[response.status] || `El servidor respondió con el estado ${response.status}.`,
      {
        status: response.status,
        code: typeof envelope.code === 'string' ? envelope.code : undefined,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        fields: toFieldErrors(envelope.fields),
      },
    );
  }
  return data;
}

/** GET /api/auth/session → {user, csrfToken}. */
export async function fetchSession({ signal } = {}) {
  return toSession(await send('/api/auth/session', { signal }));
}

/** POST /api/auth/register → {user, csrfToken}. La contraseña se envía tal cual (sin trim). */
export async function register({ email, password, csrfToken }) {
  return toSession(await send('/api/auth/register', { method: 'POST', body: { email, password }, csrfToken }), {
    requireUser: true,
  });
}

/** POST /api/auth/login → {user, csrfToken}. */
export async function login({ email, password, csrfToken }) {
  return toSession(await send('/api/auth/login', { method: 'POST', body: { email, password }, csrfToken }), {
    requireUser: true,
  });
}

/** POST /api/auth/logout → 204. */
export async function logout({ csrfToken }) {
  await send('/api/auth/logout', { method: 'POST', body: {}, csrfToken });
}

export const GOOGLE_AUTHORIZATION_ORIGIN = 'https://accounts.google.com';

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

/** GET /api/auth/providers → {google:{enabled}}; solo el indicador booleano. */
export async function fetchProviders({ signal } = {}) {
  const data = await send('/api/auth/providers', { signal });
  if (!data || !data.google || typeof data.google.enabled !== 'boolean') {
    throw new AuthRequestError('invalid', INVALID_MESSAGE);
  }
  return { google: { enabled: data.google.enabled } };
}

/** POST /api/auth/google/start (cuerpo vacío, CSRF) → URL de consentimiento de Google. */
export async function startGoogleLogin({ csrfToken }) {
  const data = await send('/api/auth/google/start', { method: 'POST', body: {}, csrfToken });
  const url = safeGoogleAuthorizationUrl(data && data.authorizationUrl);
  if (!url) throw new AuthRequestError('invalid', INVALID_MESSAGE);
  return url;
}

export const defaultAuthClient = Object.freeze({
  fetchSession,
  register,
  login,
  logout,
  fetchProviders,
  startGoogleLogin,
  // Navegación de página completa hacia Google (sin SDK, popup ni iframe).
  navigate: (url) => window.location.assign(url),
});
