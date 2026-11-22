// Repositorio de cuentas: usuarios, credenciales locales (password_credentials)
// e identidades externas (external_identities). Nunca guarda contraseñas en
// claro ni tokens de proveedores; una cuenta Google no recibe hash ficticio.

export const PROVIDERS = Object.freeze(['google']);
const SUBJECT_MAX = 255;

export class EmailUnavailableError extends Error {
  constructor() {
    super('El correo ya pertenece a otra cuenta.');
    this.name = 'EmailUnavailableError';
  }
}

/** Resultado de linkIdentity cuando el sub ya está vinculado a otro usuario o el usuario ya tiene otro sub. */
export class IdentityConflictError extends Error {
  constructor() {
    super('La identidad externa entra en conflicto con un vínculo existente.');
    this.name = 'IdentityConflictError';
  }
}

function assertIdentity(provider, subject) {
  if (!PROVIDERS.includes(provider)) throw new TypeError('Proveedor de identidad no admitido.');
  if (typeof subject !== 'string' || subject.length < 1 || subject.length > SUBJECT_MAX) {
    throw new TypeError('Identificador externo inválido.');
  }
}

const isEmailConflict = (error) => /UNIQUE constraint failed: users\.email/.test(error && error.message);

/**
 * @param {{ db: import('node:sqlite').Database }} options
 */
export function createAccountStore({ db }) {
  if (!db) throw new Error('createAccountStore requiere una base de datos abierta');

  const statements = {
    userById: db.prepare('SELECT id, email FROM users WHERE id = ?'),
    // INNER JOIN: una cuenta solo-Google no tiene credencial y nunca coincide.
    localByEmail: db.prepare(
      `SELECT u.id, u.email, c.password_hash
         FROM users u JOIN password_credentials c ON c.user_id = u.id
        WHERE u.email = ?`,
    ),
    credentialOf: db.prepare('SELECT password_hash FROM password_credentials WHERE user_id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'),
    insertCredential: db.prepare('INSERT INTO password_credentials (user_id, password_hash) VALUES (?, ?)'),
    userByIdentity: db.prepare(
      `SELECT u.id, u.email
         FROM external_identities e JOIN users u ON u.id = e.user_id
        WHERE e.provider = ? AND e.subject = ?`,
    ),
    identityOf: db.prepare('SELECT subject FROM external_identities WHERE user_id = ? AND provider = ?'),
    insertIdentity: db.prepare(
      'INSERT INTO external_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    providersOf: db.prepare('SELECT provider FROM external_identities WHERE user_id = ? ORDER BY provider'),
  };

  /** Transacción de escritura; un error revierte todo. Reutiliza una transacción ya abierta. */
  function transaction(fn) {
    if (db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  function insertUser(id, email, createdAt) {
    try {
      statements.insertUser.run(id, email, createdAt);
    } catch (error) {
      if (isEmailConflict(error)) throw new EmailUnavailableError();
      throw error;
    }
  }

  return {
    findUserById(id) {
      return statements.userById.get(id);
    },

    /** {id,email,passwordHash} de una cuenta con credencial local, o undefined. */
    findLocalByEmail(email) {
      const row = statements.localByEmail.get(email);
      return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : undefined;
    },

    /** Hash local actual del usuario, o undefined si no tiene contraseña (cuenta solo-Google). */
    passwordHashOf(userId) {
      return statements.credentialOf.get(userId)?.password_hash;
    },

    /** Alta local: usuario y credencial en la misma transacción. */
    createLocalUser({ id, email, passwordHash, createdAt }) {
      transaction(() => {
        insertUser(id, email, createdAt);
        statements.insertCredential.run(id, passwordHash);
      });
      return { id, email };
    },

    /** Usuario vinculado a (provider, subject), o undefined. Nunca busca por correo. */
    findUserByIdentity(provider, subject) {
      assertIdentity(provider, subject);
      return statements.userByIdentity.get(provider, subject);
    },

    /** Alta inicial desde proveedor: usuario sin credencial local más su identidad. */
    createUserWithIdentity({ id, email, provider, subject, createdAt }) {
      assertIdentity(provider, subject);
      transaction(() => {
        insertUser(id, email, createdAt);
        statements.insertIdentity.run(provider, subject, id, createdAt);
      });
      return { id, email };
    },

    /**
     * Vincula (provider, subject) a un usuario existente. Idempotente si ya es
     * el mismo vínculo; IdentityConflictError sin mutar nada si el sub es de
     * otro usuario o el usuario ya tiene otro sub de ese proveedor.
     */
    linkIdentity({ userId, provider, subject, createdAt }) {
      assertIdentity(provider, subject);
      return transaction(() => {
        const owner = statements.userByIdentity.get(provider, subject);
        if (owner) {
          if (owner.id === userId) return { linked: false };
          throw new IdentityConflictError();
        }
        if (statements.identityOf.get(userId, provider)) throw new IdentityConflictError();
        statements.insertIdentity.run(provider, subject, userId, createdAt);
        return { linked: true };
      });
    },

    /** Proveedores vinculados al usuario (sin subjects). */
    providersOf(userId) {
      return statements.providersOf.all(userId).map((row) => row.provider);
    },
  };
}
