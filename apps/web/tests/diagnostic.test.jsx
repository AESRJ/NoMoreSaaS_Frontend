import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile, toWorkflow } from '../src/api/workflow.js';
import { MAX_DIAGNOSTIC_BYTES, bytesToGiB, importRows, parseDiagnostic, readBrowserHints } from '../src/diagnostic.js';
import { clearProjectDraft } from '../src/store/projectDraft.js';
import { anonymousAuthClient, emptyProjectsClient, renderApp } from './helpers.jsx';

// Entrega 007/T002: importación del diagnóstico y ayuda parcial del navegador.
// Solo fixtures: ningún dato real del equipo que ejecuta las pruebas (los
// valores del navegador se inyectan).
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com' };
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = Date.parse('2026-11-22T10:00:00.000Z');
const GIB = 1024 ** 3;

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
const json = (value) => JSON.stringify(value);
const parse = (value) => parseDiagnostic(typeof value === 'string' ? value : json(value), { now: NOW });

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
const fileOf = (text, name = 'equipo.json') => new File([text], name, { type: 'application/json' });

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

describe('parseDiagnostic (esquema Diagnostic v1)', () => {
  it('acepta un diagnóstico válido y copia solo los campos del esquema', () => {
    const result = parse(DIAGNOSTIC);
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(result.diagnostic).toEqual({ ...DIAGNOSTIC, cpu: { ...DIAGNOSTIC.cpu } });
    expect(parse({ ...DIAGNOSTIC, gpuNames: undefined }).diagnostic.gpuNames).toEqual([]);
  });

  it('rechaza JSON inválido, no objeto, campos extra o ausentes, anidamientos y tipos inesperados', () => {
    const bad = [
      'no es json',
      '[]',
      'null',
      json({ ...DIAGNOSTIC, hostname: 'PC-DE-ANA' }),
      json({ ...DIAGNOSTIC, ramBytes: undefined }),
      json({ ...DIAGNOSTIC, schemaVersion: 2 }),
      json({ ...DIAGNOSTIC, capturedAt: '2026-02-30T10:00:00.000Z' }),
      json({ ...DIAGNOSTIC, capturedAt: '2026-11-22T10:06:00.000Z' }),
      json({ ...DIAGNOSTIC, os: 'android' }),
      json({ ...DIAGNOSTIC, architecture: 'x86' }),
      json({ ...DIAGNOSTIC, cpu: { ...DIAGNOSTIC.cpu, serial: 'X' } }),
      json({ ...DIAGNOSTIC, cpu: { physicalCores: 0 } }),
      json({ ...DIAGNOSTIC, cpu: { physicalCores: 2.5 } }),
      json({ ...DIAGNOSTIC, cpu: { logicalThreads: 2048 } }),
      json({ ...DIAGNOSTIC, cpu: { model: 'x'.repeat(201) } }),
      json({ ...DIAGNOSTIC, ramBytes: -1 }),
      json({ ...DIAGNOSTIC, ramBytes: 1.5 }),
      json({ ...DIAGNOSTIC, ramBytes: '8' }),
      json({ ...DIAGNOSTIC, volumes: [{ label: 'C:\\', freeBytes: 1, sizeBytes: 2 }] }),
      json({ ...DIAGNOSTIC, volumes: [{ label: 'Volume 1', freeBytes: 3, sizeBytes: 2 }] }),
      json({ ...DIAGNOSTIC, volumes: [{ label: 'Volume 1', freeBytes: 1, sizeBytes: 2, path: 'D:\\datos' }] }),
      json({ ...DIAGNOSTIC, volumes: Array.from({ length: 33 }, (_, i) => ({ label: `Volume ${i + 1}`, freeBytes: 1, sizeBytes: 2 })) }),
      json({ ...DIAGNOSTIC, gpuNames: Array.from({ length: 9 }, (_, i) => `GPU ${i}`) }),
      json({ ...DIAGNOSTIC, gpuNames: [{ name: 'x' }] }),
    ];
    for (const text of bad) {
      const result = parse(text);
      expect(result.ok, text.slice(0, 80)).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
    // Un campo extra nunca se repite en el mensaje (no se muestra su contenido).
    expect(parse({ ...DIAGNOSTIC, hostname: 'PC-DE-ANA' }).errors.join()).not.toContain('PC-DE-ANA');
  });

  it('rechaza archivos de más de 64 KiB sin parsearlos', () => {
    const big = json({ ...DIAGNOSTIC, padding: 'x'.repeat(MAX_DIAGNOSTIC_BYTES) });
    expect(parse(big)).toEqual({ ok: false, errors: [expect.stringMatching(/64 KiB/)] });
  });

  it('avisa (sin rechazar) si tiene más de 30 días o no es de Windows; tolera 5 minutos en el futuro', () => {
    expect(parse({ ...DIAGNOSTIC, capturedAt: '2026-10-01T00:00:00.000Z' }).warnings).toEqual([expect.stringMatching(/30 días/)]);
    expect(parse({ ...DIAGNOSTIC, os: 'linux' }).warnings).toEqual([expect.stringMatching(/solo para Windows/)]);
    expect(parse({ ...DIAGNOSTIC, capturedAt: '2026-11-22T10:05:00.000Z' }).ok).toBe(true);
  });
});

describe('importRows y readBrowserHints', () => {
  it('convierte bytes a GiB redondeando hacia abajo y usa el volumen elegido', () => {
    expect(bytesToGiB(34359738368)).toBe(32);
    expect(bytesToGiB(17072324608)).toBe(15.89);
    const rows = Object.fromEntries(importRows(parse(DIAGNOSTIC).diagnostic, 1).map((row) => [row.key, row]));
    expect(rows.cpuCores.value).toBe(8);
    expect(rows.ramGiB.value).toBe(32);
    expect(rows.storageGiB).toMatchObject({ value: 1024, label: 'Espacio libre (Volume 2)' });
    expect(rows.os.value).toBe('windows');
    expect(rows.architecture.value).toBe('amd64');
    expect(Object.fromEntries(importRows(parse(DIAGNOSTIC).diagnostic).map((r) => [r.key, r])).storageGiB.value).toBeUndefined();
  });

  it('lo desconocido o fuera de rango no rellena nada; hilos lógicos no sustituyen a núcleos físicos', () => {
    const diagnostic = parse({ ...DIAGNOSTIC, architecture: 'unknown', os: 'unknown', cpu: { logicalThreads: 16 }, ramBytes: 8192 * GIB, volumes: [{ label: 'Volume 1', freeBytes: GIB / 2, sizeBytes: GIB }] }).diagnostic;
    const rows = Object.fromEntries(importRows(diagnostic, 0).map((row) => [row.key, row]));
    for (const key of ['cpuCores', 'ramGiB', 'storageGiB', 'os', 'architecture']) expect(rows[key].value, key).toBeUndefined();
    expect(rows.cpuCores.note).toMatch(/no equivalen a núcleos físicos/);
    expect(rows.ramGiB.error).toMatch(/fuera del rango/i);
    expect(rows.storageGiB.error).toMatch(/fuera del rango/i);
  });

  it('el rango se comprueba con el valor exacto, antes de redondear: máximo exacto sí, +1 byte no', () => {
    const rowsFor = (patch) => Object.fromEntries(importRows(parse({ ...DIAGNOSTIC, ...patch }).diagnostic, 0).map((row) => [row.key, row]));
    const volume = (freeBytes) => ({ volumes: [{ label: 'Volume 1', freeBytes, sizeBytes: freeBytes + GIB }] });

    expect(rowsFor({ ramBytes: 4096 * GIB }).ramGiB).toMatchObject({ value: 4096 });
    expect(rowsFor(volume(100000 * GIB)).storageGiB).toMatchObject({ value: 100000 });
    for (const ram of [4096 * GIB + 1, 4096 * GIB + Math.floor(0.009 * GIB)]) {
      const row = rowsFor({ ramBytes: ram }).ramGiB;
      expect(row.value, String(ram)).toBeUndefined();
      expect(row.error).toMatch(/fuera del rango/i);
    }
    for (const free of [100000 * GIB + 1, 100000 * GIB + Math.floor(0.009 * GIB)]) {
      const row = rowsFor(volume(free)).storageGiB;
      expect(row.value, String(free)).toBeUndefined();
      expect(row.error).toMatch(/fuera del rango/i);
    }
    // Mínimos: justo en el límite sí; por debajo, aunque redondeado parezca válido, no.
    expect(rowsFor({ ramBytes: GIB / 2 }).ramGiB).toMatchObject({ value: 0.5 });
    expect(rowsFor({ ramBytes: GIB / 2 - 1 }).ramGiB.value).toBeUndefined();
    expect(rowsFor(volume(GIB)).storageGiB).toMatchObject({ value: 1 });
    expect(rowsFor(volume(GIB - 1)).storageGiB.value).toBeUndefined();
  });

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

  it('importa con vista previa y volumen elegido, marca el origen y guarda solo al pulsar Guardar', async () => {
    const saveProfileMock = vi.fn(() => Promise.resolve(EMPTY_DOC));
    const { user } = open(client({ saveProfile: saveProfileMock }));
    const input = await screen.findByLabelText('Archivo de diagnóstico (.json)');
    expect(screen.getByRole('link', { name: /recopilador para Windows/ })).toHaveAttribute('href', '/downloads/nomoresaas-diagnostico.mjs');

    await user.upload(input, fileOf(json(DIAGNOSTIC)));
    const preview = await screen.findByRole('table', { name: 'Vista previa del diagnóstico' });
    expect(within(preview).getByText('32 GiB')).toBeInTheDocument();
    expect(screen.getByText(/Ficticio CPU 8-Core/)).toBeInTheDocument();
    // Sin destino elegido no se puede aplicar.
    expect(screen.getByRole('button', { name: 'Aplicar al formulario' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Otro equipo/ }));
    await user.click(screen.getByRole('radio', { name: /Volume 2/ }));
    await user.click(screen.getByRole('button', { name: 'Aplicar al formulario' }));
    expect(saveProfileMock).not.toHaveBeenCalled();
    expect(screen.getByText(/aún no se ha guardado nada/)).toBeInTheDocument();

    expect(screen.getByLabelText('Núcleos de CPU')).toHaveValue(8);
    expect(screen.getByLabelText('RAM (GiB)')).toHaveValue(32);
    expect(screen.getByLabelText('Espacio libre en disco (GiB)')).toHaveValue(1024);
    expect(screen.getByLabelText('Sistema operativo del servidor')).toHaveValue('windows');
    expect(screen.getByLabelText('RAM (GiB)')).toHaveAccessibleDescription(/Importado del diagnóstico/);

    await fillUsage(user);
    await user.click(screen.getByRole('button', { name: 'Guardar equipo' }));
    expect(saveProfileMock).toHaveBeenCalledWith(
      P1,
      { cpuCores: 8, ramGiB: 32, storageGiB: 1024, os: 'windows', architecture: 'amd64', storageKind: 'unknown', users: 3, dataGiB: 100, access: 'local', hasDomain: false, cpuFeaturesKnown: false },
      { csrfToken: 'a1', provenance: { target: 'other-device', fields: { cpuCores: IMPORTED, ramGiB: IMPORTED, storageGiB: IMPORTED, os: IMPORTED, architecture: IMPORTED } } },
    );
  });

  it('editar a mano un campo importado lo vuelve manual', async () => {
    const saveProfileMock = vi.fn(() => Promise.resolve(EMPTY_DOC));
    const { user } = open(client({ saveProfile: saveProfileMock }));
    await user.upload(await screen.findByLabelText('Archivo de diagnóstico (.json)'), fileOf(json({ ...DIAGNOSTIC, volumes: [DIAGNOSTIC.volumes[0]] })));
    await user.click(screen.getByRole('radio', { name: /Este equipo/ }));
    await user.click(await screen.findByRole('button', { name: 'Aplicar al formulario' }));
    expect(screen.getByLabelText('Espacio libre en disco (GiB)')).toHaveValue(200);
    const ram = screen.getByLabelText('RAM (GiB)');
    await user.clear(ram);
    await user.type(ram, '30');
    expect(ram).not.toHaveAccessibleDescription(/Importado/);
    await fillUsage(user);
    await user.click(screen.getByRole('button', { name: 'Guardar equipo' }));
    const { provenance } = saveProfileMock.mock.calls[0][2];
    expect(provenance.target).toBe('this-device');
    expect(Object.keys(provenance.fields)).toEqual(['cpuCores', 'storageGiB', 'os', 'architecture']);
  });

  it('archivo inválido o excesivo: error claro, el formulario no cambia y no se envía nada', async () => {
    const saveProfileMock = vi.fn();
    const { user } = open(client({ getWorkflow: vi.fn(() => Promise.resolve({ ...EMPTY_DOC, profile: PROFILE })), saveProfile: saveProfileMock }));
    const input = await screen.findByLabelText('Archivo de diagnóstico (.json)');
    await user.click(screen.getByRole('radio', { name: /Otro equipo/ }));
    await user.upload(input, fileOf(json({ ...DIAGNOSTIC, hostname: 'PC-DE-ANA' })));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El formulario no ha cambiado');
    expect(alert).not.toHaveTextContent('PC-DE-ANA');
    await user.upload(input, fileOf('x'.repeat(MAX_DIAGNOSTIC_BYTES + 1)));
    expect(await screen.findByText(/supera 64 KiB/)).toBeInTheDocument();
    expect(screen.getByLabelText('RAM (GiB)')).toHaveValue(8);
    expect(screen.queryByRole('button', { name: 'Aplicar al formulario' })).not.toBeInTheDocument();
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

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

  it('RAM por encima del máximo por menos de 0,01 GiB: error en la vista previa, no se aplica ni se guarda', async () => {
    const saveProfileMock = vi.fn();
    const { user } = open(client({ getWorkflow: vi.fn(() => Promise.resolve({ ...EMPTY_DOC, profile: PROFILE })), saveProfile: saveProfileMock }));
    await user.click(await screen.findByRole('radio', { name: /Otro equipo/ }));
    await user.upload(screen.getByLabelText('Archivo de diagnóstico (.json)'), fileOf(json({ ...DIAGNOSTIC, ramBytes: 4096 * GIB + 1, volumes: [DIAGNOSTIC.volumes[0]] })));
    const preview = await screen.findByRole('table', { name: 'Vista previa del diagnóstico' });
    expect(within(preview).getByText(/fuera del rango/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aplicar al formulario' }));
    expect(screen.getByLabelText('RAM (GiB)')).toHaveValue(8);
    expect(screen.getByLabelText('RAM (GiB)')).not.toHaveAccessibleDescription(/Importado/);
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  describe('lecturas de archivo fuera de orden', () => {
    // File.text controlado: cada archivo se resuelve cuando la prueba lo decide.
    function slowFile(text, name) {
      const file = fileOf(text, name);
      let release;
      const pending = new Promise((resolve) => {
        release = () => resolve(text);
      });
      file.text = () => pending;
      return { file, release };
    }

    it('A lento y B rápido: solo B llena la vista previa y se aplica', async () => {
      const { user } = open(client());
      await user.click(await screen.findByRole('radio', { name: /Otro equipo/ }));
      const input = screen.getByLabelText('Archivo de diagnóstico (.json)');
      const a = slowFile(json({ ...DIAGNOSTIC, ramBytes: 16 * GIB, volumes: [DIAGNOSTIC.volumes[0]] }), 'a.json');
      const b = slowFile(json({ ...DIAGNOSTIC, ramBytes: 64 * GIB, volumes: [DIAGNOSTIC.volumes[0]] }), 'b.json');
      await user.upload(input, a.file);
      expect(screen.getByText('Leyendo el archivo…')).toBeInTheDocument();
      await user.upload(input, b.file);
      b.release();
      expect(await screen.findByText('64 GiB')).toBeInTheDocument();
      a.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByText('16 GiB')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Aplicar al formulario' }));
      expect(screen.getByLabelText('RAM (GiB)')).toHaveValue(64);
    });

    it('A lento y B inválido: se muestra el error de B y A nunca aparece ni se puede aplicar', async () => {
      const { user } = open(client());
      await user.click(await screen.findByRole('radio', { name: /Otro equipo/ }));
      const input = screen.getByLabelText('Archivo de diagnóstico (.json)');
      const a = slowFile(json({ ...DIAGNOSTIC, volumes: [DIAGNOSTIC.volumes[0]] }), 'a.json');
      await user.upload(input, a.file);
      await user.upload(input, fileOf('no es json', 'b.json'));
      expect(await screen.findByText('El archivo no es JSON válido.')).toBeInTheDocument();
      a.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.getByText('El archivo no es JSON válido.')).toBeInTheDocument();
      expect(screen.queryByRole('table', { name: 'Vista previa del diagnóstico' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Aplicar al formulario' })).not.toBeInTheDocument();
    });

    it('A lento y luego se cancela la selección: la lectura tardía se descarta', async () => {
      const { user } = open(client());
      await user.click(await screen.findByRole('radio', { name: /Otro equipo/ }));
      const input = screen.getByLabelText('Archivo de diagnóstico (.json)');
      const a = slowFile(json({ ...DIAGNOSTIC, volumes: [DIAGNOSTIC.volumes[0]] }), 'a.json');
      await user.upload(input, a.file);
      await user.upload(input, []);
      expect(screen.queryByText('Leyendo el archivo…')).not.toBeInTheDocument();
      a.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByRole('table', { name: 'Vista previa del diagnóstico' })).not.toBeInTheDocument();
    });

    it('vista previa anterior desaparece al elegir otro archivo mientras se lee', async () => {
      const { user } = open(client());
      await user.click(await screen.findByRole('radio', { name: /Otro equipo/ }));
      const input = screen.getByLabelText('Archivo de diagnóstico (.json)');
      await user.upload(input, fileOf(json({ ...DIAGNOSTIC, volumes: [DIAGNOSTIC.volumes[0]] }), 'a.json'));
      expect(await screen.findByRole('table', { name: 'Vista previa del diagnóstico' })).toBeInTheDocument();
      const b = slowFile(json(DIAGNOSTIC), 'b.json');
      await user.upload(input, b.file);
      expect(screen.queryByRole('table', { name: 'Vista previa del diagnóstico' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Aplicar al formulario' })).not.toBeInTheDocument();
      b.release();
      expect(await screen.findByRole('table', { name: 'Vista previa del diagnóstico' })).toBeInTheDocument();
    });

    it('desmontar (salir de Equipo) durante la lectura no aplica nada al volver', async () => {
      const errors = vi.spyOn(console, 'error');
      const { user } = open(client());
      await user.click(await screen.findByRole('radio', { name: /Otro equipo/ }));
      const a = slowFile(json({ ...DIAGNOSTIC, volumes: [DIAGNOSTIC.volumes[0]] }), 'a.json');
      await user.upload(screen.getByLabelText('Archivo de diagnóstico (.json)'), a.file);
      await user.click(screen.getByRole('link', { name: 'Evaluación' }));
      a.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await user.click(screen.getByRole('link', { name: 'Equipo' }));
      expect(screen.queryByRole('table', { name: 'Vista previa del diagnóstico' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('RAM (GiB)')).toHaveValue(null);
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });

  it('volúmenes con la misma etiqueta: se listan todos sin claves React duplicadas', async () => {
    const errors = vi.spyOn(console, 'error');
    const { user } = open(client());
    await user.click(await screen.findByRole('radio', { name: /Otro equipo/ }));
    const twin = { label: 'Volume 1', freeBytes: 2 * GIB, sizeBytes: 4 * GIB };
    await user.upload(screen.getByLabelText('Archivo de diagnóstico (.json)'), fileOf(json({ ...DIAGNOSTIC, volumes: [DIAGNOSTIC.volumes[0], twin] })));
    const radios = await screen.findAllByRole('radio', { name: /^Volume 1/ });
    expect(radios).toHaveLength(2);
    await user.click(radios[1]);
    expect(screen.getByText(/^2 GiB/)).toBeInTheDocument();
    expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
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
