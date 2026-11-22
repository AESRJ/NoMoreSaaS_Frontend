import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequestError } from '../src/api/auth.js';
import { getWorkflow, saveProfile } from '../src/api/workflow.js';
import { clearProjectDraft, saveProjectDraft } from '../src/store/projectDraft.js';
import { anonymousAuthClient, emptyProjectsClient, renderApp } from './helpers.jsx';

// Recorrido /proyectos/:id/flujo con cliente de proyectos simulado: lógica de
// UI (estados, errores, carreras, portapapeles). La integración real con la
// API se cubre en tests/e2e/workflow.spec.js.
const USER_A = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com' };
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FP = 'f'.repeat(64);
const FP2 = 'e'.repeat(64);
const httpError = (status, message, extra = {}) => new AuthRequestError('http', message, { status, ...extra });

const PROJECT = {
  id: P1,
  name: 'Mi nube',
  description: '',
  alternativeIds: ['archivero'],
  alternatives: [{ id: 'archivero', name: 'Archivero', available: true }],
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
};

const PROFILE = {
  revision: 1,
  cpuCores: 4,
  ramGiB: 8,
  storageGiB: 500,
  os: 'linux',
  architecture: 'amd64',
  storageKind: 'ssd',
  users: 2,
  dataGiB: 50,
  access: 'local',
  hasDomain: false,
  cpuFeaturesKnown: false,
};

const EVALUATION = {
  status: 'pending',
  rulesVersion: '2026-11-22.1',
  checkedAt: '2026-11-22',
  editorialSource: { kind: 'editorial', note: 'Presupuesto editorial, no mínimo oficial.' },
  items: [
    {
      alternativeId: 'archivero',
      name: 'Archivero',
      available: true,
      status: 'estimated',
      budget: { ramGiB: 2, cpuCores: 2, diskGiB: 4 },
      scaled: { ramGiB: 2, cpuCores: 2 },
      official: { summary: 'Resumen oficial de Archivero.', sources: [{ url: 'https://archivero.example.org/req', checkedAt: '2026-11-20', kind: 'official' }] },
    },
  ],
  totals: {
    loadFactor: 1,
    ramGiB: { base: 2, required: 2.5, available: 8 },
    cpuCores: { base: 2, required: 2, available: 4 },
    diskGiB: { base: 4, data: 62.5, required: 66.5, available: 500 },
    equations: { ram: 'RAM requerida = 2 × 1 × 1,25 = 2,5 GiB' },
  },
  warnings: [
    { code: 'domain-required', severity: 'pending', alternativeId: 'archivero', text: 'Requiere un dominio.', source: 'https://archivero.example.org/req' },
    { code: 'estimate-orientative', severity: 'info', alternativeId: null, text: 'Estimación orientativa; no garantiza nada.', source: null },
  ],
};

const step = (stage, stageLabel) => ({
  id: `archivero.${stage}`,
  alternativeId: 'archivero',
  alternativeName: 'Archivero',
  stage,
  stageLabel,
  title: `${stageLabel} de Archivero`,
  explanation: `Explicación ${stage}.`,
  tasks: [`Tarea ${stage}`],
  validation: [`Validación ${stage}`],
  sources: [{ label: 'Docs Archivero', url: 'https://archivero.example.org/docs' }],
  pending: [{ code: 'domain-required', text: 'Requiere un dominio.' }],
  prompt: `Contexto: «Mi nube» <script>x</script>\nEtapa ${stage}`,
});

const PLAN = {
  fingerprint: FP,
  rulesVersion: '2026-11-22.1',
  templatesVersion: '2026-11-22.1',
  blocked: false,
  blockedReasons: [],
  steps: [step('preparation', 'Preparación'), step('installation', 'Instalación prevista')],
};

