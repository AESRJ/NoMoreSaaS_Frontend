import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigError,
  DEFAULT_DATABASE_PATH,
  REPO_ROOT,
  loadConfig,
  resolveDatabasePath,
} from '../src/config.js';
import { DatabaseError, loadMigrations, migrate, openDatabase, runMigrateCli } from '../src/db.js';

// Todas las pruebas usan archivos temporales propios; nunca DATABASE_PATH real.
let dir;
const open = [];

function tempDb(name = 'test.sqlite') {
  const db = openDatabase(join(dir, name));
  open.push(db);
  return db;
}

const NOW = '2026-11-21T10:00:00.000Z';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';

function insertUser(db, email = 'ana@example.com', id = randomUUID()) {
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, NOW);
  db.prepare('INSERT INTO password_credentials (user_id, password_hash) VALUES (?, ?)').run(id, HASH);
  return id;
}

// Esquema previo a 003: el hash vivía en users.password_hash.
function insertLegacyUser(db, email, hash = HASH, id = randomUUID()) {
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, email, hash, NOW);
  return id;
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

function insertProject(db, ownerId, { id = randomUUID(), name = 'Proyecto', alternatives = ['alt-uno'] } = {}) {
  db.prepare(
    'INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, ownerId, name, '', NOW, NOW);
  const sel = db.prepare('INSERT INTO project_selections (project_id, alternative_id, position) VALUES (?, ?, ?)');
  alternatives.forEach((alt, i) => sel.run(id, alt, i));
  return id;
}

const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-db-'));
});

