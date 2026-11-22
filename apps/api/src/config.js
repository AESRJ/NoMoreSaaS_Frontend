import { Buffer } from 'node:buffer';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Configuración local de la API. Todo valor ausente o inválido falla con un
// mensaje claro; nunca se sustituye la base de datos por memoria ni se inventa
// un secreto.

export const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const REPO_ROOT = resolve(API_ROOT, '..', '..');
export const DEFAULT_DATABASE_PATH = join(API_ROOT, '.local', 'data', 'nomoresaas.sqlite');
export const SESSION_SECRET_MIN_BYTES = 32;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const FORBIDDEN_SEGMENTS = new Set(['dist', 'public']);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Ruta absoluta de la base SQLite. Sin DATABASE_PATH se usa la ruta local por
 * defecto (apps/api/.local/data, ignorada por Git). Dentro del checkout solo se
 * aceptan rutas bajo un directorio `.local` para que la DB nunca se versione, y
 * nunca bajo `dist` o `public`.
 */
export function resolveDatabasePath(env = process.env) {
  const raw = env.DATABASE_PATH;
  if (raw === undefined || raw === '') return DEFAULT_DATABASE_PATH;
  const value = raw.trim();
  if (value !== raw || value === '') {
    throw new ConfigError('DATABASE_PATH no puede contener espacios al inicio o al final.');
  }
  if (value === ':memory:' || value.toLowerCase().startsWith('file:')) {
    throw new ConfigError('DATABASE_PATH debe ser un archivo; no se admite base en memoria ni URI.');
  }
  if (!isAbsolute(value)) {
    throw new ConfigError('DATABASE_PATH debe ser una ruta absoluta.');
  }
  const path = resolve(value);
  const segments = path.split(sep).map((s) => s.toLowerCase());
  if (segments.some((s) => FORBIDDEN_SEGMENTS.has(s))) {
    throw new ConfigError('DATABASE_PATH no puede estar dentro de un directorio dist o public.');
  }
  if (isInside(REPO_ROOT, path) && !relative(REPO_ROOT, path).split(sep).includes('.local')) {
    throw new ConfigError('Dentro del repositorio, DATABASE_PATH debe estar bajo un directorio .local ignorado por Git.');
  }
  return path;
}

/** Valida APP_ORIGIN: origen exacto, http solo en loopback de desarrollo. */
export function parseAppOrigin(raw) {
  if (!raw) throw new ConfigError('APP_ORIGIN es obligatorio (por ejemplo http://127.0.0.1:5173).');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('APP_ORIGIN no es una URL válida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('APP_ORIGIN debe usar http o https.');
  }
  if (url.origin !== raw) {
    throw new ConfigError('APP_ORIGIN debe ser un origen exacto, sin ruta, barra final ni credenciales.');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ConfigError('APP_ORIGIN solo admite http en loopback de desarrollo; usa https en otro caso.');
  }
  return { appOrigin: url.origin, cookieSecure: url.protocol === 'https:' };
}

/** Secreto de firma de sesión: obligatorio, estable y de al menos 32 bytes. */
export function parseSessionSecret(raw) {
  if (!raw) throw new ConfigError('SESSION_SECRET es obligatorio; genera uno local fuera de Git.');
  if (Buffer.byteLength(raw, 'utf8') < SESSION_SECRET_MIN_BYTES) {
    throw new ConfigError(`SESSION_SECRET debe tener al menos ${SESSION_SECRET_MIN_BYTES} bytes.`);
  }
  if (new Set(raw).size < 8) {
    throw new ConfigError('SESSION_SECRET es demasiado repetitivo; genera uno aleatorio.');
  }
  return raw;
}

/**
 * Configuración completa de identidad. Los mensajes nunca incluyen el valor del
 * secreto. La integración con el servidor llega con la autenticación.
 */
export function loadConfig(env = process.env) {
  const databasePath = resolveDatabasePath(env);
  const sessionSecret = parseSessionSecret(env.SESSION_SECRET);
  const { appOrigin, cookieSecure } = parseAppOrigin(env.APP_ORIGIN);
  return Object.freeze({ databasePath, sessionSecret, appOrigin, cookieSecure });
}
