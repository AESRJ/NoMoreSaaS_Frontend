import { createHash } from 'node:crypto';
import session from 'express-session';

// Store persistente de express-session sobre la tabla `sessions` de SQLite.
// Clave: SHA-256 hex del sid (nunca la cookie ni el sid en claro). Payload:
// solo cookie, csrfToken, createdAt y userId; nunca contraseñas.
// Expiración de servidor: mínimo entre última actividad + 30 min y
// createdAt + 24 h, evaluada con un reloj inyectable.

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function hashSessionId(sid) {
  return createHash('sha256').update(String(sid), 'utf8').digest('hex');
}

/** Fecha absoluta (ms) en que caduca la sesión creada en `createdAt`. */
export function absoluteDeadline(createdAt) {
  return createdAt + ABSOLUTE_TIMEOUT_MS;
}

/** Expiración de servidor tras actividad en `now`. */
export function sessionExpiresAt(createdAt, now) {
  return Math.min(now + IDLE_TIMEOUT_MS, absoluteDeadline(createdAt));
}

/** Solo los campos permitidos; cualquier otro dato del objeto sesión se descarta. */
function toPayload(sess) {
  const payload = { cookie: sess.cookie, csrfToken: sess.csrfToken, createdAt: sess.createdAt };
  if (sess.userId !== undefined) payload.userId = sess.userId;
  return JSON.stringify(payload);
}

function isValidPayload(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    data.cookie !== null &&
    typeof data.cookie === 'object' &&
    typeof data.csrfToken === 'string' &&
    Number.isSafeInteger(data.createdAt) &&
    (data.userId === undefined || (typeof data.userId === 'string' && UUID.test(data.userId)))
  );
}

export class SqliteSessionStore extends session.Store {
  /**
   * @param {{ db: import('node:sqlite').Database, now?: () => number }} options
   */
  constructor({ db, now = Date.now }) {
    super();
    if (!db) throw new Error('SqliteSessionStore requiere una base de datos abierta');
    this.now = now;
    this.statements = {
      get: db.prepare('SELECT payload, expires_at FROM sessions WHERE id_hash = ?'),
      upsert: db.prepare(
        `INSERT INTO sessions (id_hash, payload, expires_at) VALUES (?, ?, ?)
         ON CONFLICT (id_hash) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at`,
      ),
      touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ? AND expires_at > ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    };
    this.cleanup();
  }

  /** Lectura: una sesión caducada (inactividad o absoluta) o corrupta no revive y se borra. */
  get(sid, callback) {
    try {
      const idHash = hashSessionId(sid);
      const row = this.statements.get.get(idHash);
      if (!row) return callback(null, null);
      const now = this.now();
      let data;
      try {
        data = JSON.parse(row.payload);
      } catch {
        data = null;
      }
      if (row.expires_at <= now || !isValidPayload(data) || absoluteDeadline(data.createdAt) <= now) {
        this.statements.destroy.run(idHash);
        return callback(null, null);
      }
      return callback(null, data);
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const idHash = hashSessionId(sid);
      const payload = toPayload(sess);
      if (!isValidPayload(JSON.parse(payload))) {
        throw new Error('Sesión sin csrfToken/createdAt válidos; no se guarda.');
      }
      const now = this.now();
      const expiresAt = sessionExpiresAt(sess.createdAt, now);
      if (expiresAt <= now) {
        this.statements.destroy.run(idHash);
      } else {
        this.statements.upsert.run(idHash, payload, expiresAt);
      }
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  /** Renueva la inactividad sin superar el límite absoluto ni revivir registros vencidos. */
  touch(sid, sess, callback = () => {}) {
    try {
      const now = this.now();
      if (Number.isSafeInteger(sess?.createdAt)) {
        const expiresAt = sessionExpiresAt(sess.createdAt, now);
        if (expiresAt > now) this.statements.touch.run(expiresAt, hashSessionId(sid), now);
      }
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.statements.destroy.run(hashSessionId(sid));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  /** Borra las sesiones vencidas; devuelve cuántas. */
  cleanup() {
    return Number(this.statements.cleanup.run(this.now()).changes);
  }
}