afterEach(() => {
  // Cerrar antes de borrar: Windows bloquea archivos abiertos.
  for (const db of open.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('aplica pragmas de durabilidad e integridad', () => {
    const db = tempDb();
    expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('delete');
    expect(db.prepare('PRAGMA synchronous').get().synchronous).toBe(2); // FULL
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    expect(db.prepare('PRAGMA busy_timeout').get().timeout).toBe(5000);
  });

  it('falla claramente si la carpeta no existe, sin crear nada ni usar memoria', () => {
    const path = join(dir, 'no-existe', 'x.sqlite');
    expect(() => openDatabase(path)).toThrow(DatabaseError);
    expect(() => openDatabase(path)).toThrow(/No se pudo abrir la base de datos/);
    expect(existsSync(join(dir, 'no-existe'))).toBe(false);
  });

  it('rechaza un archivo que no es SQLite y no lo modifica', () => {
    const path = join(dir, 'roto.sqlite');
    const content = 'esto no es una base de datos SQLite, solo texto plano'.repeat(4);
    writeFileSync(path, content);
    expect(() => openDatabase(path)).toThrow(/file is not a database/);
    expect(readFileSync(path, 'utf8')).toBe(content);
  });

  it('rechaza memoria y URI como sustituto', () => {
    for (const bad of [':memory:', '', 'file::memory:', undefined]) {
      expect(() => openDatabase(bad)).toThrow(DatabaseError);
    }
  });
});

describe('migrate', () => {
  it('crea el esquema y es idempotente sin perder datos', () => {
    const db = tempDb();
    expect(migrate(db)).toEqual([1, 2, 3, 4]);
    const userId = insertUser(db);
    insertProject(db, userId, { alternatives: ['alt-uno', 'beta-alt'] });

    expect(migrate(db)).toEqual([]);
    expect(count(db, 'users')).toBe(1);
    expect(count(db, 'projects')).toBe(1);
    expect(count(db, 'project_selections')).toBe(2);
    expect(db.prepare('SELECT version, name FROM schema_migrations').all()).toEqual([
      { version: 1, name: 'identity' },
      { version: 2, name: 'workflow' },
      { version: 3, name: 'google-identity' },
      { version: 4, name: 'profile-provenance' },
    ]);
  });

  it('conserva datos al reabrir el archivo y volver a migrar', () => {
    const path = join(dir, 'persist.sqlite');
    let db = openDatabase(path);
    migrate(db);
    const userId = insertUser(db, 'persistente@example.com');
    const projectId = insertProject(db, userId, { name: 'Persistente', alternatives: ['otra', 'alt-uno'] });
    db.prepare('INSERT INTO sessions (id_hash, payload, expires_at) VALUES (?, ?, ?)').run(
      'a'.repeat(64), JSON.stringify({ csrfToken: 'x', userId }), Date.parse(NOW) + 1000,
    );
    db.close();

    db = openDatabase(path);
    open.push(db);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT email FROM users WHERE id = ?').get(userId).email).toBe('persistente@example.com');
    expect(db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId).name).toBe('Persistente');
    const sel = db.prepare('SELECT alternative_id FROM project_selections WHERE project_id = ? ORDER BY position').all(projectId);
    expect(sel.map((r) => r.alternative_id)).toEqual(['otra', 'alt-uno']);
    expect(JSON.parse(db.prepare('SELECT payload FROM sessions').get().payload).userId).toBe(userId);
  });

  it('002 es aditiva sobre una DB existente en 001: conserva datos, es idempotente y borra en cascada', () => {
    const path = join(dir, 'v1.sqlite');
    let db = openDatabase(path);
    expect(migrate(db, { migrations: loadMigrations().slice(0, 1) })).toEqual([1]);
    const userId = insertLegacyUser(db, 'previo@example.com');
    const projectId = insertProject(db, userId, { name: 'Previo', alternatives: ['otra'] });
    db.close();

    db = openDatabase(path);
    open.push(db);
    expect(migrate(db)).toEqual([2, 3, 4]);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId).name).toBe('Previo');
    expect(count(db, 'project_selections')).toBe(1);
    db.prepare(
      `INSERT INTO project_profiles VALUES (?, 2, 4, 100, 'linux', 'amd64', 'ssd', 1, 10, 'local', 0, 0, 1, ?)`,
    ).run(projectId, NOW);
    db.prepare("INSERT INTO project_progress VALUES (?, 'f', '[]', ?)").run(projectId, NOW);
    expect(() =>
      db.prepare(`INSERT INTO project_profiles VALUES (?, 0, 4, 100, 'linux', 'amd64', 'ssd', 1, 10, 'local', 0, 0, 1, ?)`).run(projectId, NOW),
    ).toThrow(/CHECK|UNIQUE|PRIMARY/);
    db.prepare('DELETE FROM project_selections WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    expect(count(db, 'project_profiles')).toBe(0);
    expect(count(db, 'project_progress')).toBe(0);
  });

  it('revierte por completo una migración fallida y no la registra', () => {
    const db = tempDb();
    const migrations = [
      ...loadMigrations(),
      { version: 90, name: 'rota', sql: 'CREATE TABLE extra (x INTEGER) STRICT; INSERT INTO tabla_inexistente VALUES (1);' },
    ];
    expect(() => migrate(db, { migrations })).toThrow(/Falló la migración 90-rota/);
    expect(db.isTransaction).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'extra'").get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    // Las migraciones válidas quedan aplicadas y usable; reintentar sin la rota no cambia nada.
    insertUser(db);
    expect(migrate(db)).toEqual([]);
    expect(count(db, 'users')).toBe(1);
  });

  it('revierte la 001 entera si falla a mitad', () => {
    const db = tempDb();
    const [first] = loadMigrations();
    const broken = { ...first, sql: `${first.sql}\nSELECT * FROM no_existe;` };
    expect(() => migrate(db, { migrations: [broken] })).toThrow(DatabaseError);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('users','projects','sessions')").all()).toEqual([]);
    expect(count(db, 'schema_migrations')).toBe(0);
  });

  it('se niega a operar con una versión aplicada desconocida (sin downgrade)', () => {
    const db = tempDb();
    migrate(db);
    db.prepare("INSERT INTO schema_migrations VALUES (99, 'futura', ?)").run(NOW);
    expect(() => migrate(db)).toThrow(/desconocida para este código/);
  });
});

