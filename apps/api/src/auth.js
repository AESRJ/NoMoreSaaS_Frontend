import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import { ApiError } from './errors.js';
import { HasherBusyError, createPasswordHasher, isValidPassword } from './passwords.js';
import { IDLE_TIMEOUT_MS, SqliteSessionStore, absoluteDeadline } from './sessions.js';

// Autenticación por correo y contraseña con sesión de servidor persistente.
// Toda mutación exige: Origin exacto, Content-Type JSON, cuerpo ≤16 KiB y
// X-CSRF-Token sincronizador de la sesión actual.

export const SESSION_COOKIE_NAME = 'nomoresaas.sid';
export const JSON_BODY_LIMIT = '16kb';
export const CSRF_TOKEN_BYTES = 32;
export const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_LIMITS = Object.freeze({
  loginPerEmail: { limit: 5, windowMs: WINDOW_MS },
  loginPerIp: { limit: 20, windowMs: WINDOW_MS },
  registerPerIp: { limit: 10, windowMs: WINDOW_MS },
  maxKeys: 10000,
});

const EMAIL_PATTERN = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u;

// --- Errores públicos de autenticación (envelope {error:{code,message}}) ---
const errors = {
  validation: (message) => new ApiError(400, 'VALIDATION_ERROR', message),
  invalidJson: () => new ApiError(400, 'INVALID_JSON', 'El cuerpo de la petición no es JSON válido.'),
  invalidRequest: () => new ApiError(400, 'INVALID_REQUEST', 'La petición no es válida.'),
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Necesitas iniciar sesión.'),
  invalidCredentials: () => new ApiError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.'),
  forbiddenOrigin: () => new ApiError(403, 'FORBIDDEN_ORIGIN', 'Origen de la petición no permitido.'),
  csrf: () => new ApiError(403, 'CSRF_INVALID', 'La sesión de seguridad no es válida. Recarga e inténtalo de nuevo.'),
  emailUnavailable: () => new ApiError(409, 'EMAIL_UNAVAILABLE', 'No es posible registrar una cuenta con ese correo.'),
  tooLarge: () => new ApiError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la petición es demasiado grande.'),
  unsupportedType: () => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo debe enviarse como application/json en UTF-8.'),
  rateLimited: (retryAfterMs) => {
    const error = new ApiError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
    error.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return error;
  },
};

/** Correo trim/lowercase; null si no cumple 3–254 puntos Unicode y parte@dominio.ext. */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  const length = [...email].length;
  if (length < 3 || length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

/**
 * Limitador de ventana fija en memoria local (no coordina varias instancias).
 * Con `maxKeys` claves activas, las claves nuevas se rechazan.
 */
export function createRateLimiter({ limit, windowMs, maxKeys = DEFAULT_LIMITS.maxKeys, now = Date.now }) {
  const entries = new Map();

  function prune(t = now()) {
    for (const [key, entry] of entries) if (entry.resetAt <= t) entries.delete(key);
  }

  function hit(key) {
    const t = now();
    let entry = entries.get(key);
    if (entry && entry.resetAt <= t) {
      entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      if (entries.size >= maxKeys) prune(t);
      if (entries.size >= maxKeys) return { allowed: false, retryAfterMs: windowMs };
      entry = { count: 0, resetAt: t + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit ? { allowed: false, retryAfterMs: entry.resetAt - t } : { allowed: true };
  }

  return {
    hit,
    prune,
    reset: (key) => entries.delete(key),
    get size() {
      return entries.size;
    },
  };
}

const digest = (value) => createHash('sha256').update(value, 'utf8').digest();

function safeEqual(a, b) {
  return typeof a === 'string' && typeof b === 'string' && timingSafeEqual(digest(a), digest(b));
}

const newCsrfToken = () => randomBytes(CSRF_TOKEN_BYTES).toString('base64url');

function promisify(fn) {
  return new Promise((resolve, reject) => fn((error) => (error ? reject(error) : resolve())));
}

/** Rechaza cuerpos que no sean exactamente un objeto con las claves permitidas. */
function readFields(body, allowed) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw errors.validation('El cuerpo debe ser un objeto JSON.');
  }
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw errors.validation('La petición contiene campos no permitidos.');
  return body;
}

/** Convierte errores del parser y del hasher en errores públicos sin detalles internos. */
function toPublicError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof HasherBusyError) return errors.rateLimited(1000);
  switch (error && error.type) {
    case 'entity.too.large':
      return errors.tooLarge();
    case 'entity.parse.failed':
      return errors.invalidJson();
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return errors.unsupportedType();
    case 'request.aborted':
    case 'request.size.invalid':
    case 'stream.encoding.set':
    case 'stream.not.readable':
      return errors.invalidRequest();
    default: {
      // Sin `status`: el manejador central responde 500 genérico y solo registra el mensaje.
      const internal = new Error(error && error.message ? error.message : String(error));
      internal.name = 'InternalError';
      return internal;
    }
  }
}

