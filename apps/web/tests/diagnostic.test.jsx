import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile, toWorkflow } from '../src/api/workflow.js';
import { readBrowserHints } from '../src/diagnostic.js';
import { clearProjectDraft } from '../src/store/projectDraft.js';
import { anonymousAuthClient, emptyProjectsClient, renderApp } from './helpers.jsx';

// Entrega 007: ayuda parcial del navegador y procedencia del perfil.
// Solo fixtures: ningún dato real del equipo que ejecuta las pruebas (los
// valores del navegador se inyectan).
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com' };
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const DIAGNOSTIC = Object.freeze({
  schemaVersion: 1,
  capturedAt: '2026-11-21T09:30:00.000Z',
  os: 'windows',
  architecture: 'amd64',
  cpu: { model: 'Ficticio CPU 8-Core', physicalCores: 8, logicalThreads: 16 },
  ramBytes: 34359738368,
  volumes: [
    { label: 'Volume 1', freeBytes: 214748364800, sizeBytes: 512110190592 },
    { label: 'Volume 2', freeBytes: 1099511627776, sizeBytes: 2000398934016 },
  ],
  gpuNames: ['Ficticia GPU 4000'],
});

const PROJECT = {
  id: P1,
  name: 'Mi nube',
  description: '',
  alternativeIds: ['archivero'],
  alternatives: [{ id: 'archivero', name: 'Archivero', available: true }],
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
};
const PROFILE = { revision: 1, cpuCores: 4, ramGiB: 8, storageGiB: 500, os: 'linux', architecture: 'amd64', storageKind: 'ssd', users: 2, dataGiB: 50, access: 'local', hasDomain: false, cpuFeaturesKnown: false };
const EMPTY_PROGRESS = { completedStepIds: [], stale: false, updatedAt: null };
const EMPTY_DOC = { profile: null, provenance: null, evaluation: null, plan: null, progress: EMPTY_PROGRESS };
const MANUAL = { source: 'manual', certainty: 'declared', capturedAt: null };
const IMPORTED = { source: 'import', certainty: 'reported', capturedAt: DIAGNOSTIC.capturedAt };

function signedIn() {
  return anonymousAuthClient({ fetchSession: vi.fn().mockResolvedValueOnce({ user: USER, csrfToken: 'a1' }).mockResolvedValue({ user: null, csrfToken: 'p2' }) });
}
function client(overrides = {}) {
  return emptyProjectsClient({
    getProject: vi.fn(() => Promise.resolve(PROJECT)),
    getWorkflow: vi.fn(() => Promise.resolve(EMPTY_DOC)),
    saveProfile: vi.fn(() => Promise.reject(new Error('saveProfile no simulado'))),
    ...overrides,
  });
}
const open = (projectsClient) => renderApp(`/proyectos/${P1}/flujo?vista=equipo`, { authClient: signedIn(), projectsClient });

function injectNavigator(values) {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(window.navigator, key, { value, configurable: true });
  return () => {
    for (const key of Object.keys(values)) delete window.navigator[key];
  };
}

// Por defecto ninguna prueba ve los getters reales de jsdom (reflejan la máquina de pruebas):
// cada prueba que necesite valores los inyecta explícitamente.
let restoreDefaultNavigator = () => {};
beforeEach(() => {
  clearProjectDraft();
  restoreDefaultNavigator = injectNavigator({ hardwareConcurrency: undefined, deviceMemory: undefined });
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreDefaultNavigator();
});

describe('readBrowserHints', () => {



  it('navegador: hilos y RAM aproximados si existen; nada inventado si faltan', () => {
    expect(readBrowserHints({ hardwareConcurrency: 6, deviceMemory: 8 }).map((h) => [h.key, h.value])).toEqual([['cpuCores', 6], ['ramGiB', 8]]);
    expect(readBrowserHints({ hardwareConcurrency: 6 }).map((h) => h.key)).toEqual(['cpuCores']);
    expect(readBrowserHints({})).toEqual([]);
    // null explícito: el valor por defecto leería el navigator de jsdom (que refleja la máquina de pruebas).
    expect(readBrowserHints(null)).toEqual([]);
    expect(readBrowserHints({ hardwareConcurrency: 512, deviceMemory: 0.25 }).every((h) => h.value === undefined && h.error)).toBe(true);
  });
});

describe('cliente HTTP con procedencia', () => {
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('envía procedencia normalizada con collectorVersion null y sin el diagnóstico', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok(EMPTY_DOC)));
    vi.stubGlobal('fetch', fetchMock);
    await saveProfile(P1, PROFILE, { csrfToken: 't', provenance: { target: 'other-device', fields: { ramGiB: { ...IMPORTED, extra: 'x' } }, diagnostic: DIAGNOSTIC } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.provenance).toEqual({ target: 'other-device', collectorVersion: null, fields: { ramGiB: IMPORTED } });
    expect(fetchMock.mock.calls[0][1].body).not.toContain('Ficticio');
    await saveProfile(P1, PROFILE, { csrfToken: 't' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('provenance');
  });

  it('un servidor sin procedencia se lee como null; una procedencia malformada es error', () => {
    expect(toWorkflow({ ...EMPTY_DOC, provenance: undefined }).provenance).toBeNull();
    expect(toWorkflow({ ...EMPTY_DOC, provenance: { target: 'x', fields: {} } }).provenance.fields.cpuCores).toEqual(MANUAL);
    expect(() => toWorkflow({ ...EMPTY_DOC, provenance: { fields: { cpuCores: { source: 'agente' } } } })).toThrow();
  });
});

