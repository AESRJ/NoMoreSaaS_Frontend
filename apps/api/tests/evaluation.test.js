import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG_PATH, loadCatalog } from '../src/catalog.js';
import { RulesValidationError, evaluate, loadRules, validateRules } from '../src/evaluation.js';

// Reglas y catálogo publicados reales: los números esperados salen de
// data/requirements.json (presupuestos editoriales de data-model 004).
const rules = loadRules();
const catalog = await loadCatalog(DEFAULT_CATALOG_PATH, { requireSeedCoverage: true });
const catalogNames = new Map(catalog.alternatives.map((a) => [a.id, a.name]));

const BASE = Object.freeze({
  cpuCores: 8,
  ramGiB: 16,
  storageGiB: 500,
  os: 'linux',
  architecture: 'amd64',
  storageKind: 'ssd',
  users: 3,
  dataGiB: 120,
  access: 'local',
  hasDomain: false,
  cpuFeaturesKnown: false,
});

const run = (alternativeIds, overrides = {}) => evaluate({ profile: { ...BASE, ...overrides }, alternativeIds, catalogNames, rules });
const codes = (evaluation) => evaluation.warnings.map((w) => w.code);
const GUARANTEE = /garantizad[oa]|compatible al 100|funcionar[aá] seguro/i;

