// Plan guiado por servicio y etapa (entrega 004, data-model Plan.*).
// Determinista a partir de proyecto, selección, perfil, evaluación y
// plantillas versionadas. Los prompts son texto para copiar: sin claves,
// sin ejecución remota y sin llamadas a IA externa.
import { createHash } from 'node:crypto';
import { PROMPT_CONSTRAINTS, STAGES, STAGE_LABELS, STEP_BLOCKS, TEMPLATES, TEMPLATES_VERSION } from './plan-templates.js';

export { STEP_BLOCKS, TEMPLATES_VERSION };

const OS_LABELS = { linux: 'Linux', windows: 'Windows', macos: 'macOS', unknown: 'desconocido' };
const STORAGE_LABELS = { ssd: 'SSD', hdd: 'HDD', network: 'almacenamiento de red', unknown: 'tipo desconocido' };
const STATUS_LABELS = { viable: 'cabe en el presupuesto editorial', pending: 'condiciones pendientes', insufficient: 'recursos o plataforma insuficientes' };
const ORIGIN_LABELS = {
  declared: 'declarado a mano',
  reported: 'importado del diagnóstico',
  approximate: 'aproximado por el navegador, pendiente de confirmar',
};

const fmt = (n) => String(n).replace('.', ',');

/** IDs de paso estables: `<alternativa>.<etapa>`. */
export const stepId = (alternativeId, stage) => `${alternativeId}.${stage}`;

/**
 * Hash estable de lo que define el plan: proyecto, alternativas ordenadas,
 * perfil normalizado y su revisión, versión de reglas y de plantillas. Nombre
 * y descripción del proyecto no intervienen. Sin secretos.
 */