describe('Equipo: rellenar con ayuda', () => {
  let restore = () => {};
  afterEach(() => restore());

  async function fillUsage(user) {
    await user.clear(screen.getByLabelText('Usuarios previstos'));
    await user.type(screen.getByLabelText('Usuarios previstos'), '3');
    await user.type(screen.getByLabelText('Datos previstos (GiB)'), '100');
  }




  it('navegador: solo para este equipo, con confirmación; datos aproximados y sin disco', async () => {
    restore = injectNavigator({ hardwareConcurrency: 6, deviceMemory: 8 });
    const saveProfileMock = vi.fn(() => Promise.resolve(EMPTY_DOC));
    const { user } = open(client({ saveProfile: saveProfileMock }));
    expect(await screen.findByText(/el navegador no puede ver otros ordenadores/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leer datos de este navegador' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Este equipo/ }));
    await user.click(screen.getByRole('button', { name: 'Leer datos de este navegador' }));
    expect(screen.getByRole('table', { name: 'Datos aproximados del navegador' })).toBeInTheDocument();
    expect(screen.getByText(/no son núcleos físicos/)).toBeInTheDocument();
    expect(screen.getByLabelText('Núcleos de CPU')).toHaveValue(null);
    await user.click(screen.getByRole('button', { name: 'Usar estos valores aproximados' }));
    expect(screen.getByLabelText('Núcleos de CPU')).toHaveValue(6);
    expect(screen.getByLabelText('RAM (GiB)')).toHaveValue(8);
    expect(screen.getByLabelText('Espacio libre en disco (GiB)')).toHaveValue(null);
    expect(screen.getByLabelText('Núcleos de CPU')).toHaveAccessibleDescription(/Aproximado por el navegador/);

    // Cambiar a otro equipo vacía lo que leyó el navegador.
    await user.click(screen.getByRole('radio', { name: /Otro equipo/ }));
    expect(screen.getByLabelText('Núcleos de CPU')).toHaveValue(null);
    expect(screen.getByText(/Se han vaciado los campos rellenados por el navegador/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Este equipo/ }));
    await user.click(screen.getByRole('button', { name: 'Leer datos de este navegador' }));
    await user.click(screen.getByRole('button', { name: 'Usar estos valores aproximados' }));
    await user.type(screen.getByLabelText('Espacio libre en disco (GiB)'), '200');
    await fillUsage(user);
    await user.click(screen.getByRole('button', { name: 'Guardar equipo' }));
    const [, profile, options] = saveProfileMock.mock.calls[0];
    expect(profile).toMatchObject({ cpuCores: 6, ramGiB: 8, storageGiB: 200 });
    expect(options.provenance.target).toBe('this-device');
    expect(options.provenance.fields).toEqual({
      cpuCores: { source: 'browser', certainty: 'approximate', capturedAt: expect.any(String) },
      ramGiB: { source: 'browser', certainty: 'approximate', capturedAt: expect.any(String) },
    });
  });




  it('navegador sin datos de hardware: lo dice y no rellena nada', async () => {
    restore = injectNavigator({ hardwareConcurrency: undefined, deviceMemory: undefined });
    const { user } = open(client());
    await user.click(await screen.findByRole('radio', { name: /Este equipo/ }));
    await user.click(screen.getByRole('button', { name: 'Leer datos de este navegador' }));
    expect(screen.getByText(/no ofrece datos de hardware/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar estos valores aproximados' })).not.toBeInTheDocument();
  });

  it('perfil guardado con procedencia: muestra destino y origen; perfil antiguo se ve manual', async () => {
    const provenance = {
      target: 'other-device',
      collectorVersion: null,
      updatedAt: '2026-11-22T10:00:00.000Z',
      fields: { ...Object.fromEntries(Object.keys(PROFILE).filter((k) => k !== 'revision').map((k) => [k, MANUAL])), ramGiB: IMPORTED },
    };
    open(client({ getWorkflow: vi.fn(() => Promise.resolve({ ...EMPTY_DOC, profile: PROFILE, provenance })) }));
    expect(await screen.findByRole('radio', { name: /Otro equipo/ })).toBeChecked();
    expect(screen.getByLabelText('RAM (GiB)')).toHaveAccessibleDescription(/Importado del diagnóstico/);
    expect(screen.getByLabelText('Núcleos de CPU')).not.toHaveAccessibleDescription(/Importado|Aproximado/);
    // Sin cambios no aparece «Descartar cambios».
    expect(screen.queryByRole('button', { name: 'Descartar cambios' })).not.toBeInTheDocument();
  });

  it('perfil sin procedencia (anterior a 007): guardar sin ayuda envía lo mismo que antes', async () => {
    const saveProfileMock = vi.fn(() => Promise.resolve({ ...EMPTY_DOC, profile: { ...PROFILE, revision: 2, cpuCores: 6 } }));
    const { user } = open(client({ getWorkflow: vi.fn(() => Promise.resolve({ ...EMPTY_DOC, profile: PROFILE })), saveProfile: saveProfileMock }));
    const cores = await screen.findByLabelText('Núcleos de CPU');
    expect(screen.getByRole('radio', { name: /Este equipo/ })).not.toBeChecked();
    await user.clear(cores);
    await user.type(cores, '6');
    await user.click(screen.getByRole('button', { name: 'Guardar y recalcular' }));
    await waitFor(() => expect(saveProfileMock).toHaveBeenCalledTimes(1));
    expect(saveProfileMock.mock.calls[0][2]).toEqual({ csrfToken: 'a1' });
  });
});