describe('evaluate', () => {
  it('sin perfil devuelve null (estado vacío)', () => {
    expect(evaluate({ profile: null, alternativeIds: ['nextcloud'], catalogNames, rules })).toBeNull();
  });

  it('cálculo reproducible con ecuación, unidades, margen y fuentes separadas', () => {
    const a = run(['nextcloud', 'outline']);
    const b = run(['nextcloud', 'outline']);
    expect(a).toEqual(b);
    expect(a.rulesVersion).toBe('2026-11-22.2');
    expect(a.totals).toMatchObject({
      loadFactor: 1,
      ramGiB: { base: 4, required: 5, available: 16 }, // (2 + 2) × 1 × 1,25
      cpuCores: { base: 4, required: 4, available: 8 },
      diskGiB: { base: 8, data: 150, required: 158, available: 500 }, // 4 + 4 + 120 × 1,25
    });
    expect(a.totals.equations.ram).toBe('RAM requerida = Σ RAM base (4 GiB) × factor de carga (1) × (1 + margen 25 %) = 5 GiB');
    expect(a.totals.equations.disk).toContain('= 158 GiB');
    const [nextcloud, outline] = a.items;
    expect(nextcloud).toMatchObject({ alternativeId: 'nextcloud', status: 'estimated', budget: { ramGiB: 2, cpuCores: 2, diskGiB: 4 } });
    expect(nextcloud.official.sources[0]).toMatchObject({ kind: 'official', checkedAt: '2026-11-20' });
    expect(outline.official.summary).toMatch(/512 MB/);
    expect(a.editorialSource).toMatchObject({ kind: 'editorial' });
    expect(a.editorialSource.note).toMatch(/no es un mínimo oficial/i);
    // Outline sin dominio ni proveedor de autenticación comprobado: pendiente, no viable.
    expect(a.status).toBe('pending');
    expect(codes(a)).toEqual(['domain-required', 'auth-provider-required', 'license-source-available', 'estimate-orientative']);
  });

  it('viable solo sin bloqueos ni pendientes, y aun así declara que no es garantía', () => {
    const e = run(['nextcloud', 'wireguard']);
    expect(e.status).toBe('viable');
    expect(e.warnings).toEqual([expect.objectContaining({ code: 'estimate-orientative', severity: 'info' })]);
    expect(e.warnings[0].text).toMatch(/no .*garantiza/i);
    expect(JSON.stringify(e)).not.toMatch(GUARANTEE);
  });

  it('insuficiente: RAM, CPU y disco primero, con motivos; y las condiciones pendientes siguen visibles', () => {
    const e = run(['immich', 'matrix-synapse'], { ramGiB: 4, cpuCores: 2, storageGiB: 20, dataGiB: 100 });
    expect(e.status).toBe('insufficient');
    expect(e.totals.ramGiB.required).toBe(12.5); // (8 + 2) × 1,25
    expect(e.totals.cpuCores.required).toBe(6);
    expect(e.totals.diskGiB.required).toBe(139); // 10 + 4 + 100 × 1,25
    expect(codes(e).slice(0, 3)).toEqual(['ram-insufficient', 'cpu-insufficient', 'disk-insufficient']);
    expect(e.warnings[0].text).toBe('RAM declarada 4 GiB < 12,5 GiB estimados.');
    expect(codes(e)).toContain('cpu-features-unknown'); // Immich ML en amd64 sin x86-64-v2 comprobado
    expect(JSON.stringify(e)).not.toMatch(GUARANTEE);
  });

  it('datos desconocidos: pendiente con motivos, nunca viable', () => {
    const e = run(['nextcloud', 'wireguard'], { os: 'unknown', architecture: 'unknown', storageKind: 'unknown' });
    expect(e.status).toBe('pending');
    expect(codes(e)).toEqual(expect.arrayContaining(['os-unknown', 'architecture-unknown', 'storage-unknown']));
    expect(e.warnings.every((w) => typeof w.text === 'string' && w.text.length > 10)).toBe(true);
  });

  it('referencia retirada: ítem sin presupuesto, aviso para sustituirla y total sin inventar recursos', () => {
    const e = run(['gitea', 'wireguard']);
    expect(e.items[0]).toEqual({ alternativeId: 'gitea', name: null, available: false, status: 'retired', budget: null, scaled: null, official: null });
    expect(e.status).toBe('pending');
    expect(e.warnings.find((w) => w.code === 'retired-alternative')).toMatchObject({ alternativeId: 'gitea', severity: 'pending' });
    expect(e.totals.ramGiB.base).toBe(0.25);
  });

  it('carga alta: factor techo(users/10) en RAM/CPU, datos una sola vez y aviso de estimación no validada', () => {
    const e = run(['nextcloud'], { users: 25, ramGiB: 64, cpuCores: 32 });
    expect(e.totals.loadFactor).toBe(3);
    expect(e.totals.ramGiB.required).toBe(7.5); // 2 × 3 × 1,25
    expect(e.totals.cpuCores.required).toBe(6);
    expect(e.totals.diskGiB.required).toBe(154); // 4 + 120 × 1,25, sin multiplicar
    expect(e.items[0].scaled).toEqual({ ramGiB: 6, cpuCores: 6 });
    expect(e.warnings.find((w) => w.code === 'load-unvalidated')).toMatchObject({ severity: 'info' });
    expect(e.totals.equations.loadFactor).toBe('factor de carga = techo(25 usuarios / 10) = 3');
  });

  it('requisitos por plataforma: Outline no funciona en Windows; Synapse/Immich quedan pendientes', () => {
    const outline = run(['outline'], { os: 'windows', hasDomain: true });
    expect(outline.status).toBe('insufficient');
    expect(outline.warnings[0]).toMatchObject({ code: 'platform-unsupported', severity: 'blocking', alternativeId: 'outline' });
    expect(outline.warnings[0].source).toMatch(/^https:\/\/docs\.getoutline\.com/);
    const others = run(['matrix-synapse', 'immich'], { os: 'windows', cpuFeaturesKnown: true });
    expect(others.status).toBe('pending');
    expect(codes(others)).toEqual(expect.arrayContaining(['platform-unsupported-native', 'platform-discouraged']));
    expect(run(['immich'], { storageKind: 'network', cpuFeaturesKnown: true }).warnings[0].code).toBe('storage-network-db');
  });

  it('Immich en macOS con recursos amplios queda pendiente por plataforma desaconsejada, sin afirmar que no funciona', () => {
    const e = run(['immich'], { os: 'macos', architecture: 'amd64', cpuFeaturesKnown: true, ramGiB: 64, cpuCores: 16 });
    expect(e.status).toBe('pending');
    const platform = e.warnings.find((w) => w.code === 'platform-discouraged');
    expect(platform).toMatchObject({ severity: 'pending', alternativeId: 'immich', source: 'https://docs.immich.app/install/requirements/' });
    expect(platform.text).toMatch(/Docker Desktop/);
    expect(platform.text).toMatch(/desaconseja/);
    expect(platform.text).not.toMatch(/no funciona/i);
  });

  it('acceso desde internet: dominio/HTTPS y UDP de WireGuard sin comprobar quedan pendientes', () => {
    const e = run(['nextcloud', 'wireguard'], { access: 'internet' });
    expect(e.status).toBe('pending');
    expect(codes(e)).toEqual(expect.arrayContaining(['https-domain-missing', 'network-udp-unverified']));
    expect(codes(run(['nextcloud'], { access: 'internet', hasDomain: true }))).not.toContain('https-domain-missing');
  });
});

