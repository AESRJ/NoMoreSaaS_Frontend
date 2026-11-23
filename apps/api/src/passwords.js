import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// Hash de contraseñas con Argon2id nativo de Node (crypto.argon2, asíncrono en
// el threadpool de libuv). El texto original nunca se persiste ni se registra.

export const ARGON2_ALGORITHM = 'argon2id';
export const ARGON2_VERSION = 19; // Argon2 v1.3 (0x13)
export const ARGON2_PARAMS = Object.freeze({ memory: 19456, passes: 2, parallelism: 1, tagLength: 32 });
export const SALT_BYTES = 16;
export const PASSWORD_MIN_CODE_POINTS = 8;
export const PASSWORD_MAX_CODE_POINTS = 128;
export const HASH_MAX_CONCURRENT = 2;
export const HASH_MAX_QUEUE = 10;

const ENCODED = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** La cola de hashing está llena: la API responde 429 sin calcular nada. */
export class HasherBusyError extends Error {
  constructor() {
    super('Demasiadas operaciones de contraseña en curso.');
    this.name = 'HasherBusyError';
  }
}

/** Longitud en puntos Unicode, no en unidades UTF-16. */
export function countCodePoints(value) {
  return [...value].length;
}

/** Contraseña de entrada: texto de 15 a 128 puntos Unicode, sin trim ni normalización. */
export function isValidPassword(value) {
  if (typeof value !== 'string') return false;
  const n = countCodePoints(value);
  return n >= PASSWORD_MIN_CODE_POINTS && n <= PASSWORD_MAX_CODE_POINTS;
}

const b64 = (buf) => buf.toString('base64').replace(/=+$/, '');

function derive(password, salt, { memory, passes, parallelism, tagLength }) {
  return new Promise((resolve, reject) => {
    argon2(
      ARGON2_ALGORITHM,
      { message: Buffer.from(password, 'utf8'), nonce: salt, memory, passes, parallelism, tagLength },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** Formato PHC versionado: $argon2id$v=19$m=…,t=…,p=…$salt$tag (base64 sin relleno). */
export function encodeHash(salt, tag, params = ARGON2_PARAMS) {
  return `$${ARGON2_ALGORITHM}$v=${ARGON2_VERSION}$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

/**
 * Devuelve salt/tag y los parámetros fijados, o null si el hash no coincide
 * exactamente con el único formato que se genera (v=19, m=19456, t=2, p=1,
 * salt de 16 bytes, tag de 32, base64 canónico). Un registro corrupto o con
 * parámetros arbitrarios se rechaza antes de derivar: nunca dicta el coste.
 */
export function parseHash(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 128) return null;
  const match = ENCODED.exec(encoded);
  if (!match) return null;
  const [, version, memory, passes, parallelism, saltB64, tagB64] = match;
  if (
    version !== String(ARGON2_VERSION) ||
    memory !== String(ARGON2_PARAMS.memory) ||
    passes !== String(ARGON2_PARAMS.passes) ||
    parallelism !== String(ARGON2_PARAMS.parallelism)
  ) {
    return null;
  }
  const salt = Buffer.from(saltB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (salt.length !== SALT_BYTES || tag.length !== ARGON2_PARAMS.tagLength) return null;
  if (b64(salt) !== saltB64 || b64(tag) !== tagB64) return null; // codificación no canónica
  return { ...ARGON2_PARAMS, salt, tag };
}

/**
 * Hasher con concurrencia limitada: como máximo `maxConcurrent` derivaciones a
 * la vez y `maxQueue` en espera; más allá se rechaza con HasherBusyError.
 */
export function createPasswordHasher({
  maxConcurrent = HASH_MAX_CONCURRENT,
  maxQueue = HASH_MAX_QUEUE,
  params = ARGON2_PARAMS,
} = {}) {
  let active = 0;
  const queue = [];

  function execute(task) {
    return task().finally(() => {
      active -= 1;
      const next = queue.shift();
      if (next) {
        active += 1;
        execute(next.task).then(next.resolve, next.reject);
      }
    });
  }

  function schedule(task) {
    if (active < maxConcurrent) {
      active += 1;
      return execute(task);
    }
    if (queue.length >= maxQueue) return Promise.reject(new HasherBusyError());
    return new Promise((resolve, reject) => queue.push({ task, resolve, reject }));
  }

  async function hash(password) {
    if (typeof password !== 'string') throw new TypeError('La contraseña debe ser texto.');
    return schedule(async () => {
      const salt = randomBytes(SALT_BYTES);
      const tag = await derive(password, salt, params);
      return encodeHash(salt, tag, params);
    });
  }

  /** Comparación en tiempo constante; un hash malformado nunca verifica. */
  async function verify(password, encoded) {
    const parsed = parseHash(encoded);
    if (typeof password !== 'string' || !parsed) return false;
    return schedule(async () => {
      const tag = await derive(password, parsed.salt, parsed);
      return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag);
    });
  }

  // Hash ficticio con el mismo coste para correos inexistentes: el tiempo de
  // respuesta no revela si la cuenta existe.
  let dummy;
  async function verifyDummy(password) {
    dummy ??= hash(randomBytes(32).toString('hex')).catch((error) => {
      dummy = undefined;
      throw error;
    });
    await verify(typeof password === 'string' ? password : '', await dummy);
    return false;
  }

  return {
    hash,
    verify,
    verifyDummy,
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
  };
}
