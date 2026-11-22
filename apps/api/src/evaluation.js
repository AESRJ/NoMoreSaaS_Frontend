// Evaluación orientativa del equipo frente a la selección de un proyecto
// (entrega 004, data-model Evaluation.*). Determinista: mismas reglas, perfil
// y selección producen el mismo resultado. Se recalcula en cada lectura; no se
// persiste. Nunca declara compatibilidad garantizada: «viable» solo significa
// que el presupuesto editorial cabe y no quedan condiciones pendientes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_RULES_PATH = fileURLToPath(new URL('../data/requirements.json', import.meta.url));

const SEVERITIES = ['blocking', 'pending', 'info'];
const SEVERITY_ORDER = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));

export class RulesValidationError extends Error {
  constructor(problems) {
    super(`Reglas de evaluación inválidas:\n- ${problems.join('\n- ')}`);
    this.name = 'RulesValidationError';
    this.problems = problems;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

function checkRule(problems, path, rule) {
  if (!isObject(rule)) return problems.push(`${path}: debe ser un objeto`);
  if (!SEVERITIES.includes(rule.severity)) problems.push(`${path}.severity: valor no permitido`);
  if (typeof rule.code !== 'string' || !/^[a-z0-9-]+$/.test(rule.code)) problems.push(`${path}.code: inválido`);
  if (typeof rule.text !== 'string' || !rule.text.trim()) problems.push(`${path}.text: obligatorio`);
}

function checkSource(problems, path, source) {
  if (!isObject(source)) return problems.push(`${path}: debe ser un objeto`);
  if (typeof source.url !== 'string' || !/^https:\/\//.test(source.url)) problems.push(`${path}.url: debe ser HTTPS`);
  if (typeof source.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt)) problems.push(`${path}.checkedAt: fecha ISO`);
  if (source.kind !== 'official') problems.push(`${path}.kind: las fuentes de requisitos deben ser oficiales`);
}

/** Valida el dataset de reglas y lo devuelve congelado. */
export function validateRules(data) {
  const problems = [];
  if (!isObject(data)) throw new RulesValidationError(['raíz: debe ser un objeto']);
  if (typeof data.rulesVersion !== 'string' || !data.rulesVersion.trim()) problems.push('rulesVersion: obligatorio');
  if (typeof data.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.checkedAt)) problems.push('checkedAt: fecha ISO');
  if (!positive(data.ramMargin) || data.ramMargin >= 1) problems.push('ramMargin: fracción entre 0 y 1');
  if (!positive(data.dataMargin) || data.dataMargin < 1) problems.push('dataMargin: factor ≥ 1');
  if (!Number.isInteger(data.usersPerLoadStep) || data.usersPerLoadStep < 1) problems.push('usersPerLoadStep: entero ≥ 1');
  if (!isObject(data.editorialSource) || data.editorialSource.kind !== 'editorial' || typeof data.editorialSource.note !== 'string') {
    problems.push('editorialSource: fuente editorial con nota');
  }
  if (!isObject(data.alternatives)) problems.push('alternatives: debe ser un objeto');
  else {
    for (const [id, alt] of Object.entries(data.alternatives)) {
      const path = `alternatives.${id}`;
      if (!isObject(alt)) {
        problems.push(`${path}: debe ser un objeto`);
        continue;
      }
      for (const key of ['ramGiB', 'cpuCores', 'diskGiB']) {
        if (!isObject(alt.budget) || !positive(alt.budget[key])) problems.push(`${path}.budget.${key}: número positivo`);
      }
      if (!isObject(alt.official) || typeof alt.official.summary !== 'string' || !Array.isArray(alt.official.sources) || !alt.official.sources.length) {
        problems.push(`${path}.official: resumen y fuentes oficiales obligatorios`);
      } else {
        alt.official.sources.forEach((s, i) => checkSource(problems, `${path}.official.sources[${i}]`, s));
      }
      for (const group of ['os', 'storage']) {
        if (alt[group] !== undefined) {
          if (!isObject(alt[group])) problems.push(`${path}.${group}: debe ser un objeto`);
          else Object.entries(alt[group]).forEach(([k, rule]) => checkRule(problems, `${path}.${group}.${k}`, rule));
        }
      }
      for (const key of ['internet', 'requiresDomain', 'cpuFeatures']) {
        if (alt[key] !== undefined) checkRule(problems, `${path}.${key}`, alt[key]);
      }
      if (alt.notes !== undefined) {
        if (!Array.isArray(alt.notes)) problems.push(`${path}.notes: debe ser una lista`);
        else alt.notes.forEach((rule, i) => checkRule(problems, `${path}.notes[${i}]`, rule));
      }
      if (typeof alt.webService !== 'boolean') problems.push(`${path}.webService: booleano`);
    }
  }
  if (problems.length) throw new RulesValidationError(problems);
  return deepFreeze(structuredClone(data));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

let cachedDefault;
/** Reglas publicadas (lectura y validación síncronas, una vez por proceso). */
export function loadRules(path = DEFAULT_RULES_PATH) {
  if (path === DEFAULT_RULES_PATH && cachedDefault) return cachedDefault;
  const rules = validateRules(JSON.parse(readFileSync(path, 'utf8')));
  if (path === DEFAULT_RULES_PATH) cachedDefault = rules;
  return rules;
}

/** Redondeo a centésimas, estable para mostrar y comparar. */
export const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => String(round2(n)).replace('.', ',');

function warning(rule, alternativeId = null, source = null) {
  return { code: rule.code, severity: rule.severity, alternativeId, text: rule.text, source };
}

/**
 * @param {{
 *   profile: null | { cpuCores:number, ramGiB:number, storageGiB:number, os:string, architecture:string,
 *     storageKind:string, users:number, dataGiB:number, access:string, hasDomain:boolean, cpuFeaturesKnown:boolean },
 *   alternativeIds: string[],
 *   catalogNames: Map<string, string>,
 *   rules: ReturnType<typeof validateRules>,
 * }} input
 * @returns {null | object} null si no hay perfil.
 */
export function evaluate({ profile, alternativeIds, catalogNames, rules }) {
  if (!profile) return null;
  const loadFactor = profile.users > rules.usersPerLoadStep ? Math.ceil(profile.users / rules.usersPerLoadStep) : 1;
  const warnings = [];
  const items = [];
  let ramBase = 0;
  let cpuBase = 0;
  let diskBase = 0;
  let anyWebService = false;

  for (const id of alternativeIds) {
    const name = catalogNames.get(id) ?? null;
    const rule = Object.hasOwn(rules.alternatives, id) ? rules.alternatives[id] : null;
    if (name === null) {
      items.push({ alternativeId: id, name: null, available: false, status: 'retired', budget: null, scaled: null, official: null });
      warnings.push(warning({
        code: 'retired-alternative',
        severity: 'pending',
        text: `La alternativa «${id}» ya no está en el catálogo. Sustitúyela en el proyecto antes de continuar con el plan.`,
      }, id));
      continue;
    }
    if (!rule) {
      items.push({ alternativeId: id, name, available: true, status: 'unknown', budget: null, scaled: null, official: null });
      warnings.push(warning({
        code: 'requirements-unknown',
        severity: 'pending',
        text: `No hay reglas de requisitos para ${name}; sus recursos no se incluyen en el total.`,
      }, id));
      continue;
    }
    const source = rule.official.sources[0].url;
    const scaled = { ramGiB: round2(rule.budget.ramGiB * loadFactor), cpuCores: round2(rule.budget.cpuCores * loadFactor) };
    ramBase += rule.budget.ramGiB;
    cpuBase += rule.budget.cpuCores;
    diskBase += rule.budget.diskGiB;
    anyWebService ||= rule.webService;
    items.push({
      alternativeId: id,
      name,
      available: true,
      status: 'estimated',
      budget: { ...rule.budget },
      scaled,
      official: { summary: rule.official.summary, sources: rule.official.sources.map((s) => ({ ...s })) },
    });

    if (rule.os && Object.hasOwn(rule.os, profile.os)) warnings.push(warning(rule.os[profile.os], id, source));
    if (rule.storage && Object.hasOwn(rule.storage, profile.storageKind)) warnings.push(warning(rule.storage[profile.storageKind], id, source));
    if (rule.cpuFeatures && profile.architecture === rule.cpuFeatures.architecture && !profile.cpuFeaturesKnown) {
      warnings.push(warning(rule.cpuFeatures, id, source));
    }
    if (rule.internet && profile.access === 'internet') warnings.push(warning(rule.internet, id, source));
    if (rule.requiresDomain && !profile.hasDomain) warnings.push(warning(rule.requiresDomain, id, source));
    (rule.notes ?? []).forEach((note) => warnings.push(warning(note, id, source)));
  }

  // Totales: RAM y CPU escalan por carga; el disco de datos se suma una sola vez.
  const ramRequired = round2(ramBase * loadFactor * (1 + rules.ramMargin));
  const cpuRequired = round2(cpuBase * loadFactor);
  const dataDisk = round2(profile.dataGiB * rules.dataMargin);
  const diskRequired = round2(diskBase + dataDisk);
  const marginPct = round2(rules.ramMargin * 100);
  const totals = {
    loadFactor,
    ramGiB: { base: round2(ramBase), required: ramRequired, available: profile.ramGiB },
    cpuCores: { base: round2(cpuBase), required: cpuRequired, available: profile.cpuCores },
    diskGiB: { base: round2(diskBase), data: dataDisk, required: diskRequired, available: profile.storageGiB },
    equations: {
      loadFactor: profile.users > rules.usersPerLoadStep
        ? `factor de carga = techo(${profile.users} usuarios / ${rules.usersPerLoadStep}) = ${loadFactor}`
        : `factor de carga = 1 (hasta ${rules.usersPerLoadStep} usuarios)`,
      ram: `RAM requerida = Σ RAM base (${fmt(ramBase)} GiB) × factor de carga (${loadFactor}) × (1 + margen ${fmt(marginPct)} %) = ${fmt(ramRequired)} GiB`,
      cpu: `CPU requerida = Σ núcleos base (${fmt(cpuBase)}) × factor de carga (${loadFactor}) = ${fmt(cpuRequired)} núcleos (suma conservadora, sin garantía de concurrencia)`,
      disk: `Disco requerido = Σ disco base (${fmt(diskBase)} GiB) + datos (${fmt(profile.dataGiB)} GiB) × ${fmt(rules.dataMargin)} = ${fmt(diskRequired)} GiB`,
    },
  };

  // Insuficiencias primero (prioritarias), después condiciones del perfil.
  const resource = [];
  if (profile.ramGiB < ramRequired) {
    resource.push(warning({ code: 'ram-insufficient', severity: 'blocking', text: `RAM declarada ${fmt(profile.ramGiB)} GiB < ${fmt(ramRequired)} GiB estimados.` }));
  }
  if (profile.cpuCores < cpuRequired) {
    resource.push(warning({ code: 'cpu-insufficient', severity: 'blocking', text: `Núcleos declarados ${profile.cpuCores} < ${fmt(cpuRequired)} estimados.` }));
  }
  if (profile.storageGiB < diskRequired) {
    resource.push(warning({ code: 'disk-insufficient', severity: 'blocking', text: `Espacio libre declarado ${fmt(profile.storageGiB)} GiB < ${fmt(diskRequired)} GiB estimados.` }));
  }

  const general = [];
  if (profile.os === 'unknown') general.push(warning({ code: 'os-unknown', severity: 'pending', text: 'Sistema operativo desconocido: no se pueden comprobar los requisitos de plataforma.' }));
  if (profile.architecture === 'unknown') general.push(warning({ code: 'architecture-unknown', severity: 'pending', text: 'Arquitectura de CPU desconocida: no se puede comprobar la compatibilidad de imágenes y paquetes.' }));
  if (profile.storageKind === 'unknown') general.push(warning({ code: 'storage-unknown', severity: 'pending', text: 'Tipo de almacenamiento desconocido: no se pueden comprobar los requisitos de disco local.' }));
  if (profile.access === 'internet' && !profile.hasDomain && anyWebService) {
    general.push(warning({ code: 'https-domain-missing', severity: 'pending', text: 'El acceso desde internet a servicios web requiere un dominio y HTTPS; el perfil no declara dominio.' }));
  }
  if (loadFactor > 1) {
    general.push(warning({ code: 'load-unvalidated', severity: 'info', text: `Con ${profile.users} usuarios la estimación escala de forma conservadora (×${loadFactor}) y no está validada para carga alta.` }));
  }

  const all = [...resource, ...general, ...warnings];
  all.push(warning({
    code: 'estimate-orientative',
    severity: 'info',
    text: 'Estimación orientativa con presupuestos editoriales; no es un mínimo oficial ni garantiza que la instalación funcione.',
  }));
  // Orden estable por severidad: bloqueos, pendientes e informativos.
  const ordered = all.map((w, i) => [w, i]).sort((a, b) => SEVERITY_ORDER[a[0].severity] - SEVERITY_ORDER[b[0].severity] || a[1] - b[1]).map(([w]) => w);

  const status = ordered.some((w) => w.severity === 'blocking')
    ? 'insufficient'
    : ordered.some((w) => w.severity === 'pending')
      ? 'pending'
      : 'viable';

  return {
    status,
    rulesVersion: rules.rulesVersion,
    checkedAt: rules.checkedAt,
    editorialSource: { ...rules.editorialSource },
    items,
    totals,
    warnings: ordered,
  };
}