/**
 * Crea la autenticación sobre una DB migrada. Devuelve el router de
 * /api/auth y piezas reutilizables (sesión, guardas) para rutas privadas.
 * @param {{
 *   db: import('node:sqlite').Database,
 *   sessionSecret: string,
 *   appOrigin: string,
 *   cookieSecure: boolean,
 *   now?: () => number,
 *   hasher?: ReturnType<typeof createPasswordHasher>,
 *   limits?: Partial<typeof DEFAULT_LIMITS>,
 *   cleanupIntervalMs?: number,
 * }} options
 */
export function createAuth({
  db,
  sessionSecret,
  appOrigin,
  cookieSecure,
  now = Date.now,
  hasher = createPasswordHasher(),
  limits = {},
  cleanupIntervalMs = CLEANUP_INTERVAL_MS,
}) {
  if (!db) throw new Error('createAuth requiere una base de datos abierta');
  if (!sessionSecret || !appOrigin || typeof cookieSecure !== 'boolean') {
    throw new Error('createAuth requiere sessionSecret, appOrigin y cookieSecure');
  }
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  const limiterOf = ({ limit, windowMs }) => createRateLimiter({ limit, windowMs, maxKeys: cfg.maxKeys, now });
  const limiters = {
    loginPerEmail: limiterOf(cfg.loginPerEmail),
    loginPerIp: limiterOf(cfg.loginPerIp),
    registerPerIp: limiterOf(cfg.registerPerIp),
  };

  const store = new SqliteSessionStore({ db, now });
  const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', secure: cookieSecure, maxAge: IDLE_TIMEOUT_MS };

  const sessionMiddleware = session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'keep',
    cookie: cookieOptions,
  });

  // La cookie expira con el mínimo de inactividad y límite absoluto.
  // express-session restablece maxAge a originalMaxAge al responder.
  function capCookie(req, _res, next) {
    if (req.session && Number.isSafeInteger(req.session.createdAt)) {
      const remaining = absoluteDeadline(req.session.createdAt) - now();
      req.session.cookie.originalMaxAge = Math.max(0, Math.min(IDLE_TIMEOUT_MS, remaining));
    }
    next();
  }

  const statements = {
    userById: db.prepare('SELECT id, email FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'),
  };

  const toUserDto = (row) => ({ id: row.id, email: row.email });

  function currentUser(req) {
    const userId = req.session && req.session.userId;
    if (typeof userId !== 'string') return null;
    const row = statements.userById.get(userId);
    return row ? toUserDto(row) : null;
  }

  // --- Guardas reutilizables ---
  function noStore(_req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
  }

  function requireSameOrigin(req, _res, next) {
    next(req.get('origin') === appOrigin ? undefined : errors.forbiddenOrigin());
  }

  function requireJsonType(req, _res, next) {
    const type = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    next(type === 'application/json' ? undefined : errors.unsupportedType());
  }

  const parseJson = express.json({ limit: JSON_BODY_LIMIT, strict: true, type: () => true });

  function requireCsrf(req, _res, next) {
    const expected = req.session && req.session.csrfToken;
    next(expected && safeEqual(req.get('x-csrf-token'), expected) ? undefined : errors.csrf());
  }

  /** 401 si la sesión no pertenece a un usuario existente; expone req.user. */
  function requireUser(req, _res, next) {
    const user = currentUser(req);
    if (!user) return next(errors.unauthenticated());
    req.user = user;
    next();
  }

  /** Origen, tipo, tamaño y JSON válidos; el CSRF se aplica aparte. */
  const mutationBody = [requireSameOrigin, requireJsonType, parseJson];

  function limit(limiter, key) {
    const result = limiter.hit(key);
    if (!result.allowed) throw errors.rateLimited(result.retryAfterMs);
  }

  /** Nueva sesión (nuevo sid y CSRF) guardada antes de responder. */
  async function establishSession(req, userId) {
    await promisify((cb) => req.session.regenerate(cb));
    req.session.userId = userId;
    req.session.csrfToken = newCsrfToken();
    req.session.createdAt = now();
    await promisify((cb) => req.session.save(cb));
    return req.session.csrfToken;
  }

  const router = express.Router();
  router.use(noStore, sessionMiddleware, capCookie);

  router.get('/session', (req, res) => {
    if (typeof req.session.csrfToken !== 'string') {
      req.session.csrfToken = newCsrfToken();
      req.session.createdAt = now();
    }
    const user = currentUser(req);
    if (!user && req.session.userId !== undefined) delete req.session.userId;
    res.json({ user, csrfToken: req.session.csrfToken });
  });

  router.post('/register', ...mutationBody, requireCsrf, async (req, res) => {
    const body = readFields(req.body, ['email', 'password']);
    const email = normalizeEmail(body.email);
    if (!email) throw errors.validation('Introduce un correo válido.');
    if (!isValidPassword(body.password)) {
      throw errors.validation('La contraseña debe tener entre 15 y 128 caracteres.');
    }
    limit(limiters.registerPerIp, req.ip);

    const passwordHash = await hasher.hash(body.password);
    const id = randomUUID();
    try {
      statements.insertUser.run(id, email, passwordHash, new Date(now()).toISOString());
    } catch (error) {
      if (/UNIQUE constraint failed: users\.email/.test(error.message)) throw errors.emailUnavailable();
      throw error;
    }
    const csrfToken = await establishSession(req, id);
    res.status(201).json({ user: { id, email }, csrfToken });
  });

  router.post('/login', ...mutationBody, requireCsrf, async (req, res) => {
    const body = readFields(req.body, ['email', 'password']);
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw errors.validation('Introduce tu correo y contraseña.');
    }
    limit(limiters.loginPerIp, req.ip);
    const emailKey = body.email.trim().toLowerCase().slice(0, 254);
    limit(limiters.loginPerEmail, emailKey);

    const email = normalizeEmail(body.email);
    const row = email && isValidPassword(body.password) ? statements.userByEmail.get(email) : undefined;
    const ok = row ? await hasher.verify(body.password, row.password_hash) : await hasher.verifyDummy(body.password);
    if (!ok) throw errors.invalidCredentials();

    limiters.loginPerEmail.reset(emailKey);
    const csrfToken = await establishSession(req, row.id);
    res.json({ user: toUserDto(row), csrfToken });
  });

  router.post('/logout', ...mutationBody, requireUser, requireCsrf, async (req, res) => {
    readFields(req.body, []);
    await promisify((cb) => req.session.destroy(cb));
    // Mismos atributos que la cookie emitida (sin maxAge: clearCookie fija la expiración).
    const { httpOnly, sameSite, path, secure } = cookieOptions;
    res.clearCookie(SESSION_COOKIE_NAME, { httpOnly, sameSite, path, secure });
    res.status(204).end();
  });

  router.use((error, _req, res, next) => {
    const publicError = toPublicError(error);
    if (publicError.retryAfterSeconds) res.set('Retry-After', String(publicError.retryAfterSeconds));
    next(publicError);
  });

  // Limpieza periódica de sesiones vencidas y claves caducadas del limitador.
  const timer = setInterval(() => {
    try {
      store.cleanup();
      Object.values(limiters).forEach((l) => l.prune());
    } catch {
      // Un fallo puntual de limpieza no detiene la API; se reintenta en el siguiente ciclo.
    }
  }, cleanupIntervalMs);
  timer.unref();

  return {
    router,
    session: sessionMiddleware,
    capCookie,
    noStore,
    requireUser,
    requireCsrf,
    mutationBody,
    store,
    limiters,
    close() {
      clearInterval(timer);
    },
  };
}