describe('migración 003 (credenciales, identidades, intentos OIDC)', () => {
  const HASH_B = '$argon2id$v=19$m=19456,t=2,p=1$b3RyYXNhbHRvdHJhc2FsdA$b3Ryb2hhc2g';
  const SID_HASH = 'c'.repeat(64);
  const h = (ch) => ch.repeat(64);
  const VERIFIER = 'v'.repeat(43);

  // DB real en 002 con dos cuentas, proyectos, perfil, progreso y sesión.
  function seed002(path) {
    const db = openDatabase(path);
    expect(migrate(db, { migrations: loadMigrations().slice(0, 2) })).toEqual([1, 2]);
    const a = insertLegacyUser(db, 'ana@example.com', HASH);
    const b = insertLegacyUser(db, 'beto@example.com', HASH_B);
    const pa = insertProject(db, a, { name: 'De Ana', alternatives: ['alt-uno', 'otra'] });
    const pb = insertProject(db, b, { name: 'De Beto' });
    db.prepare(
      `INSERT INTO project_profiles VALUES (?, 2, 4, 100, 'linux', 'amd64', 'ssd', 1, 10, 'local', 0, 0, 1, ?)`,
    ).run(pa, NOW);
    db.prepare("INSERT INTO project_progress VALUES (?, 'f', '[\"s1\"]', ?)").run(pa, NOW);
    db.prepare('INSERT INTO sessions (id_hash, payload, expires_at) VALUES (?, ?, ?)').run(
      SID_HASH, JSON.stringify({ csrfToken: 't', userId: a }), Date.parse(NOW) + 1000,
    );
    const before = {
      users: db.prepare('SELECT id, email, created_at FROM users ORDER BY id').all(),
      hashes: db.prepare('SELECT id AS user_id, password_hash FROM users ORDER BY id').all(),
      projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
      selections: db.prepare('SELECT * FROM project_selections ORDER BY project_id, position').all(),
      profiles: db.prepare('SELECT * FROM project_profiles').all(),
      progress: db.prepare('SELECT * FROM project_progress').all(),
      sessions: db.prepare('SELECT * FROM sessions').all(),
    };
    db.close();
    return { a, b, pa, pb, before };
  }

  function insertAttempt(db, { state = h('1'), session = SID_HASH, purpose = 'login', userId = null, returnTo = 'projects', verifier = VERIFIER } = {}) {
    db.prepare(
      `INSERT INTO oauth_attempts (state_hash, session_hash, nonce_hash, verifier, purpose, expected_user_id, expires_at, return_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(state, session, h('2'), verifier, purpose, userId, Date.parse(NOW) + 5 * 60 * 1000, returnTo);
  }

  it('desde 002 copia hashes exactos, retira la columna y conserva usuarios, proyectos, sesiones y FK', () => {
    const path = join(dir, 'v2.sqlite');
    const { a, b, pa, before } = seed002(path);
    const db = openDatabase(path);
    open.push(db);
    expect(migrate(db)).toEqual([3, 4]);
    expect(migrate(db)).toEqual([]);

    expect(columns(db, 'users')).toEqual(['id', 'email', 'created_at']);
    expect(db.prepare('SELECT user_id, password_hash FROM password_credentials ORDER BY user_id').all()).toEqual(before.hashes);
    expect(db.prepare('SELECT password_hash FROM password_credentials WHERE user_id = ?').get(b).password_hash).toBe(HASH_B);
    expect(db.prepare('SELECT id, email, created_at FROM users ORDER BY id').all()).toEqual(before.users);
    expect(db.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(before.projects);
    expect(db.prepare('SELECT * FROM project_selections ORDER BY project_id, position').all()).toEqual(before.selections);
    expect(db.prepare('SELECT * FROM project_profiles').all()).toEqual(before.profiles);
    expect(db.prepare('SELECT * FROM project_progress').all()).toEqual(before.progress);
    expect(db.prepare('SELECT * FROM sessions').all()).toEqual(before.sessions);
    expect(count(db, 'external_identities')).toBe(0);
    expect(count(db, 'oauth_attempts')).toBe(0);

    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // Restricciones previas siguen activas tras el DROP COLUMN.
    expect(() => insertUser(db, 'ana@example.com')).toThrow(/UNIQUE constraint failed: users\.email/);
    expect(() => insertProject(db, randomUUID())).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare('DELETE FROM users WHERE id = ?').run(a)).toThrow(/FOREIGN KEY/);
    expect(db.prepare('SELECT name FROM projects WHERE id = ?').get(pa).name).toBe('De Ana');
  });

  it('si 003 falla a mitad se revierte entera y la DB queda en 002 con sus hashes', () => {
    const path = join(dir, 'v2-rota.sqlite');
    const { before } = seed002(path);
    const db = openDatabase(path);
    open.push(db);
    const all = loadMigrations();
    const broken = { ...all[2], sql: `${all[2].sql}\nSELECT * FROM no_existe;` };
    expect(() => migrate(db, { migrations: [...all.slice(0, 2), broken] })).toThrow(/Falló la migración 3-google-identity/);
    expect(db.isTransaction).toBe(false);
    expect(columns(db, 'users')).toContain('password_hash');
    expect(db.prepare('SELECT id AS user_id, password_hash FROM users ORDER BY id').all()).toEqual(before.hashes);
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('password_credentials','external_identities','oauth_attempts')",
    ).all()).toEqual([]);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }]);
    // Reintentar con la migración correcta completa la actualización.
    expect(migrate(db)).toEqual([3, 4]);
    expect(db.prepare('SELECT user_id, password_hash FROM password_credentials ORDER BY user_id').all()).toEqual(before.hashes);
  });

  it('borrar un usuario sin proyectos borra en cascada credencial, identidad e intentos; sesiones borran sus intentos', () => {
    const db = tempDb();
    migrate(db);
    const u = insertUser(db, 'solo@example.com');
    const other = insertUser(db, 'otro@example.com');
    db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run('google', 'sub-u', u, NOW);
    db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run('google', 'sub-o', other, NOW);
    db.prepare('INSERT INTO sessions (id_hash, payload, expires_at) VALUES (?, ?, 1)').run(SID_HASH, '{}');
    db.prepare('INSERT INTO sessions (id_hash, payload, expires_at) VALUES (?, ?, 1)').run(h('d'), '{}');
    insertAttempt(db, { state: h('1'), purpose: 'link', userId: u, returnTo: 'account' });
    insertAttempt(db, { state: h('3'), session: h('d') });

    db.prepare('DELETE FROM users WHERE id = ?').run(u);
    expect(db.prepare('SELECT user_id FROM password_credentials').all()).toEqual([{ user_id: other }]);
    expect(db.prepare('SELECT subject FROM external_identities').all()).toEqual([{ subject: 'sub-o' }]);
    expect(db.prepare('SELECT state_hash FROM oauth_attempts').all()).toEqual([{ state_hash: h('3') }]);

    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(h('d'));
    expect(count(db, 'oauth_attempts')).toBe(0);
  });

  it('004 es aditiva sobre una DB en 003: conserva todo, perfiles previos sin procedencia, restricciones y cascada', () => {
    const path = join(dir, 'v3.sqlite');
    const { pa, pb, before } = seed002(path);
    let db = openDatabase(path);
    expect(migrate(db, { migrations: loadMigrations().slice(0, 3) })).toEqual([3]);
    const at003 = {
      credentials: db.prepare('SELECT * FROM password_credentials ORDER BY user_id').all(),
      users: db.prepare('SELECT * FROM users ORDER BY id').all(),
    };
    db.close();

    db = openDatabase(path);
    open.push(db);
    expect(migrate(db)).toEqual([4]);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(at003.users);
    expect(db.prepare('SELECT * FROM password_credentials ORDER BY user_id').all()).toEqual(at003.credentials);
    expect(db.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(before.projects);
    expect(db.prepare('SELECT * FROM project_profiles').all()).toEqual(before.profiles);
    expect(db.prepare('SELECT * FROM project_progress').all()).toEqual(before.progress);
    expect(db.prepare('SELECT * FROM sessions').all()).toEqual(before.sessions);
    expect(count(db, 'project_profile_provenance')).toBe(0);
    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');

    const ins = db.prepare('INSERT INTO project_profile_provenance VALUES (?, ?, ?, ?, ?)');
    ins.run(pa, 'other-device', '{"ramGiB":{"source":"import","certainty":"reported","capturedAt":"2026-11-20T10:00:00.000Z"}}', null, NOW);
    expect(() => ins.run(pb, 'servidor', '{}', null, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(pb, 'this-device', '[]', null, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(pb, 'this-device', 'no-json', null, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(pb, 'this-device', '{}', 'v'.repeat(41), NOW)).toThrow(/CHECK/);
    expect(() => ins.run(pb, 'this-device', '{}', null, 'ayer')).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID(), 'this-device', '{}', null, NOW)).toThrow(/FOREIGN KEY/);
    expect(() => ins.run(pa, 'this-device', '{}', null, NOW)).toThrow(/UNIQUE|PRIMARY/);
    db.prepare('DELETE FROM project_selections WHERE project_id = ?').run(pa);
    db.prepare('DELETE FROM projects WHERE id = ?').run(pa);
    expect(count(db, 'project_profile_provenance')).toBe(0);
  });

  it('identidades: (provider, subject) único, un vínculo Google por usuario, proveedor y sub válidos', () => {
    const db = tempDb();
    migrate(db);
    const u = insertUser(db, 'u@example.com');
    const v = insertUser(db, 'v@example.com');
    const ins = db.prepare('INSERT INTO external_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)');
    ins.run('google', 'sub-1', u, NOW);
    expect(() => ins.run('google', 'sub-1', v, NOW)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => ins.run('google', 'sub-2', u, NOW)).toThrow(/UNIQUE/);
    expect(() => ins.run('github', 'sub-3', v, NOW)).toThrow(/CHECK/);
    expect(() => ins.run('google', '', v, NOW)).toThrow(/CHECK/);
    expect(() => ins.run('google', 's'.repeat(256), v, NOW)).toThrow(/CHECK/);
    expect(() => ins.run('google', 'sub-4', randomUUID(), NOW)).toThrow(/FOREIGN KEY/);
    expect(() => ins.run('google', 'sub-5', v, 'ayer')).toThrow(/CHECK/);
    ins.run('google', 's'.repeat(255), v, NOW);
    expect(count(db, 'external_identities')).toBe(2);
  });

  it('intentos: hashes hex, verifier PKCE, propósito/usuario coherentes y sesión existente', () => {
    const db = tempDb();
    migrate(db);
    const u = insertUser(db);
    db.prepare('INSERT INTO sessions (id_hash, payload, expires_at) VALUES (?, ?, 1)').run(SID_HASH, '{}');
    expect(() => insertAttempt(db, { state: 'estado-en-claro' })).toThrow(/CHECK/);
    expect(() => insertAttempt(db, { session: h('e') })).toThrow(/FOREIGN KEY/);
    expect(() => insertAttempt(db, { verifier: 'corto' })).toThrow(/CHECK/);
    expect(() => insertAttempt(db, { verifier: `${'v'.repeat(42)}/` })).toThrow(/CHECK/);
    expect(() => insertAttempt(db, { verifier: 'v'.repeat(129) })).toThrow(/CHECK/);
    expect(() => insertAttempt(db, { purpose: 'otro' })).toThrow(/CHECK/);
    expect(() => insertAttempt(db, { purpose: 'link' })).toThrow(/CHECK/);
    expect(() => insertAttempt(db, { purpose: 'login', userId: u })).toThrow(/CHECK/);
    expect(() => insertAttempt(db, { returnTo: 'https://evil.example' })).toThrow(/CHECK/);
    insertAttempt(db, { verifier: 'A-z0._~'.padEnd(128, 'x') });
    expect(() => insertAttempt(db)).toThrow(/UNIQUE|PRIMARY/);
    // Consumo atómico de un solo uso: el segundo DELETE … RETURNING no devuelve nada.
    const consume = db.prepare('DELETE FROM oauth_attempts WHERE state_hash = ? AND session_hash = ? RETURNING purpose');
    expect(consume.get(h('1'), SID_HASH)).toEqual({ purpose: 'login' });
    expect(consume.get(h('1'), SID_HASH)).toBeUndefined();
  });
});

describe('restricciones del esquema', () => {
  let db;
  beforeEach(() => {
    db = tempDb();
    migrate(db);
  });

  it('impone correo único', () => {
    insertUser(db, 'ana@example.com');
    expect(() => insertUser(db, 'ana@example.com')).toThrow(/UNIQUE constraint failed: users\.email/);
    expect(count(db, 'users')).toBe(1);
  });

  it('exige correo normalizado y con formato básico', () => {
    for (const bad of ['Ana@Example.com', ' ana@example.com', 'sin-arroba.com', 'a b@example.com', 'ana@dominio', 'ab']) {
      expect(() => insertUser(db, bad), bad).toThrow(/CHECK constraint failed/);
    }
  });

  it('exige hash Argon2id versionado, UUID y fecha UTC', () => {
    const ins = db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)');
    expect(() => ins.run('no-es-uuid', 'a@b.co', NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID().toUpperCase(), 'a@b.co', NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID(), 'a@b.co', '21/11/2026')).toThrow(/CHECK/);
    const cred = db.prepare('INSERT INTO password_credentials (user_id, password_hash) VALUES (?, ?)');
    const id = randomUUID();
    ins.run(id, 'a@b.co', NOW);
    expect(() => cred.run(id, 'texto-plano')).toThrow(/CHECK/);
    expect(() => cred.run(randomUUID(), HASH)).toThrow(/FOREIGN KEY/);
    cred.run(id, HASH);
    expect(() => cred.run(id, HASH)).toThrow(/UNIQUE|PRIMARY/);
  });

  it('valida nombre, descripción y fechas del proyecto', () => {
    const owner = insertUser(db);
    const ins = db.prepare(
      'INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    expect(() => ins.run(randomUUID(), owner, 'ab', '', NOW, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID(), owner, 'x'.repeat(81), '', NOW, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID(), owner, ' Proyecto', '', NOW, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID(), owner, 'Proyecto', 'd'.repeat(1001), NOW, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID(), owner, 'Proyecto', '', NOW, '2026-01-01T00:00:00.000Z')).toThrow(/CHECK/);
    // 80 puntos Unicode (no bytes) es válido.
    ins.run(randomUUID(), owner, 'ñ'.repeat(80), 'd'.repeat(1000), NOW, NOW);
    expect(count(db, 'projects')).toBe(1);
  });

  it('exige propietario existente y no permite borrarlo con proyectos', () => {
    expect(() => insertProject(db, randomUUID())).toThrow(/FOREIGN KEY constraint failed/);
    const owner = insertUser(db);
    insertProject(db, owner);
    expect(() => db.prepare('DELETE FROM users WHERE id = ?').run(owner)).toThrow(/FOREIGN KEY/);
  });

  it('borra en cascada la selección al borrar el proyecto, sin tocar otros', () => {
    const owner = insertUser(db);
    const a = insertProject(db, owner, { alternatives: ['alt-uno', 'beta-alt', 'otra'] });
    const b = insertProject(db, owner, { alternatives: ['alt-uno'] });
    expect(count(db, 'project_selections')).toBe(4);
    db.prepare('DELETE FROM projects WHERE id = ?').run(a);
    expect(db.prepare('SELECT project_id FROM project_selections').all()).toEqual([{ project_id: b }]);
  });

  it('impone selección única por proyecto y posición 0-9', () => {
    const owner = insertUser(db);
    expect(() => insertProject(db, owner, { alternatives: ['alt-uno', 'alt-uno'] })).toThrow(/UNIQUE/);
    const p = insertProject(db, owner, { alternatives: ['alt-uno'] });
    const sel = db.prepare('INSERT INTO project_selections (project_id, alternative_id, position) VALUES (?, ?, ?)');
    expect(() => sel.run(p, 'otra', 0)).toThrow(/UNIQUE/);
    expect(() => sel.run(p, 'otra', 10)).toThrow(/CHECK/);
    expect(() => sel.run(p, 'Otra Mal', 1)).toThrow(/CHECK/);
    expect(() => sel.run(randomUUID(), 'otra', 1)).toThrow(/FOREIGN KEY/);
  });

  it('limita a 100 proyectos por cuenta, independiente entre cuentas', () => {
    const a = insertUser(db, 'a@example.com');
    const b = insertUser(db, 'b@example.com');
    // Preparación: los 100 proyectos en una sola transacción (un commit en disco
    // en lugar de 100). El trigger de cuota se evalúa igual en cada INSERT.
    db.exec('BEGIN IMMEDIATE');
    try {
      for (let i = 0; i < 100; i += 1) insertProject(db, a, { alternatives: [] });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    // El intento 101, ya fuera de la preparación, sigue rechazado por la DB.
    expect(() => insertProject(db, a, { alternatives: [] })).toThrow(/PROJECT_QUOTA_EXCEEDED/);
    expect(db.prepare('SELECT count(*) AS n FROM projects WHERE owner_id = ?').get(a).n).toBe(100);
    insertProject(db, b);
  });

  it('una transacción fallida deja intactos proyecto y selección', () => {
    const owner = insertUser(db);
    const p = insertProject(db, owner, { name: 'Original', alternatives: ['alt-uno'] });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run('Cambiado', p);
      db.prepare('DELETE FROM project_selections WHERE project_id = ?').run(p);
      db.prepare('INSERT INTO project_selections (project_id, alternative_id, position) VALUES (?, ?, ?)').run(p, 'x', 0);
      db.prepare('INSERT INTO project_selections (project_id, alternative_id, position) VALUES (?, ?, ?)').run(p, 'x', 1);
      db.exec('COMMIT');
    } catch {
      db.exec('ROLLBACK');
    }
    expect(db.prepare('SELECT name FROM projects WHERE id = ?').get(p).name).toBe('Original');
    expect(db.prepare('SELECT alternative_id FROM project_selections WHERE project_id = ?').all(p)).toEqual([
      { alternative_id: 'alt-uno' },
    ]);
  });

  it('las sesiones exigen hash SHA-256 hex y payload JSON objeto', () => {
    const ins = db.prepare('INSERT INTO sessions (id_hash, payload, expires_at) VALUES (?, ?, ?)');
    expect(() => ins.run('sid-en-claro', '{}', 1)).toThrow(/CHECK/);
    expect(() => ins.run('b'.repeat(64), 'no json', 1)).toThrow(/CHECK/);
    expect(() => ins.run('b'.repeat(64), '[1]', 1)).toThrow(/CHECK/);
    expect(() => ins.run('b'.repeat(64), '{}', 0)).toThrow(/CHECK/);
    ins.run('b'.repeat(64), '{"csrfToken":"t"}', 1);
    expect(count(db, 'sessions')).toBe(1);
  });
});

describe('configuración', () => {
  const SECRET = 'f3a9c1d27b6e4058a1c2d3e4f5061728394a5b6c7d8e9f00';

  it('usa la ruta local por defecto ignorada por Git', () => {
    expect(resolveDatabasePath({})).toBe(DEFAULT_DATABASE_PATH);
    expect(DEFAULT_DATABASE_PATH).toMatch(/apps[\\/]api[\\/]\.local[\\/]data[\\/]nomoresaas\.sqlite$/);
  });

  it('acepta una ruta absoluta externa y rechaza rutas inseguras', () => {
    const ok = join(dir, 'ok.sqlite');
    expect(resolveDatabasePath({ DATABASE_PATH: ok })).toBe(ok);
    for (const bad of [
      ':memory:',
      'file:x.sqlite',
      'relativa/db.sqlite',
      ` ${ok}`,
      join(dir, 'dist', 'x.sqlite'),
      join(dir, 'public', 'x.sqlite'),
      join(REPO_ROOT, 'apps', 'api', 'data', 'x.sqlite'),
    ]) {
      expect(() => resolveDatabasePath({ DATABASE_PATH: bad }), bad).toThrow(ConfigError);
    }
    expect(resolveDatabasePath({ DATABASE_PATH: join(REPO_ROOT, '.local', 'x.sqlite') })).toBe(join(REPO_ROOT, '.local', 'x.sqlite'));
  });

  it('carga una configuración válida de loopback', () => {
    const cfg = loadConfig({ SESSION_SECRET: SECRET, APP_ORIGIN: 'http://127.0.0.1:5173' });
    expect(cfg).toEqual({
      databasePath: DEFAULT_DATABASE_PATH,
      sessionSecret: SECRET,
      appOrigin: 'http://127.0.0.1:5173',
      cookieSecure: false,
    });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(loadConfig({ SESSION_SECRET: SECRET, APP_ORIGIN: 'https://app.example.com' }).cookieSecure).toBe(true);
  });

  it('falla sin secreto o con secreto débil, sin revelar su valor', () => {
    const weak = 'corto-secreto';
    for (const env of [
      { APP_ORIGIN: 'http://127.0.0.1:5173' },
      { APP_ORIGIN: 'http://127.0.0.1:5173', SESSION_SECRET: weak },
      { APP_ORIGIN: 'http://127.0.0.1:5173', SESSION_SECRET: 'a'.repeat(64) },
    ]) {
      let error;
      try {
        loadConfig(env);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toMatch(/SESSION_SECRET/);
      if (env.SESSION_SECRET) expect(error.message).not.toContain(env.SESSION_SECRET);
    }
  });

  it('exige APP_ORIGIN exacto y https fuera de loopback', () => {
    for (const origin of [undefined, 'no-url', 'ftp://127.0.0.1', 'http://127.0.0.1:5173/', 'http://127.0.0.1:5173/app', 'http://ejemplo.com']) {
      expect(() => loadConfig({ SESSION_SECRET: SECRET, APP_ORIGIN: origin }), String(origin)).toThrow(ConfigError);
    }
    expect(loadConfig({ SESSION_SECRET: SECRET, APP_ORIGIN: 'http://localhost:5573' }).appOrigin).toBe('http://localhost:5573');
  });
});

describe('pnpm db:migrate (runMigrateCli)', () => {
  const quiet = () => ({ log: vi.fn(), error: vi.fn() });

  it('migra la DB configurada, y la segunda ejecución no cambia nada', () => {
    const path = join(dir, 'cli.sqlite');
    const out1 = quiet();
    expect(runMigrateCli({ DATABASE_PATH: path }, out1)).toBe(0);
    expect(out1.log).toHaveBeenCalledWith(expect.stringMatching(/migraciones aplicadas: 1/));
    const out2 = quiet();
    expect(runMigrateCli({ DATABASE_PATH: path }, out2)).toBe(0);
    expect(out2.log).toHaveBeenCalledWith(expect.stringMatching(/sin migraciones pendientes/));
    const db = openDatabase(path);
    open.push(db);
    expect(count(db, 'schema_migrations')).toBe(4);
  });

  it('termina con código 1 y mensaje claro ante ruta inválida, sin crear carpetas', () => {
    for (const env of [
      { DATABASE_PATH: ':memory:' },
      { DATABASE_PATH: 'relativa.sqlite' },
      { DATABASE_PATH: join(dir, 'falta', 'x.sqlite') },
    ]) {
      const out = quiet();
      expect(runMigrateCli(env, out)).toBe(1);
      expect(out.error).toHaveBeenCalledWith(expect.stringMatching(/^\[db\] /));
    }
    expect(existsSync(join(dir, 'falta'))).toBe(false);
  });

  it('no altera un archivo existente que no es SQLite', () => {
    const path = join(dir, 'ajeno.sqlite');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, 'datos ajenos que no deben tocarse '.repeat(8));
    const before = readFileSync(path);
    expect(runMigrateCli({ DATABASE_PATH: path }, quiet())).toBe(1);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});
