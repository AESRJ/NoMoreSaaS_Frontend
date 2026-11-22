import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Database } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConfigError, DEFAULT_DATABASE_PATH, resolveDatabasePath } from './config.js';

// Persistencia SQLite local (node:sqlite, síncrono, monoproceso). Sin WAL:
// journal DELETE y synchronous FULL priorizan durabilidad sobre rendimiento.

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
export const BUSY_TIMEOUT_MS = 5000;

const MIGRATION_FILE = /^(\d{3})-([a-z0-9-]+)\.sql$/;

export class DatabaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

function applyPragmas(db) {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
  `);
  const fk = db.prepare('PRAGMA foreign_keys').get();
  const journal = db.prepare('PRAGMA journal_mode').get();
  if (fk.foreign_keys !== 1 || journal.journal_mode !== 'delete') {
    throw new DatabaseError('No se pudieron aplicar los pragmas requeridos de SQLite.');
  }
}

/**
 * Abre un archivo SQLite existente o lo crea si su carpeta existe. Nunca usa
 * memoria como sustituto ni reemplaza un archivo inválido: cualquier fallo
 * cierra la conexión y lanza DatabaseError.
 */
export function openDatabase(path, { createParentDir = false } = {}) {
  if (typeof path !== 'string' || path === '' || path === ':memory:' || path.toLowerCase().startsWith('file:')) {
    throw new DatabaseError('Se requiere la ruta de un archivo SQLite; no se admite base en memoria.');
  }
  let db;
  try {
    if (createParentDir) mkdirSync(dirname(path), { recursive: true });
    db = new Database(path, { timeout: BUSY_TIMEOUT_MS, enableForeignKeyConstraints: true });
    applyPragmas(db);
    return db;
  } catch (error) {
    if (db && db.isOpen) db.close();
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(`No se pudo abrir la base de datos en ${path}: ${error.message}`, { cause: error });
  }
}

/** Lee las migraciones NNN-nombre.sql en orden de versión. */
export function loadMigrations(dir = MIGRATIONS_DIR) {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = MIGRATION_FILE.exec(file);
      if (!match) throw new DatabaseError(`Nombre de migración inválido: ${file}`);
      return { version: Number(match[1]), name: match[2], sql: readFileSync(join(dir, file), 'utf8') };
    })
    .sort((a, b) => a.version - b.version);
  migrations.forEach((m, i) => {
    if (i > 0 && m.version === migrations[i - 1].version) {
      throw new DatabaseError(`Versión de migración duplicada: ${m.version}`);
    }
  });
  return migrations;
}

/**
 * Aplica las migraciones pendientes, cada una en su propia transacción
 * BEGIN IMMEDIATE junto con su registro en schema_migrations. Un fallo revierte
 * esa migración completa. Idempotente: las versiones aplicadas se omiten. No
 * hay downgrade: una versión desconocida en la DB detiene el proceso.
 * Devuelve las versiones aplicadas en esta llamada.
 */
export function migrate(db, { migrations = loadMigrations(), now = () => new Date() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const row of db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()) {
    const expected = known.get(row.version);
    if (!expected) {
      throw new DatabaseError(`La base tiene la migración ${row.version}, desconocida para este código; no se hace downgrade.`);
    }
    if (expected.name !== row.name) {
      throw new DatabaseError(`La migración ${row.version} aplicada (${row.name}) no coincide con ${expected.name}.`);
    }
  }

  const isApplied = db.prepare('SELECT 1 AS applied FROM schema_migrations WHERE version = ?');
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const applied = [];
  for (const migration of migrations) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Se comprueba dentro de la transacción por si otro proceso migró antes.
      if (!isApplied.get(migration.version)) {
        db.exec(migration.sql);
        record.run(migration.version, migration.name, now().toISOString());
        applied.push(migration.version);
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw new DatabaseError(`Falló la migración ${migration.version}-${migration.name}: ${error.message}`, { cause: error });
    }
  }
  return applied;
}

/** Comando `pnpm db:migrate`: migra la DB configurada y termina. */
export function runMigrateCli(env = process.env, out = console) {
  let db;
  try {
    const path = resolveDatabasePath(env);
    db = openDatabase(path, { createParentDir: path === DEFAULT_DATABASE_PATH });
    const applied = migrate(db);
    out.log(applied.length
      ? `[db] migraciones aplicadas: ${applied.join(', ')} en ${path}`
      : `[db] sin migraciones pendientes en ${path}`);
    return 0;
  } catch (error) {
    const known = error instanceof ConfigError || error instanceof DatabaseError;
    out.error(`[db] ${known ? error.message : `error inesperado: ${error.message}`}`);
    return 1;
  } finally {
    if (db && db.isOpen) db.close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = runMigrateCli();
}
