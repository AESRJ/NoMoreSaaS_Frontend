import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';
import { EmailUnavailableError } from './identities.js';
import { hashSessionId } from './sessions.js';

// Rutas OIDC de Google bajo /api/auth: providers, google/start y
// google/callback. Cada intento (oauth_attempts) se liga al hash del sid de la
// presesión, dura 5 minutos y se consume una sola vez con DELETE … RETURNING
// antes del canje. El callback siempre termina en 303 a una ruta interna con un
// motivo fijo; nada del proveedor (code, state, error_description) se refleja.

export const ATTEMPT_TTL_MS = 5 * 60 * 1000;
export const CALLBACK_REASONS = Object.freeze(['google_cancelled', 'google_failed', 'google_conflict']);
const RANDOM_BYTES = 32;
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // base64url de 32 bytes
const CODE_MAX = 2048;
const SUBJECT_MAX = 255;

const providerUnavailable = () =>
  new ApiError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'El acceso con Google no está disponible en este momento.');

const randomToken = () => randomBytes(RANDOM_BYTES).toString('base64url');
const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const s256 = (verifier) => createHash('sha256').update(verifier, 'ascii').digest('base64url');

function equalHex(a, b) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Repositorio de intentos OIDC; solo hashes de state/nonce y verifier transitorio. */
export function createAttemptStore({ db }) {
  const statements = {
    clearSession: db.prepare('DELETE FROM oauth_attempts WHERE session_hash = ?'),
    insert: db.prepare(
      `INSERT INTO oauth_attempts
         (state_hash, session_hash, nonce_hash, verifier, purpose, expected_user_id, expires_at, return_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    consume: db.prepare(
      `DELETE FROM oauth_attempts WHERE state_hash = ? AND session_hash = ?
       RETURNING nonce_hash, verifier, purpose, expected_user_id, expires_at, return_to`,
    ),
    cleanup: db.prepare('DELETE FROM oauth_attempts WHERE expires_at <= ?'),
  };

  return {
    /** Sustituye cualquier intento previo de la misma sesión por uno nuevo. */
    replace({ stateHash, sessionHash, nonceHash, verifier, purpose, expectedUserId = null, expiresAt, returnTo }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        statements.clearSession.run(sessionHash);
        statements.insert.run(stateHash, sessionHash, nonceHash, verifier, purpose, expectedUserId, expiresAt, returnTo);
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    /** Consumo atómico: devuelve el intento de esa sesión una sola vez, o undefined. */
    consume(stateHash, sessionHash) {
      return statements.consume.get(stateHash, sessionHash);
    },
    cleanup(now) {
      return Number(statements.cleanup.run(now).changes);
    },
  };
}

/**
 * Monta las rutas de Google en el router de /api/auth.
 * @param {import('express').Router} router
 * @param {{
 *   db: import('node:sqlite').Database,
 *   provider: ReturnType<typeof import('./google.js').createGoogleProvider> | null,
 *   accounts: ReturnType<typeof import('./identities.js').createAccountStore>,
 *   now: () => number,
 *   logger: Pick<Console, 'error'>,
 *   mutationBody: import('express').RequestHandler[],
 *   requireCsrf: import('express').RequestHandler,
 *   readFields: (body: unknown, allowed: string[]) => object,
 *   limitStart: (req: import('express').Request) => void,
 *   normalizeEmail: (value: unknown) => string | null,
 *   establishSession: (req: import('express').Request, userId: string) => Promise<string>,
 *   isSessionCurrent: (req: import('express').Request) => boolean,
 * }} deps
 */
export function mountGoogleAuth(router, deps) {
  const {
    db, provider, accounts, now, logger, mutationBody, requireCsrf, readFields, limitStart, normalizeEmail,
    establishSession, isSessionCurrent,
  } = deps;
  const attempts = createAttemptStore({ db });

  router.get('/providers', (_req, res) => {
    res.json({ google: { enabled: Boolean(provider) } });
  });

  router.post('/google/start', ...mutationBody, requireCsrf, (req, res) => {
    readFields(req.body, []);
    if (!provider) throw providerUnavailable();
    limitStart(req);
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    attempts.replace({
      stateHash: sha256Hex(state),
      sessionHash: hashSessionId(req.sessionID),
      nonceHash: sha256Hex(nonce),
      verifier,
      purpose: 'login',
      expiresAt: now() + ATTEMPT_TTL_MS,
      returnTo: 'projects',
    });
    res.json({ authorizationUrl: provider.authorizationUrl({ state, nonce, codeChallenge: s256(verifier) }) });
  });

  /** Alta o recuperación por (google, sub); nunca enlaza por correo. */
  function resolveUser(claims) {
    const existing = accounts.findUserByIdentity('google', claims.sub);
    if (existing) return { user: existing };
    const email = claims.emailVerified ? normalizeEmail(claims.email) : null;
    if (!email) return { reason: 'google_failed' };
    try {
      return {
        user: accounts.createUserWithIdentity({
          id: randomUUID(),
          email,
          provider: 'google',
          subject: claims.sub,
          createdAt: new Date(now()).toISOString(),
        }),
      };
    } catch (error) {
      if (error instanceof EmailUnavailableError) return { reason: 'google_conflict' };
      // Carrera con otro callback del mismo sub: usar la identidad ya creada.
      const raced = accounts.findUserByIdentity('google', claims.sub);
      if (raced) return { user: raced };
      throw error;
    }
  }

  router.get('/google/callback', async (req, res) => {
    let base = '/entrar';
    // Un fallo nunca toca la sesión: sin Set-Cookie (rolling) que pudiera
    // sobrescribir una sesión rotada mientras tanto, ni save/touch que la
    // reviva. Con unset:'keep', req.session=null no destruye nada en el store.
    const fail = (reason) => {
      req.session = null;
      return res.redirect(303, `${base}?reason=${reason}`);
    };
    try {
      if (!provider) return fail('google_failed');
      const { state, code, error } = req.query;
      if (typeof state !== 'string' || !TOKEN.test(state)) return fail('google_failed');

      // Consumo antes de cualquier otra comprobación o canje: impide el replay.
      const attempt = attempts.consume(sha256Hex(state), hashSessionId(req.sessionID));
      if (!attempt) return fail('google_failed');
      if (attempt.return_to === 'account') base = '/cuenta';
      if (attempt.expires_at <= now()) return fail('google_failed');
      if (error !== undefined) return fail(error === 'access_denied' ? 'google_cancelled' : 'google_failed');
      // El vínculo desde /cuenta (purpose=link) se resuelve en otra tarea.
      if (attempt.purpose !== 'login') return fail('google_failed');
      if (typeof code !== 'string' || code.length < 1 || code.length > CODE_MAX) return fail('google_failed');

      const claims = await provider.exchange({ code, codeVerifier: attempt.verifier });
      // Último await antes de mutar. Desde aquí hasta que regenerate destruye
      // el sid original, todo es un único tramo síncrono (sin await ni
      // Promise): comprobación de claims, TTL del intento, relectura de la
      // sesión persistida (logout, rotación o vencimiento), alta/recuperación
      // del usuario y destroy del sid. Ninguna otra continuación se intercala.
      if (typeof claims.nonce !== 'string' || !equalHex(sha256Hex(claims.nonce), attempt.nonce_hash)) {
        return fail('google_failed');
      }
      if (typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > SUBJECT_MAX) {
        return fail('google_failed');
      }
      if (attempt.expires_at <= now()) return fail('google_failed');
      if (!isSessionCurrent(req)) return fail('google_failed');
      const { user, reason } = resolveUser(claims);
      if (!user) return fail(reason);

      // regenerate destruye el sid original de forma síncrona (store SQLite)
      // antes de su primera cesión; la sesión nueva aún no la conoce nadie.
      await establishSession(req, user.id);
      return res.redirect(303, '/proyectos');
    } catch (err) {
      // Solo el tipo: los mensajes de la biblioteca pueden contener tokens.
      logger.error('[auth] fallo en el callback de Google:', err && err.name ? err.name : 'Error');
      return fail('google_failed');
    }
  });

  return { attempts };
}