export function planFingerprint({ projectId, alternativeIds, profile, rulesVersion }) {
  const normalized = Object.fromEntries(
    Object.keys(profile)
      .filter((key) => key !== 'projectId')
      .sort()
      .map((key) => [key, profile[key]]),
  );
  const input = JSON.stringify({
    projectId,
    alternativeIds: [...alternativeIds].sort(),
    profile: normalized,
    rulesVersion,
    templatesVersion: TEMPLATES_VERSION,
  });
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function profileLine(p) {
  return [
    `${p.cpuCores} núcleos`,
    `${fmt(p.ramGiB)} GiB de RAM`,
    `${fmt(p.storageGiB)} GiB libres (${STORAGE_LABELS[p.storageKind]})`,
    `sistema ${OS_LABELS[p.os]}`,
    `arquitectura ${p.architecture === 'unknown' ? 'desconocida' : p.architecture}`,
    `${p.users} ${p.users === 1 ? 'usuario' : 'usuarios'}`,
    `${fmt(p.dataGiB)} GiB de datos previstos`,
    p.access === 'internet' ? 'acceso desde internet' : 'solo red local',
    p.hasDomain ? 'con dominio propio' : 'sin dominio propio',
    p.cpuFeaturesKnown ? 'compatibilidad x86-64-v2 comprobada' : 'compatibilidad x86-64-v2 no comprobada',
  ].join('; ');
}

const bullets = (lines) => lines.map((line) => `- ${line}`).join('\n');

/** Origen de CPU/RAM/disco según la certeza GUARDADA (resumen de la evaluación 007). */
function originLine(evaluation) {
  const resources = evaluation.summary?.resources;
  if (!Array.isArray(resources) || !resources.length) return null;
  return resources.map((r) => `${r.label} ${ORIGIN_LABELS[r.certainty] ?? ORIGIN_LABELS.declared}`).join('; ');
}

/**
 * Prompt copiable con los bloques de FR-007: objetivo, contexto relevante,
 * antes de empezar, acciones, seguridad, cómo comprobar y cómo volver atrás.
 * Solo datos normalizados del perfil (números y enumerados), nunca cadenas
 * importadas, rutas ni secretos.
 */
function buildPrompt({ projectName, altName, otherNames, stage, template, profile, evaluation, pending, fingerprint }) {
  const origin = originLine(evaluation);
  const context = [
    `Proyecto NoMoreSaaS «${projectName}» (plan ${fingerprint.slice(0, 12)}, reglas ${evaluation.rulesVersion}, plantillas ${TEMPLATES_VERSION}).`,
    otherNames.length ? `Otras alternativas del proyecto: ${otherNames.join(', ')}.` : 'Es la única alternativa del proyecto.',
    `Equipo guardado: ${profileLine(profile)}.`,
    ...(origin ? [`Origen de los datos: ${origin}.`] : []),
    `Estimación orientativa: ${STATUS_LABELS[evaluation.status]}; RAM estimada ${fmt(evaluation.totals.ramGiB.required)} GiB, ${fmt(evaluation.totals.cpuCores.required)} núcleos, ${fmt(evaluation.totals.diskGiB.required)} GiB de disco. No es una garantía.`,
  ];
  const lines = [
    `Objetivo: ${STAGE_LABELS[stage]} de ${altName} — ${template.title}. ${template.explanation}`,
    '',
    'Contexto relevante:',
    bullets(context),
    '',
    'Condiciones pendientes (resuélvelas o pregúntame antes de seguir):',
    pending.length ? bullets(pending.map((w) => w.text)) : '- Ninguna declarada; confirma igualmente los requisitos de la versión que instales.',
  ];
  for (const block of STEP_BLOCKS) {
    lines.push('', `${block.label}:`, bullets(template[block.key]));
  }
  lines.push('', 'Reglas para tu respuesta:', bullets(PROMPT_CONSTRAINTS), '', 'Fuentes oficiales:', bullets(template.sources.map((s) => `${s.label}: ${s.url}`)));
  return lines.join('\n');
}

/**
 * @returns {null | { fingerprint, rulesVersion, templatesVersion, blocked, blockedReasons, steps }}
 *   null sin perfil (estado vacío; no hay plan apto).
 */
export function buildPlan({ projectId, projectName, alternativeIds, profile, evaluation, catalogNames }) {
  if (!profile || !evaluation) return null;
  const fingerprint = planFingerprint({ projectId, alternativeIds, profile, rulesVersion: evaluation.rulesVersion });
  const blockedReasons = evaluation.warnings
    .filter((w) => w.severity === 'blocking' || w.code === 'retired-alternative' || w.code === 'requirements-unknown')
    .map((w) => ({ code: w.code, alternativeId: w.alternativeId, text: w.text }));

  const steps = [];
  for (const alternativeId of alternativeIds) {
    const altName = catalogNames.get(alternativeId);
    const templates = Object.hasOwn(TEMPLATES, alternativeId) ? TEMPLATES[alternativeId] : null;
    if (!altName || !templates) {
      if (altName && !blockedReasons.some((r) => r.alternativeId === alternativeId)) {
        blockedReasons.push({ code: 'templates-missing', alternativeId, text: `No hay plantillas de plan para ${altName}.` });
      }
      continue;
    }
    const pending = evaluation.warnings.filter(
      (w) => w.severity !== 'info' && (w.alternativeId === alternativeId || w.alternativeId === null),
    );
    const otherNames = alternativeIds.filter((id) => id !== alternativeId).map((id) => catalogNames.get(id) ?? `${id} (retirada)`);
    for (const stage of STAGES) {
      const template = templates[stage];
      steps.push({
        id: stepId(alternativeId, stage),
        alternativeId,
        alternativeName: altName,
        stage,
        stageLabel: STAGE_LABELS[stage],
        title: template.title,
        explanation: template.explanation,
        prechecks: [...template.prechecks],
        tasks: [...template.tasks],
        security: [...template.security],
        validation: [...template.validation],
        rollback: [...template.rollback],
        sources: template.sources.map((s) => ({ ...s })),
        pending: pending.map((w) => ({ code: w.code, text: w.text })),
        prompt: buildPrompt({ projectName, altName, otherNames, stage, template, profile, evaluation, pending, fingerprint }),
      });
    }
  }

  return {
    fingerprint,
    rulesVersion: evaluation.rulesVersion,
    templatesVersion: TEMPLATES_VERSION,
    blocked: blockedReasons.length > 0,
    blockedReasons,
    steps,
  };
}
