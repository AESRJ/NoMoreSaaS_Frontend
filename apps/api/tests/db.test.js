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
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, email, HASH, NOW);
  return id;
}

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
    expect(migrate(db)).toEqual([1]);
    const userId = insertUser(db);
    insertProject(db, userId, { alternatives: ['alt-uno', 'beta-alt'] });

    expect(migrate(db)).toEqual([]);
    expect(count(db, 'users')).toBe(1);
    expect(count(db, 'projects')).toBe(1);
    expect(count(db, 'project_selections')).toBe(2);
    expect(db.prepare('SELECT version, name FROM schema_migrations').all()).toEqual([
      { version: 1, name: 'identity' },
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

  it('revierte por completo una migración fallida y no la registra', () => {
    const db = tempDb();
    const migrations = [
      ...loadMigrations(),
      { version: 2, name: 'rota', sql: 'CREATE TABLE extra (x INTEGER) STRICT; INSERT INTO tabla_inexistente VALUES (1);' },
    ];
    expect(() => migrate(db, { migrations })).toThrow(/Falló la migración 2-rota/);
    expect(db.isTransaction).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'extra'").get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    // La 001 válida queda aplicada y usable; reintentar sin la rota no cambia nada.
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
    const ins = db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
    expect(() => ins.run(randomUUID(), 'a@b.co', 'texto-plano', NOW)).toThrow(/CHECK/);
    expect(() => ins.run('no-es-uuid', 'a@b.co', HASH, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID().toUpperCase(), 'a@b.co', HASH, NOW)).toThrow(/CHECK/);
    expect(() => ins.run(randomUUID(), 'a@b.co', HASH, '21/11/2026')).toThrow(/CHECK/);
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
    for (let i = 0; i < 100; i += 1) insertProject(db, a, { alternatives: [] });
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
    expect(count(db, 'schema_migrations')).toBe(1);
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
