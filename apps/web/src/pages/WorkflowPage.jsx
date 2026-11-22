import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { AuthRequestError } from '../api/auth.js';
import { useProjectsClient } from '../api/projects.js';
import { ExternalLink } from '../components/ExternalLink.jsx';
import { DateTime, ProjectAlternative, ProjectNotFound, ProjectsError, ProjectsLoading, isMissing } from '../components/ProjectParts.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useOwnedRequest } from '../hooks/useOwnedRequest.js';
import { isStaleWrite, useAuth } from '../store/auth.js';
import { clearProjectDraft, saveProjectDraft, takeProjectDraft } from '../store/projectDraft.js';

// Recorrido privado /proyectos/:id/flujo: Equipo → Evaluación → Plan.
// Todo el contenido (prompts, nombres, avisos) se muestra como texto React.
// El estado vive en memoria y se monta por (usuario, proyecto): otra cuenta
// nunca ve borradores ni respuestas de la anterior.

const VIEWS = [
  { id: 'equipo', label: 'Equipo' },
  { id: 'evaluacion', label: 'Evaluación' },
  { id: 'plan', label: 'Plan' },
];

// Límites de data-model.md 004 (decisiones del prototipo, no mínimos oficiales).
const NUMBER_FIELDS = {
  cpuCores: { label: 'Núcleos de CPU', min: 1, max: 256, integer: true, step: 1 },
  ramGiB: { label: 'RAM (GiB)', min: 0.5, max: 4096, integer: false, step: 0.5 },
  storageGiB: { label: 'Espacio libre en disco (GiB)', min: 1, max: 100000, integer: false, step: 1 },
  users: { label: 'Usuarios previstos', min: 1, max: 10000, integer: true, step: 1 },
  dataGiB: { label: 'Datos previstos (GiB)', min: 0, max: 100000, integer: false, step: 1 },
};
const SELECT_FIELDS = {
  os: {
    label: 'Sistema operativo del servidor',
    options: [
      ['linux', 'Linux'],
      ['windows', 'Windows'],
      ['macos', 'macOS'],
      ['unknown', 'No lo sé'],
    ],
  },
  architecture: {
    label: 'Arquitectura de la CPU',
    options: [
      ['amd64', 'amd64 (x86-64)'],
      ['arm64', 'arm64'],
      ['unknown', 'No lo sé'],
    ],
  },
  storageKind: {
    label: 'Tipo de almacenamiento',
    options: [
      ['ssd', 'SSD local'],
      ['hdd', 'Disco duro (HDD) local'],
      ['network', 'Almacenamiento de red'],
      ['unknown', 'No lo sé'],
    ],
  },
  access: {
    label: 'Acceso previsto',
    options: [
      ['local', 'Solo desde la red local'],
      ['internet', 'También desde internet'],
    ],
  },
};
const EMPTY_VALUES = {
  cpuCores: '',
  ramGiB: '',
  storageGiB: '',
  os: 'unknown',
  architecture: 'unknown',
  storageKind: 'unknown',
  users: '1',
  dataGiB: '',
  access: 'local',
  hasDomain: false,
  cpuFeaturesKnown: false,
};

const STATUS = {
  viable: { label: 'Cabe en el presupuesto orientativo', tone: 'ok' },
  pending: { label: 'Pendiente de comprobar', tone: 'warn' },
  insufficient: { label: 'Insuficiente', tone: 'danger' },
};
const SEVERITY = {
  blocking: { label: 'Bloquea', tone: 'danger' },
  pending: { label: 'Pendiente', tone: 'warn' },
  info: { label: 'Información', tone: 'info' },
};

const fmt = (n) => (typeof n === 'number' ? new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(n) : '—');

function toValues(profile) {
  if (!profile) return { ...EMPTY_VALUES };
  const values = { ...EMPTY_VALUES };
  for (const key of Object.keys(NUMBER_FIELDS)) values[key] = String(profile[key]);
  for (const key of Object.keys(SELECT_FIELDS)) values[key] = profile[key];
  values.hasDomain = profile.hasDomain === true;
  values.cpuFeaturesKnown = profile.cpuFeaturesKnown === true;
  return values;
}

const sameValues = (a, b) => Object.keys(EMPTY_VALUES).every((key) => a[key] === b[key]);

