import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/db.js';
import { EmailUnavailableError, IdentityConflictError, createAccountStore } from '../src/identities.js';

// Repositorio de cuentas sobre una DB temporal migrada (nunca DATABASE_PATH real).
const NOW = '2026-11-22T10:00:00.000Z';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
let dir;
let db;
let store;

const count = (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-identities-'));
  db = openDatabase(join(dir, 'x.sqlite'));
  migrate(db);
  store = createAccountStore({ db });
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createAccountStore', () => {
  it('alta local crea usuario y credencial; correo duplicado no deja filas sueltas', () => {
    const id = randomUUID();
    expect(store.createLocalUser({ id, email: 'ana@example.com', passwordHash: HASH, createdAt: NOW })).toEqual({ id, email: 'ana@example.com' });
    expect(store.findLocalByEmail('ana@example.com')).toEqual({ id, email: 'ana@example.com', passwordHash: HASH });
    expect(store.passwordHashOf(id)).toBe(HASH);
    expect(() => store.createLocalUser({ id: randomUUID(), email: 'ana@example.com', passwordHash: HASH, createdAt: NOW }))
      .toThrow(EmailUnavailableError);
    // Un hash inválido revierte también el usuario.
    expect(() => store.createLocalUser({ id: randomUUID(), email: 'b@example.com', passwordHash: 'plano', createdAt: NOW })).toThrow(/CHECK/);
    expect(count('users')).toBe(1);
    expect(count('password_credentials')).toBe(1);
    expect(db.isTransaction).toBe(false);
  });

  it('alta Google no crea credencial local y se encuentra por sub, no por correo', () => {
    const id = randomUUID();
    store.createUserWithIdentity({ id, email: 'g@example.com', provider: 'google', subject: 'sub-1', createdAt: NOW });
    expect(store.findUserByIdentity('google', 'sub-1')).toEqual({ id, email: 'g@example.com' });
    expect(store.findUserByIdentity('google', 'sub-2')).toBeUndefined();
    expect(store.findLocalByEmail('g@example.com')).toBeUndefined();
    expect(store.passwordHashOf(id)).toBeUndefined();
    expect(store.providersOf(id)).toEqual(['google']);
    // Correo ya usado: no crea usuario ni identidad.
    expect(() => store.createUserWithIdentity({ id: randomUUID(), email: 'g@example.com', provider: 'google', subject: 'sub-3', createdAt: NOW }))
      .toThrow(EmailUnavailableError);
    expect(store.findUserByIdentity('google', 'sub-3')).toBeUndefined();
    expect(count('users')).toBe(1);
  });

  it('linkIdentity vincula, es idempotente y rechaza conflictos sin mutar', () => {
    const a = randomUUID();
    const b = randomUUID();
    store.createLocalUser({ id: a, email: 'a@example.com', passwordHash: HASH, createdAt: NOW });
    store.createLocalUser({ id: b, email: 'b@example.com', passwordHash: HASH, createdAt: NOW });
    expect(store.linkIdentity({ userId: a, provider: 'google', subject: 'sub-a', createdAt: NOW })).toEqual({ linked: true });
    expect(store.linkIdentity({ userId: a, provider: 'google', subject: 'sub-a', createdAt: NOW })).toEqual({ linked: false });
    expect(() => store.linkIdentity({ userId: b, provider: 'google', subject: 'sub-a', createdAt: NOW })).toThrow(IdentityConflictError);
    expect(() => store.linkIdentity({ userId: a, provider: 'google', subject: 'sub-otro', createdAt: NOW })).toThrow(IdentityConflictError);
    expect(db.prepare('SELECT provider, subject, user_id FROM external_identities').all()).toEqual([
      { provider: 'google', subject: 'sub-a', user_id: a },
    ]);
    expect(store.passwordHashOf(a)).toBe(HASH);
    expect(store.passwordHashOf(b)).toBe(HASH);
    expect(db.isTransaction).toBe(false);
  });

  it('valida proveedor y sub antes de consultar', () => {
    expect(() => store.findUserByIdentity('github', 'x')).toThrow(TypeError);
    expect(() => store.findUserByIdentity('google', '')).toThrow(TypeError);
    expect(() => store.findUserByIdentity('google', 's'.repeat(256))).toThrow(TypeError);
  });
});