const EMPTY_PROGRESS = { completedStepIds: [], stale: false, updatedAt: null };
const doc = (overrides = {}) => ({ profile: PROFILE, evaluation: EVALUATION, plan: PLAN, progress: EMPTY_PROGRESS, ...overrides });
const EMPTY_DOC = { profile: null, evaluation: null, plan: null, progress: EMPTY_PROGRESS };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function signedIn(user = USER_A) {
  return anonymousAuthClient({
    fetchSession: vi.fn().mockResolvedValueOnce({ user, csrfToken: 'a1' }).mockResolvedValue({ user: null, csrfToken: 'p2' }),
  });
}

function client(overrides = {}) {
  return emptyProjectsClient({
    getProject: vi.fn(() => Promise.resolve(PROJECT)),
    getWorkflow: vi.fn(() => Promise.resolve(doc())),
    saveProfile: vi.fn(() => Promise.reject(new Error('saveProfile no simulado'))),
    saveProgress: vi.fn(() => Promise.reject(new Error('saveProgress no simulado'))),
    ...overrides,
  });
}

const open = (view, projectsClient, authClient = signedIn()) => renderApp(`/proyectos/${P1}/flujo?vista=${view}`, { authClient, projectsClient });
const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  clearProjectDraft();
});
afterEach(() => vi.unstubAllGlobals());