/** Valida en el cliente con los mismos límites que el servidor; devuelve {profile, errors}. */
function parseValues(values) {
  const errors = {};
  const profile = {};
  for (const [key, rule] of Object.entries(NUMBER_FIELDS)) {
    const raw = String(values[key]).trim().replace(',', '.');
    const number = raw === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(number) || number < rule.min || number > rule.max || (rule.integer && !Number.isInteger(number))) {
      errors[key] = `${rule.integer ? 'Número entero' : 'Número'} entre ${fmt(rule.min)} y ${fmt(rule.max)}.`;
    } else {
      profile[key] = number;
    }
  }
  for (const key of Object.keys(SELECT_FIELDS)) profile[key] = values[key];
  profile.hasDomain = values.hasDomain === true;
  profile.cpuFeaturesKnown = values.cpuFeaturesKnown === true;
  return { profile, errors };
}

function errorMessage(error, fallback) {
  if (error instanceof AuthRequestError) {
    if (error.status === 404) return 'Este proyecto ya no existe o no pertenece a tu cuenta. No se ha guardado nada.';
    return error.status === 403 ? error.message : `${error.message} No se ha guardado nada.`;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
function ProfileForm({ project, workflow, values, setValues, onSaved }) {
  const client = useProjectsClient();
  const { pathname } = useLocation();
  const userId = useAuth((state) => state.user?.id);
  const withCsrf = useAuth((state) => state.withCsrf);
  const expireSession = useAuth((state) => state.expireSession);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const alertRef = useRef(null);
  const formRef = useRef(null);
  const uid = useId();
  const saved = toValues(workflow.profile);
  const dirty = !sameValues(values, saved);
  const progressCount = workflow.progress.stale ? 0 : workflow.progress.completedStepIds.length;

  const [focusInvalid, setFocusInvalid] = useState(0);

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  // Tras pintar los errores, el foco va al primer campo inválido.
  useEffect(() => {
    if (focusInvalid) formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [focusInvalid]);

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    const { profile, errors } = parseValues(values);
    setFormError(null);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setFocusInvalid((n) => n + 1);
      return;
    }
    busy.current = true;
    setSaving(true);
    // Si la sesión caduca durante el envío, al volver la misma cuenta recupera los valores.
    saveProjectDraft({ userId, path: pathname, values });
    try {
      const next = await withCsrf((csrfToken) => client.saveProfile(project.id, profile, { csrfToken }));
      clearProjectDraft(userId);
      onSaved(next);
      return;
    } catch (error) {
      if (isStaleWrite(error)) return;
      if (error instanceof AuthRequestError && error.status === 401) {
        expireSession();
        return;
      }
      if (error instanceof AuthRequestError && error.fields) {
        setFieldErrors({ ...error.fields });
      }
      const message = errorMessage(error, 'No se pudo guardar el equipo. Tus datos siguen en el formulario; inténtalo de nuevo.');
      setFormError((current) => ({ text: `${message} Tus datos siguen en el formulario.`, id: (current?.id ?? 0) + 1 }));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const fieldId = (key) => `${uid}-${key}`;
  const describedBy = (key, hint) => [hint && `${fieldId(key)}-hint`, fieldErrors[key] && `${fieldId(key)}-error`].filter(Boolean).join(' ') || undefined;

  return (
    <form ref={formRef} className="auth-form flow-form" noValidate onSubmit={submit} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="flow-form__title">
        Equipo y uso previsto
      </h2>
      <p className="muted">
        Datos que declaras tú; no se detecta nada de tu equipo. Se usan para una estimación orientativa, nunca una garantía.
      </p>
      {formError && (
        <div ref={alertRef} className="form-alert" role="alert" tabIndex={-1}>
          <p>{formError.text}</p>
        </div>
      )}

      <div className="flow-form__grid">
        {Object.entries(NUMBER_FIELDS).map(([key, rule]) => (
          <div className="field" key={key}>
            <label className="field__label" htmlFor={fieldId(key)}>
              {rule.label}
            </label>
            <input
              id={fieldId(key)}
              className="field__input"
              type="number"
              inputMode={rule.integer ? 'numeric' : 'decimal'}
              min={rule.min}
              max={rule.max}
              step={rule.step}
              value={values[key]}
              onChange={(event) => update(key, event.target.value)}
              aria-invalid={fieldErrors[key] ? true : undefined}
              aria-describedby={describedBy(key, true)}
            />
            <p id={`${fieldId(key)}-hint`} className="field__hint">
              Entre {fmt(rule.min)} y {fmt(rule.max)}.
            </p>
            {fieldErrors[key] && (
              <p id={`${fieldId(key)}-error`} className="field__error">
                {fieldErrors[key]}
              </p>
            )}
          </div>
        ))}
        {Object.entries(SELECT_FIELDS).map(([key, field]) => (
          <div className="field" key={key}>
            <label className="field__label" htmlFor={fieldId(key)}>
              {field.label}
            </label>
            <select
              id={fieldId(key)}
              className="field__input"
              value={values[key]}
              onChange={(event) => update(key, event.target.value)}
              aria-invalid={fieldErrors[key] ? true : undefined}
              aria-describedby={describedBy(key, false)}
            >
              {field.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {fieldErrors[key] && (
              <p id={`${fieldId(key)}-error`} className="field__error">
                {fieldErrors[key]}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flow-form__checks">
        <label className="picker__option">
          <input type="checkbox" checked={values.hasDomain} onChange={(event) => update('hasDomain', event.target.checked)} />
          <span>Tengo un dominio propio para estos servicios</span>
        </label>
        <div className="field">
          <label className="picker__option" htmlFor={fieldId('cpuFeaturesKnown')}>
            <input
              id={fieldId('cpuFeaturesKnown')}
              type="checkbox"
              checked={values.cpuFeaturesKnown}
              onChange={(event) => update('cpuFeaturesKnown', event.target.checked)}
              aria-describedby={`${fieldId('cpuFeaturesKnown')}-hint`}
            />
            <span>He comprobado que mi CPU es compatible con x86-64-v2</span>
          </label>
          <p id={`${fieldId('cpuFeaturesKnown')}-hint`} className="field__hint">
            Márcalo solo si lo verificaste (no basta con conocer el modelo). Afecta al aprendizaje automático de Immich en amd64.
          </p>
        </div>
      </div>

      {dirty && progressCount > 0 && (
        <p className="callout callout--warning" role="note">
          Guardar estos cambios recalcula el plan: los {progressCount} pasos marcados no se aplicarán al nuevo plan.
        </p>
      )}

      <div className="project-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={saving ? true : undefined}>
          {saving ? 'Guardando…' : workflow.profile ? 'Guardar y recalcular' : 'Guardar equipo'}
        </button>
        {dirty && workflow.profile && (
          <button type="button" className="button button--ghost" onClick={() => setValues(saved)} disabled={saving}>
            Descartar cambios
          </button>
        )}
      </div>
      {workflow.profile && (
        <p className="muted">Revisión guardada: {workflow.profile.revision}.</p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
function UnsavedNotice({ dirty }) {
  if (!dirty) return null;
  return (
    <p className="callout callout--warning" role="note">
      Tienes cambios sin guardar en el equipo. Lo que ves corresponde al último equipo guardado.
    </p>
  );
}

function NeedsProfile() {
  return (
    <div className="state state--empty">
      <h2>Aún no hay equipo guardado</h2>
      <p>Guarda el equipo y el uso previsto para ver la evaluación y el plan.</p>
      <Link className="button button--primary" to="?vista=equipo">
        Ir a Equipo
      </Link>
    </div>
  );
}

function WarningList({ warnings }) {
  if (!warnings.length) return null;
  return (
    <ul className="flow-warnings">
      {warnings.map((warning, index) => (
        <li key={`${warning.code}-${warning.alternativeId ?? 'all'}-${index}`} className={`flow-warning flow-warning--${SEVERITY[warning.severity]?.tone ?? 'info'}`}>
          <span className="flow-warning__severity">{SEVERITY[warning.severity]?.label ?? 'Aviso'}</span>
          <span className="flow-warning__text">
            {warning.text}
            {warning.source && (
              <>
                {' '}
                <ExternalLink href={warning.source} unavailableLabel="Fuente">Fuente oficial</ExternalLink>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EvaluationView({ evaluation, dirty }) {
  if (!evaluation) return <NeedsProfile />;
  const status = STATUS[evaluation.status] ?? STATUS.pending;
  const { totals } = evaluation;
  const rows = [
    ['RAM', totals.ramGiB, 'GiB'],
    ['CPU', totals.cpuCores, 'núcleos'],
    ['Disco', totals.diskGiB, 'GiB'],
  ];
  return (
    <div className="flow-view">
      <UnsavedNotice dirty={dirty} />
      <section className="detail-section" aria-labelledby="flow-eval-status">
        <h2 id="flow-eval-status">Resultado orientativo</h2>
        <p className={`flow-status flow-status--${status.tone}`}>{status.label}</p>
        <p className="muted">
          Reglas {evaluation.rulesVersion}, fuentes revisadas hasta {evaluation.checkedAt}. {evaluation.editorialSource?.note}
        </p>
      </section>

      <section className="detail-section" aria-labelledby="flow-eval-totals">
        <h2 id="flow-eval-totals">Recursos estimados frente a tu equipo</h2>
        <div className="table-scroll">
          <table className="flow-totals">
            <thead>
              <tr>
                <th scope="col">Recurso</th>
                <th scope="col">Estimado</th>
                <th scope="col">Declarado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, value, unit]) => (
                <tr key={label} className={value.available < value.required ? 'flow-totals__short' : undefined}>
                  <th scope="row">{label}</th>
                  <td>
                    {fmt(value.required)} {unit}
                  </td>
                  <td>
                    {fmt(value.available)} {unit}
                    {value.available < value.required && <span className="sr-only"> (insuficiente)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flow-equations">
          {Object.values(totals.equations ?? {}).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>

      <section className="detail-section" aria-labelledby="flow-eval-warnings">
        <h2 id="flow-eval-warnings">Avisos y condiciones</h2>
        <WarningList warnings={evaluation.warnings} />
      </section>

      <section className="detail-section" aria-labelledby="flow-eval-items">
        <h2 id="flow-eval-items">Desglose por alternativa</h2>
        <ul className="flow-items">
          {evaluation.items.map((item) => (
            <li key={item.alternativeId} className="flow-item">
              <h3>{item.name ?? <ProjectAlternative alternative={{ id: item.alternativeId, available: false }} />}</h3>
              {item.status === 'estimated' ? (
                <>
                  <p>
                    Presupuesto editorial: {fmt(item.budget.ramGiB)} GiB RAM, {fmt(item.budget.cpuCores)} núcleos, {fmt(item.budget.diskGiB)} GiB de disco
                    {totals.loadFactor > 1 && ` (×${totals.loadFactor} por carga: ${fmt(item.scaled.ramGiB)} GiB, ${fmt(item.scaled.cpuCores)} núcleos)`}.
                  </p>
                  <p className="flow-item__official">
                    <span className="badge badge--official">Dato oficial</span> {item.official.summary}
                  </p>
                  <ul className="inline-list">
                    {item.official.sources.map((source) => (
                      <li key={source.url}>
                        <ExternalLink href={source.url} unavailableLabel="Fuente">{`Fuente (revisada ${source.checkedAt})`}</ExternalLink>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted">
                  {item.status === 'retired'
                    ? 'Ya no está en el catálogo: sustitúyela en el proyecto. No suma recursos.'
                    : 'Sin reglas de requisitos: no suma recursos.'}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PromptBox({ prompt, label }) {
  const [state, setState] = useState('idle');
  const textRef = useRef(null);

  useEffect(() => {
    if (state === 'failed') {
      textRef.current?.focus();
      textRef.current?.select();
    }
  }, [state]);

  async function copy() {
    setState('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
      await navigator.clipboard.writeText(prompt);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="prompt-box">
      <div className="prompt-box__actions">
        <button type="button" className="button button--secondary button--small" onClick={copy} aria-disabled={state === 'copying' ? true : undefined}>
          {`Copiar prompt: ${label}`}
        </button>
        <span role="status" className="prompt-box__status">
          {state === 'copied' && 'Prompt copiado.'}
          {state === 'failed' && 'No se pudo copiar automáticamente. El texto está seleccionado: cópialo con Ctrl+C (⌘C en Mac).'}
        </span>
      </div>
      {state === 'failed' ? (
        <textarea ref={textRef} className="field__input prompt-box__text" readOnly value={prompt} rows={12} aria-label={`Prompt de ${label}`} />
      ) : (
        <details className="prompt-box__preview">
          <summary>Ver prompt</summary>
          <pre className="prompt-box__text">{prompt}</pre>
        </details>
      )}
    </div>
  );
}

function PlanView({ project, workflow, dirty, onProgress, onReload }) {
  const client = useProjectsClient();
  const withCsrf = useAuth((state) => state.withCsrf);
  const expireSession = useAuth((state) => state.expireSession);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const { plan, progress } = workflow;
  if (!plan) return <NeedsProfile />;
  const done = new Set(progress.stale ? [] : progress.completedStepIds);
  const groups = [];
  for (const step of plan.steps) {
    const last = groups[groups.length - 1];
    if (last && last.alternativeId === step.alternativeId) last.steps.push(step);
    else groups.push({ alternativeId: step.alternativeId, name: step.alternativeName, steps: [step] });
  }

  // Un solo guardado a la vez: las casillas se deshabilitan mientras tanto.
  async function toggle(stepId, checked) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const next = plan.steps.map((s) => s.id).filter((id) => (id === stepId ? checked : done.has(id)));
    try {
      const saved = await withCsrf((csrfToken) => client.saveProgress(project.id, { fingerprint: plan.fingerprint, completedStepIds: next }, { csrfToken }));
      onProgress({ completedStepIds: saved.completedStepIds, stale: false, updatedAt: saved.updatedAt });
    } catch (failure) {
      if (isStaleWrite(failure)) return;
      if (failure instanceof AuthRequestError && failure.status === 401) {
        expireSession();
        return;
      }
      if (failure instanceof AuthRequestError && failure.status === 409) {
        setError({ text: 'El plan cambió desde que lo cargaste (otro dispositivo o pestaña). No se guardó el avance.', reload: true });
      } else {
        setError({ text: errorMessage(failure, 'No se pudo guardar el avance. Inténtalo de nuevo.'), reload: false });
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="flow-view">
      <UnsavedNotice dirty={dirty} />
      {progress.stale && (
        <p className="callout callout--warning" role="note">
          El avance guardado correspondía a otra versión del plan (cambió el equipo o la selección) y no se aplica a este.
        </p>
      )}
      {plan.blocked && (
        <section className="callout callout--warning flow-blocked" aria-labelledby="flow-blocked-title">
          <div>
            <h2 id="flow-blocked-title">El plan no está listo para instalar</h2>
            <ul>
              {plan.blockedReasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`}>{reason.text}</li>
              ))}
            </ul>
            <p>
              Puedes revisar los pasos como información. <Link to={`/proyectos/${project.id}/editar`}>Editar la selección del proyecto</Link> o{' '}
              <Link to="?vista=equipo">revisar el equipo</Link>.
            </p>
          </div>
        </section>
      )}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error.text}</p>
          {error.reload && (
            <button type="button" className="button button--secondary button--small" onClick={onReload}>
              Recargar el plan
            </button>
          )}
        </div>
      )}
      <p className="muted" role="status">
        {saving ? 'Guardando avance…' : `${done.size} de ${plan.steps.length} pasos completados.`}
        {!saving && progress.updatedAt && !progress.stale && (
          <>
            {' '}
            Última actualización: <DateTime value={progress.updatedAt} />.
          </>
        )}
      </p>

      {groups.map((group) => (
        <section key={group.alternativeId} className="detail-section flow-group" aria-labelledby={`flow-group-${group.alternativeId}`}>
          <h2 id={`flow-group-${group.alternativeId}`}>{group.name}</h2>
          <ol className="flow-steps">
            {group.steps.map((step) => (
              <li key={step.id} className={`flow-step${done.has(step.id) ? ' flow-step--done' : ''}`}>
                <label className="flow-step__check">
                  <input type="checkbox" checked={done.has(step.id)} disabled={saving} onChange={(event) => toggle(step.id, event.target.checked)} />
                  <span>
                    <span className="flow-step__stage">{step.stageLabel}</span> {step.title}
                  </span>
                </label>
                <p>{step.explanation}</p>
                <h3 className="flow-step__subtitle">Tareas</h3>
                <ul className="bullet-list">
                  {step.tasks.map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
                <h3 className="flow-step__subtitle">Comprobación</h3>
                <ul className="bullet-list">
                  {step.validation.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {step.pending.length > 0 && (
                  <div className="flow-step__pending">
                    <h3 className="flow-step__subtitle">Condiciones pendientes antes de copiar</h3>
                    <ul className="bullet-list">
                      {step.pending.map((item, index) => (
                        <li key={`${item.code}-${index}`}>{item.text}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <ul className="inline-list flow-step__sources">
                  {step.sources.map((source) => (
                    <li key={source.url}>
                      <ExternalLink href={source.url} unavailableLabel={source.label}>{source.label}</ExternalLink>
                    </li>
                  ))}
                </ul>
                <PromptBox prompt={step.prompt} label={`${group.name}, ${step.stageLabel}`} />
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="muted">Los prompts solo guían: NoMoreSaaS no instala software, no se conecta a tus equipos ni envía nada a servicios de IA.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function WorkflowView({ data, replace, retry }) {
  const { project, workflow } = data;
  const { pathname } = useLocation();
  const userId = useAuth((state) => state.user?.id);
  const [params] = useSearchParams();
  const view = VIEWS.some((v) => v.id === params.get('vista')) ? params.get('vista') : 'equipo';
  const [restored] = useState(() => takeProjectDraft(userId, pathname));
  const [values, setValues] = useState(() => restored ?? toValues(workflow.profile));
  const [notice, setNotice] = useState(restored ? 'Hemos recuperado el equipo que no llegó a guardarse. Revísalo y pulsa Guardar.' : null);
  const dirty = !sameValues(values, toValues(workflow.profile));
  const headingRef = useRef(null);

  function saved(next) {
    replace({ project, workflow: next });
    setValues(toValues(next.profile));
    setNotice('Equipo guardado. La evaluación y el plan se han recalculado.');
  }

  return (
    <>
      {notice && (
        <p className="page-notice" role="status">
          {notice}
        </p>
      )}
      <nav className="flow-nav" aria-label="Pasos del flujo">
        <ol>
          {VIEWS.map((item) => (
            <li key={item.id}>
              <Link to={`?vista=${item.id}`} aria-current={item.id === view ? 'page' : undefined} onClick={() => headingRef.current?.focus()}>
                {item.label}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {VIEWS.find((v) => v.id === view).label}
      </h2>
      {view === 'equipo' && <ProfileForm project={project} workflow={workflow} values={values} setValues={setValues} onSaved={saved} />}
      {view === 'evaluacion' && <EvaluationView evaluation={workflow.evaluation} dirty={dirty} />}
      {view === 'plan' && (
        <PlanView
          project={project}
          workflow={workflow}
          dirty={dirty}
          onProgress={(progress) => replace({ project, workflow: { ...workflow, progress } })}
          onReload={retry}
        />
      )}
    </>
  );
}

/** /proyectos/:id/flujo */
export function WorkflowPage() {
  const { id } = useParams();
  const client = useProjectsClient();
  const userId = useAuth((state) => state.user?.id);
  const request = useOwnedRequest(
    async (signal) => {
      const [project, workflow] = await Promise.all([client.getProject(id, { signal }), client.getWorkflow(id, { signal })]);
      return { project, workflow };
    },
    `workflow:${id}`,
  );
  const project = request.status === 'success' ? request.data.project : null;
  useDocumentTitle(project ? `Flujo de ${project.name}` : isMissing(request.error) ? 'Proyecto no encontrado' : 'Flujo del proyecto');

  if (request.status === 'loading') return <ProjectsLoading label="Cargando el flujo del proyecto…" />;
  if (request.status === 'error') {
    if (isMissing(request.error)) return <ProjectNotFound />;
    return <ProjectsError title="No se pudo cargar el flujo" error={request.error} onRetry={request.retry} />;
  }

  const retired = project.alternatives.filter((alt) => !alt.available);
  return (
    <article className="page detail flow-page">
      <nav className="breadcrumb" aria-label="Ruta">
        <Link to={`/proyectos/${project.id}`}>Volver a {project.name}</Link>
      </nav>
      <header className="detail__header">
        <div>
          <h1>Equipo, evaluación y plan</h1>
          <p className="page-meta">
            <span>{project.name}</span>
            <span>{project.alternatives.map((alt) => alt.name ?? `${alt.id} (no disponible)`).join(' · ')}</span>
          </p>
        </div>
      </header>
      {retired.length > 0 && (
        <p className="callout callout--warning" role="note">
          Este proyecto incluye alternativas que ya no están en el catálogo ({retired.map((alt) => alt.id).join(', ')}). Sustitúyelas{' '}
          <Link to={`/proyectos/${project.id}/editar`}>editando el proyecto</Link> antes de continuar con el plan.
        </p>
      )}
      <WorkflowView key={`${userId}|${project.id}`} data={request.data} replace={request.replace} retry={request.retry} />
    </article>
  );
}