describe('certeza de los datos (007, ProfileProvenance.fields)', () => {
  const browser = { source: 'browser', certainty: 'approximate', capturedAt: '2026-11-22T09:00:00.000Z' };
  const imported = { source: 'import', certainty: 'reported', capturedAt: '2026-11-21T09:00:00.000Z' };
  const withProv = (alternativeIds, provenance, overrides = {}) =>
    evaluate({ profile: { ...BASE, ...overrides }, alternativeIds, catalogNames, rules, provenance });
  const resource = (e, key) => e.summary.resources.find((r) => r.key === key);

  it('resumen de tres recursos con origen y una siguiente acción; sin procedencia todo es declarado', () => {
    const e = run(['nextcloud', 'wireguard']);
    expect(e.summary.resources.map((r) => [r.key, r.fits, r.source, r.certainty])).toEqual([
      ['cpu', true, 'manual', 'declared'],
      ['ram', true, 'manual', 'declared'],
      ['disk', true, 'manual', 'declared'],
    ]);
    expect(resource(e, 'ram')).toMatchObject({ required: e.totals.ramGiB.required, available: 16, unit: 'GiB' });
    expect(e.summary.nextAction).toMatchObject({ code: 'start-plan', target: 'plan' });
    // Procedencia explícitamente manual = mismo resultado que sin procedencia.
    expect(withProv(['nextcloud', 'wireguard'], { ramGiB: { source: 'manual', certainty: 'declared', capturedAt: null } })).toEqual(e);
  });

  it('CPU/RAM aproximadas que caben: nunca viable, pendiente con motivo y acción de confirmar', () => {
    const e = withProv(['nextcloud', 'wireguard'], { cpuCores: browser, ramGiB: browser });
    expect(e.status).toBe('pending');
    expect(e.warnings[0]).toMatchObject({ code: 'approximate-data', severity: 'pending', alternativeId: null });
    expect(e.warnings[0].text).toMatch(/CPU y RAM son aproximadas/);
    expect(resource(e, 'ram')).toMatchObject({ fits: true, source: 'browser', certainty: 'approximate' });
    expect(e.summary.nextAction).toMatchObject({ code: 'confirm-approximate', target: 'equipo' });
    // Los totales numéricos no cambian por la certeza.
    expect(e.totals).toEqual(run(['nextcloud', 'wireguard']).totals);
  });

  it('RAM aproximada insuficiente: pendiente de confirmar, no bloqueo afirmado; la declarada sí bloquea', () => {
    const approx = withProv(['immich'], { ramGiB: browser }, { ramGiB: 4, cpuFeaturesKnown: true });
    expect(codes(approx)).toContain('ram-unconfirmed');
    expect(codes(approx)).not.toContain('ram-insufficient');
    expect(approx.status).toBe('pending');
    expect(approx.warnings.find((w) => w.code === 'ram-unconfirmed').text).toMatch(/aproximado por el navegador 4 GiB < .* confírmalo/);
    expect(resource(approx, 'ram')).toMatchObject({ fits: false, certainty: 'approximate' });

    const declared = run(['immich'], { ramGiB: 4, cpuFeaturesKnown: true });
    expect(declared.status).toBe('insufficient');
    expect(declared.summary.nextAction).toMatchObject({ code: 'increase-resources', target: 'equipo' });
    expect(declared.summary.nextAction.text).toMatch(/Amplía RAM/);
  });

  it('importado (informado) cuenta como dato real: puede ser viable o insuficiente, sin falsas reservas', () => {
    const ok = withProv(['nextcloud', 'wireguard'], { cpuCores: imported, ramGiB: imported, storageGiB: imported });
    expect(ok.status).toBe('viable');
    expect(resource(ok, 'disk')).toMatchObject({ source: 'import', certainty: 'reported' });
    const short = withProv(['immich'], { ramGiB: imported }, { ramGiB: 4, cpuFeaturesKnown: true });
    expect(short.status).toBe('insufficient');
    expect(short.warnings[0]).toMatchObject({ code: 'ram-insufficient', severity: 'blocking' });
    expect(short.warnings[0].text).toMatch(/^RAM informado por el diagnóstico 4 GiB </);
  });

  it('siguiente acción: alternativas retiradas → proyecto; datos desconocidos → equipo; otras condiciones → plan', () => {
    expect(run(['nextcloud', 'ya-no-existe']).summary.nextAction).toMatchObject({ code: 'replace-alternatives', target: 'proyecto' });
    expect(run(['nextcloud'], { os: 'unknown' }).summary.nextAction).toMatchObject({ code: 'complete-profile', target: 'equipo' });
    expect(run(['nextcloud', 'wireguard'], { access: 'internet' }).summary.nextAction).toMatchObject({ code: 'resolve-pending', target: 'plan' });
  });

  it('el aviso aproximado llega a las condiciones pendientes de cada paso del plan', async () => {
    const { buildPlan } = await import('../src/plan.js');
    const profile = { ...BASE };
    const evaluation = withProv(['nextcloud'], { ramGiB: browser });
    const plan = buildPlan({ projectId: 'p', projectName: 'P', alternativeIds: ['nextcloud'], profile, evaluation, catalogNames });
    expect(plan.blocked).toBe(false);
    expect(plan.steps.every((s) => s.pending.some((p) => p.code === 'approximate-data'))).toBe(true);
    expect(plan.rulesVersion).toBe('2026-11-22.2');
  });
});

describe('reglas versionadas', () => {
  it('cubren las cinco alternativas publicadas con fuentes oficiales HTTPS fechadas', () => {
    for (const alt of catalog.alternatives) {
      const rule = rules.alternatives[alt.id];
      expect(rule, alt.id).toBeDefined();
      expect(rule.official.sources.every((s) => s.kind === 'official' && s.url.startsWith('https://'))).toBe(true);
    }
    expect(Object.isFrozen(rules)).toBe(true);
  });

  it('validateRules rechaza presupuestos ausentes y fuentes no oficiales', () => {
    const bad = structuredClone(rules);
    delete bad.alternatives.nextcloud.budget;
    bad.alternatives.immich.official.sources[0].kind = 'editorial';
    try {
      validateRules(bad);
      throw new Error('se esperaba error');
    } catch (error) {
      expect(error).toBeInstanceOf(RulesValidationError);
      expect(error.problems).toEqual(
        expect.arrayContaining(['alternatives.nextcloud.budget.ramGiB: número positivo', 'alternatives.immich.official.sources[0].kind: las fuentes de requisitos deben ser oficiales']),
      );
    }
  });
});