describe('cliente HTTP del flujo', () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('GET workflow same-origin y valida la forma; respuesta inesperada es error', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, doc())));
    vi.stubGlobal('fetch', fetchMock);
    expect((await getWorkflow(P1)).plan.fingerprint).toBe(FP);
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${P1}/workflow`, expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    fetchMock.mockResolvedValueOnce(json(200, { profile: null }));
    await expect(getWorkflow(P1)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('PUT profile envía solo los campos editables y expone errores por campo', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(400, { error: { code: 'VALIDATION_ERROR', message: 'Perfil inválido.', fields: { cpuCores: 'Entero.', __proto__: 'x' } } })));
    vi.stubGlobal('fetch', fetchMock);
    const failure = await saveProfile(P1, { ...PROFILE, projectId: 'x', ownerId: 'y' }, { csrfToken: 't' }).catch((e) => e);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(sent).sort()).toEqual(['access', 'architecture', 'cpuCores', 'cpuFeaturesKnown', 'dataGiB', 'hasDomain', 'os', 'ramGiB', 'storageGiB', 'storageKind', 'users']);
    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe('t');
    expect(failure.fields.cpuCores).toBe('Entero.');
    expect(Object.getPrototypeOf(failure.fields)).toBeNull();
  });
});

describe('/proyectos/:id/flujo', () => {
  it('enlazado desde el proyecto; vista Equipo con campos del perfil y etiqueta afirmativa x86-64-v2', async () => {
    const projectsClient = client({ getWorkflow: vi.fn(() => Promise.resolve(EMPTY_DOC)) });
    const { user } = renderApp(`/proyectos/${P1}`, { authClient: signedIn(), projectsClient });
    await user.click(await screen.findByRole('link', { name: 'Equipo, evaluación y plan' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipo, evaluación y plan' })).toBeInTheDocument();
    expect(location()).toBe(`/proyectos/${P1}/flujo`);
    for (const label of ['Núcleos de CPU', 'RAM (GiB)', 'Espacio libre en disco (GiB)', 'Usuarios previstos', 'Datos previstos (GiB)', 'Sistema operativo del servidor', 'Arquitectura de la CPU', 'Tipo de almacenamiento', 'Acceso previsto']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('checkbox', { name: 'Tengo un dominio propio para estos servicios' })).not.toBeChecked();
    const cpu = screen.getByRole('checkbox', { name: 'He comprobado que mi CPU es compatible con x86-64-v2' });
    expect(cpu).toHaveAccessibleDescription(/solo si lo verificaste/i);
    expect(screen.getByRole('link', { name: /volver a mi nube/i })).toHaveAttribute('href', `/proyectos/${P1}`);
  });

  it('sin perfil guardado, Evaluación y Plan muestran estado vacío (nunca un perfil sin guardar evaluado)', async () => {
    const { user } = open('equipo', client({ getWorkflow: vi.fn(() => Promise.resolve(EMPTY_DOC)) }));
    await user.type(await screen.findByLabelText('Núcleos de CPU'), '8');
    await user.click(screen.getByRole('link', { name: 'Evaluación' }));
    expect(screen.getByRole('heading', { name: 'Aún no hay equipo guardado' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Plan' }));
    expect(screen.getByRole('heading', { name: 'Aún no hay equipo guardado' })).toBeInTheDocument();
    // El borrador sigue en el formulario al volver.
    await user.click(screen.getByRole('link', { name: 'Equipo' }));
    expect(screen.getByLabelText('Núcleos de CPU')).toHaveValue(8);
  });

  it('valida en el cliente sin enviar; guarda el perfil y muestra la evaluación recalculada', async () => {
    const saveProfileMock = vi.fn(() => Promise.resolve(doc()));
    const projectsClient = client({ getWorkflow: vi.fn(() => Promise.resolve(EMPTY_DOC)), saveProfile: saveProfileMock });
    const { user } = open('equipo', projectsClient);
    await user.click(await screen.findByRole('button', { name: 'Guardar equipo' }));
    expect(saveProfileMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Núcleos de CPU')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Núcleos de CPU')).toHaveFocus();

    await user.type(screen.getByLabelText('Núcleos de CPU'), '4');
    await user.type(screen.getByLabelText('RAM (GiB)'), '8');
    await user.type(screen.getByLabelText('Espacio libre en disco (GiB)'), '500');
    await user.clear(screen.getByLabelText('Usuarios previstos'));
    await user.type(screen.getByLabelText('Usuarios previstos'), '2');
    await user.type(screen.getByLabelText('Datos previstos (GiB)'), '50');
    await user.selectOptions(screen.getByLabelText('Sistema operativo del servidor'), 'linux');
    await user.selectOptions(screen.getByLabelText('Arquitectura de la CPU'), 'amd64');
    await user.selectOptions(screen.getByLabelText('Tipo de almacenamiento'), 'ssd');
    await user.click(screen.getByRole('button', { name: 'Guardar equipo' }));
    expect(saveProfileMock).toHaveBeenCalledWith(
      P1,
      { cpuCores: 4, ramGiB: 8, storageGiB: 500, os: 'linux', architecture: 'amd64', storageKind: 'ssd', users: 2, dataGiB: 50, access: 'local', hasDomain: false, cpuFeaturesKnown: false },
      { csrfToken: 'a1' },
    );
    expect(await screen.findByText(/equipo guardado/i)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Evaluación' }));
    expect(screen.getByText('Pendiente de comprobar')).toBeInTheDocument();
    expect(screen.getByText('RAM requerida = 2 × 1 × 1,25 = 2,5 GiB')).toBeInTheDocument();
    expect(screen.getByText('Requiere un dominio.')).toBeInTheDocument();
    expect(screen.getByText('Resumen oficial de Archivero.')).toBeInTheDocument();
    expect(screen.getByText(/no mínimo oficial/)).toBeInTheDocument();
  });

  it('error del servidor conserva los valores y marca campos; 401 caduca la sesión y recupera el borrador al volver', async () => {
    const saveProfileMock = vi
      .fn()
      .mockRejectedValueOnce(httpError(400, 'El perfil del equipo no es válido.', { fields: { ramGiB: 'Debe ser un número entre 0.5 y 4096.' } }))
      .mockRejectedValueOnce(httpError(401, 'Necesitas iniciar sesión.'));
    const { user } = open('equipo', client({ saveProfile: saveProfileMock }));
    const cores = await screen.findByLabelText('Núcleos de CPU');
    await user.clear(cores);
    await user.type(cores, '6');
    await user.click(screen.getByRole('button', { name: 'Guardar y recalcular' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/tus datos siguen en el formulario/i);
    expect(screen.getByLabelText('RAM (GiB)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Debe ser un número entre 0.5 y 4096.')).toBeInTheDocument();
    expect(cores).toHaveValue(6);

    await user.click(screen.getByRole('button', { name: 'Guardar y recalcular' }));
    await waitFor(() => expect(location()).toMatch(/^\/entrar/));
  });

  it('cambios sin guardar con avance: aviso antes de guardar y aviso en Evaluación/Plan', async () => {
    const withProgress = doc({ progress: { completedStepIds: ['archivero.preparation'], stale: false, updatedAt: '2026-11-22T10:00:00.000Z' } });
    const { user } = open('equipo', client({ getWorkflow: vi.fn(() => Promise.resolve(withProgress)) }));
    const ram = await screen.findByLabelText('RAM (GiB)');
    expect(screen.queryByText(/recalcula el plan/)).not.toBeInTheDocument();
    await user.clear(ram);
    await user.type(ram, '16');
    expect(screen.getByText(/los 1 pasos marcados no se aplicarán al nuevo plan/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Evaluación' }));
    expect(screen.getByText(/cambios sin guardar en el equipo/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Plan' }));
    expect(screen.getByText(/cambios sin guardar en el equipo/)).toBeInTheDocument();
  });

  it('plan: pasos por etapa con pendientes y fuentes; prompt como texto (sin HTML)', async () => {
    const { container } = open('plan', client());
    expect(await screen.findByRole('heading', { name: 'Archivero' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Preparación Preparación de Archivero' })).not.toBeChecked();
    expect(screen.getAllByText('Condiciones pendientes antes de copiar')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Docs Archivero' })[0]).toHaveAttribute('href', 'https://archivero.example.org/docs');
    expect(screen.getAllByText(/<script>x<\/script>/).length).toBeGreaterThan(0);
    expect(container.querySelector('main script')).toBeNull();
    expect(screen.getByText('0 de 2 pasos completados.')).toBeInTheDocument();
  });

  it('marcar avance: un solo guardado a la vez (casillas deshabilitadas) y resultado del servidor', async () => {
    const pending = deferred();
    const saveProgressMock = vi.fn(() => pending.promise);
    const { user } = open('plan', client({ saveProgress: saveProgressMock }));
    const first = await screen.findByRole('checkbox', { name: /Preparación de Archivero/ });
    const second = screen.getByRole('checkbox', { name: /Instalación prevista de Archivero/ });
    await user.click(first);
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    expect(saveProgressMock).toHaveBeenCalledWith(P1, { fingerprint: FP, completedStepIds: ['archivero.preparation'] }, { csrfToken: 'a1' });
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    await user.click(second);
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    pending.resolve({ fingerprint: FP, completedStepIds: ['archivero.preparation'], updatedAt: '2026-11-22T12:00:00.000Z' });
    await waitFor(() => expect(first).toBeChecked());
    expect(first).toBeEnabled();
    expect(screen.getByText(/1 de 2 pasos completados/)).toBeInTheDocument();
  });

  it('409 por plan obsoleto: no marca nada y ofrece recargar; avance stale avisado', async () => {
    const getWorkflowMock = vi
      .fn()
      .mockResolvedValueOnce(doc())
      .mockResolvedValueOnce(doc({ plan: { ...PLAN, fingerprint: FP2 }, progress: { completedStepIds: [], stale: true, updatedAt: null } }));
    const { user } = open('plan', client({ getWorkflow: getWorkflowMock, saveProgress: vi.fn(() => Promise.reject(httpError(409, 'El plan ha cambiado.', { code: 'PLAN_STALE' }))) }));
    const first = await screen.findByRole('checkbox', { name: /Preparación de Archivero/ });
    await user.click(first);
    expect(await screen.findByRole('alert')).toHaveTextContent(/el plan cambió/i);
    expect(first).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Recargar el plan' }));
    expect(await screen.findByText(/correspondía a otra versión del plan/)).toBeInTheDocument();
    expect(getWorkflowMock).toHaveBeenCalledTimes(2);
  });

  it('copiar prompt: éxito solo si el portapapeles confirma; si falla, texto seleccionable sin fingir éxito', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denegado'));
    const { user } = open('plan', client());
    // user-event instala su propio portapapeles en setup(); se sustituye después.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const [copyFirst, copySecond] = await screen.findAllByRole('button', { name: /copiar prompt/i });
    await user.click(copyFirst);
    expect(writeText).toHaveBeenCalledWith(PLAN.steps[0].prompt);
    expect(await screen.findByText('Prompt copiado.')).toBeInTheDocument();
    await user.click(copySecond);
    const box = await screen.findByRole('textbox', { name: /prompt de archivero, instalación prevista/i });
    expect(box).toHaveValue(PLAN.steps[1].prompt);
    expect(box).toHaveFocus();
    expect(screen.getByText(/no se pudo copiar automáticamente/i)).toBeInTheDocument();
    expect(screen.getAllByText('Prompt copiado.')).toHaveLength(1);
  });

  it('plan bloqueado y alternativa retirada: motivos visibles y enlace para sustituirla', async () => {
    const retiredProject = { ...PROJECT, alternativeIds: ['archivero', 'gitea'], alternatives: [...PROJECT.alternatives, { id: 'gitea', name: null, available: false }] };
    const blocked = doc({ plan: { ...PLAN, blocked: true, blockedReasons: [{ code: 'retired-alternative', alternativeId: 'gitea', text: 'Sustituye gitea.' }] } });
    open('plan', client({ getProject: vi.fn(() => Promise.resolve(retiredProject)), getWorkflow: vi.fn(() => Promise.resolve(blocked)) }));
    expect(await screen.findByRole('heading', { name: 'El plan no está listo para instalar' })).toBeInTheDocument();
    expect(screen.getByText('Sustituye gitea.')).toBeInTheDocument();
    expect(screen.getByText(/ya no están en el catálogo \(gitea\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /editar/i })[0]).toHaveAttribute('href', `/proyectos/${P1}/editar`);
  });

  it('error de carga con reintento; proyecto ajeno o inexistente = no encontrado', async () => {
    const getWorkflowMock = vi.fn().mockRejectedValueOnce(new AuthRequestError('network', 'Sin conexión.')).mockResolvedValue(doc());
    const { user } = open('evaluacion', client({ getWorkflow: getWorkflowMock }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/sin conexión/i)).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Pendiente de comprobar')).toBeInTheDocument();
  });

  it('un borrador de equipo de otra cuenta nunca se muestra; el de la misma cuenta sí', async () => {
    const path = `/proyectos/${P1}/flujo`;
    saveProjectDraft({ userId: 'otra-cuenta', path, values: { ...PROFILE, cpuCores: '99' } });
    open('equipo', client());
    expect(await screen.findByLabelText('Núcleos de CPU')).toHaveValue(4);
    expect(screen.queryByText(/hemos recuperado/i)).not.toBeInTheDocument();
  });

  it('404 muestra el mismo «Proyecto no encontrado»', async () => {
    open('equipo', client({ getProject: vi.fn(() => Promise.reject(httpError(404, 'El proyecto no existe.'))) }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Proyecto no encontrado' })).toBeInTheDocument();
  });

  it('editar la selección de un proyecto con avance avisa antes de guardar', async () => {
    const withProgress = doc({ progress: { completedStepIds: ['archivero.preparation', 'archivero.installation'], stale: false, updatedAt: '2026-11-22T10:00:00.000Z' } });
    const { user } = renderApp(`/proyectos/${P1}/editar`, { authClient: signedIn(), projectsClient: client({ getWorkflow: vi.fn(() => Promise.resolve(withProgress)) }) });
    await screen.findByRole('heading', { level: 1, name: 'Editar proyecto' });
    expect(screen.queryByText(/recalcula el plan/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Fotero' }));
    expect(screen.getByText(/los 2 pasos marcados no se aplicarán al nuevo plan/)).toBeInTheDocument();
  });
});
