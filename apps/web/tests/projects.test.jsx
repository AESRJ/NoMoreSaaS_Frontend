import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequestError } from '../src/api/auth.js';
import { createProject, deleteProject, listProjects, updateProject } from '../src/api/projects.js';
import { createAuthStore } from '../src/store/auth.js';
import { clearProjectDraft, saveProjectDraft, takeProjectDraft } from '../src/store/projectDraft.js';
import { anonymousAuthClient, emptyProjectsClient, renderApp, resetSelection } from './helpers.jsx';

const USER_A = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com' };
const USER_B = { id: '22222222-2222-4222-8222-222222222222', email: 'bea@example.com' };
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const httpError = (status, code, message) => new AuthRequestError('http', message, { status, code });

function project(overrides = {}) {
  return {
    id: P1,
    name: 'Mi nube',
    description: 'Fotos y archivos',
    alternativeIds: ['archivero', 'fotero'],
    alternatives: [
      { id: 'archivero', name: 'Archivero', available: true },
      { id: 'fotero', name: 'Fotero', available: true },
    ],
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:05:00.000Z',
    ...overrides,
  };
}

const RETIRED = project({
  alternativeIds: ['archivero', 'retirada-vieja'],
  alternatives: [
    { id: 'archivero', name: 'Archivero', available: true },
    { id: 'retirada-vieja', name: null, available: false },
  ],
});

/** Sesión autenticada como `user`; login posterior devuelve `loginAs`. */
function signedIn(user = USER_A, { loginAs = user } = {}) {
  return anonymousAuthClient({
    fetchSession: vi.fn().mockResolvedValueOnce({ user, csrfToken: 'a1' }).mockResolvedValue({ user: null, csrfToken: 'p2' }),
    login: vi.fn(() => Promise.resolve({ user: loginAs, csrfToken: 'a2' })),
  });
}

const location = () => screen.getByTestId('location').textContent;
const banner = () => document.querySelector('.site-header');
const main = () => screen.getByRole('main');

beforeEach(() => {
  resetSelection();
  clearProjectDraft();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe('cliente HTTP de proyectos', () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('GET same-origin sin caché y DTO saneado (sin campos ajenos al contrato)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { projects: [{ ...project(), ownerId: USER_A.id }] })));
    vi.stubGlobal('fetch', fetchMock);
    const [first] = await listProjects();
    expect(first).toEqual(project());
    expect(first).not.toHaveProperty('ownerId');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
  });

  it('escrituras con JSON y CSRF; DELETE envía {} y PATCH codifica el id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(201, { project: project() }))
      .mockResolvedValueOnce(json(200, { project: project() }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await createProject({ name: 'Mi nube', alternativeIds: ['archivero'] }, { csrfToken: 'tok' });
    await updateProject('../x', { name: 'Otro' }, { csrfToken: 'tok' });
    await deleteProject(P1, { csrfToken: 'tok' });
    const [post, patch, del] = fetchMock.mock.calls;
    expect(post[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'tok' } });
    expect(patch[0]).toBe('/api/projects/..%2Fx');
    expect(patch[1].method).toBe('PATCH');
    expect(del[0]).toBe(`/api/projects/${P1}`);
    expect(del[1]).toMatchObject({ method: 'DELETE', body: '{}' });
  });

  it('una respuesta sin la forma esperada es un error inválido', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { projects: [{ id: 1 }] }))));
    await expect(listProjects()).rejects.toMatchObject({ kind: 'invalid' });
  });
});

// ---------------------------------------------------------------------------
describe('guard y listado', () => {
  it('visitante en una ruta privada: va a /entrar conservando el destino y no pide proyectos', async () => {
    const { projectsClient } = renderApp('/proyectos/nuevo');
    await waitFor(() => expect(location()).toBe('/entrar?siguiente=%2Fproyectos%2Fnuevo'));
    expect(projectsClient.listProjects).not.toHaveBeenCalled();
  });

  it('carga, estado vacío con acción crear', async () => {
    const pending = deferred();
    renderApp('/proyectos', { authClient: signedIn(), projectsClient: emptyProjectsClient({ listProjects: vi.fn(() => pending.promise) }) });
    expect(await screen.findByText('Cargando tus proyectos…')).toBeInTheDocument();
    await act(async () => pending.resolve([]));
    expect(screen.getByRole('heading', { name: 'Aún no tienes proyectos' })).toBeInTheDocument();
    expect(within(main()).getByRole('link', { name: 'Crear proyecto' })).toHaveAttribute('href', '/proyectos/nuevo');
    expect(document.title).toBe('Mis proyectos · NoMoreSaaS');
  });

  it('error con reintento', async () => {
    const client = emptyProjectsClient({
      listProjects: vi
        .fn()
        .mockRejectedValueOnce(new AuthRequestError('network', 'No se pudo conectar con el servidor.'))
        .mockResolvedValueOnce([project()]),
    });
    const { user } = renderApp('/proyectos', { authClient: signedIn(), projectsClient: client });
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('link', { name: 'Mi nube' })).toHaveAttribute('href', `/proyectos/${P1}`);
    expect(client.listProjects).toHaveBeenCalledTimes(2);
  });

  it('lista con alternativas retiradas marcadas y texto del usuario sin HTML', async () => {
    const hostile = project({ id: P2, name: '<img src=x onerror=alert(1)>', description: '<b>negrita</b>' });
    renderApp('/proyectos', {
      authClient: signedIn(),
      projectsClient: emptyProjectsClient({ listProjects: vi.fn(() => Promise.resolve([RETIRED, hostile])) }),
    });
    expect(await screen.findByRole('link', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument();
    expect(screen.getByText('<b>negrita</b>')).toBeInTheDocument();
    expect(document.querySelector('main img, main b')).toBeNull();
    const retired = screen.getByRole('list', { name: 'Alternativas de Mi nube' });
    expect(within(retired).getByText('No disponible')).toBeInTheDocument();
    expect(within(retired).getByText('retirada-vieja')).toBeInTheDocument();
    expect(screen.getByText('2 proyectos')).toBeInTheDocument();
    expect(within(main()).getByRole('link', { name: 'Nuevo proyecto' })).toHaveAttribute('href', '/proyectos/nuevo');
  });

  it('cambio de usuario: descarta la respuesta tardía de A y carga solo la de B', async () => {
    const forA = deferred();
    const client = emptyProjectsClient({
      listProjects: vi
        .fn()
        .mockReturnValueOnce(forA.promise)
        .mockResolvedValueOnce([project({ id: P2, name: 'Proyecto de Bea' })]),
    });
    const { authStore } = renderApp('/proyectos', { authClient: signedIn(USER_A, { loginAs: USER_B }), projectsClient: client });
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(1));
    const signalA = client.listProjects.mock.calls[0][0].signal;
    await act(async () => {
      await authStore.getState().login({ email: USER_B.email, password: 'una frase de paso larga' });
    });
    expect(await screen.findByRole('link', { name: 'Proyecto de Bea' })).toBeInTheDocument();
    expect(signalA.aborted).toBe(true);
    await act(async () => forA.resolve([project({ name: 'Proyecto de Ana' })]));
    expect(screen.queryByText('Proyecto de Ana')).not.toBeInTheDocument();
    expect(client.listProjects).toHaveBeenCalledTimes(2);
  });

  it('401 al listar: limpia identidad y pide entrar con aviso visible', async () => {
    renderApp('/proyectos', {
      authClient: signedIn(),
      projectsClient: emptyProjectsClient({ listProjects: vi.fn(() => Promise.reject(httpError(401, 'UNAUTHENTICATED', 'x'))) }),
    });
    await waitFor(() => expect(location()).toBe('/entrar'));
    expect(within(main()).getByText(/tu sesión ha caducado/i)).toBeInTheDocument();
    expect(within(banner()).queryByText(USER_A.email)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('crear proyecto', () => {
  const nameInput = () => screen.getByLabelText('Nombre');
  const descriptionInput = () => screen.getByLabelText(/Descripción/);
  const box = (name) => screen.getByRole('checkbox', { name });

  async function fillValid(user) {
    await user.type(await screen.findByLabelText('Nombre'), '  Mi nube  ');
    await user.type(descriptionInput(), 'Fotos y archivos');
    await user.click(box('Fotero'));
    await user.click(box('Archivero'));
  }

  it('crea con el orden de selección, valores recortados y CSRF; muestra el detalle anunciado', async () => {
    const created = project({ alternativeIds: ['fotero', 'archivero'] });
    const client = emptyProjectsClient({
      createProject: vi.fn(() => Promise.resolve(created)),
      getProject: vi.fn(() => Promise.resolve(created)),
    });
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(), projectsClient: client });
    await fillValid(user);
    expect(within(screen.getByRole('list', { name: 'Alternativas seleccionadas' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'FoteroQuitar',
      'ArchiveroQuitar',
    ]);
    expect(screen.getByRole('button', { name: 'Quitar Fotero' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() => expect(location()).toBe(`/proyectos/${P1}`));
    expect(client.createProject).toHaveBeenCalledWith(
      { name: 'Mi nube', description: 'Fotos y archivos', alternativeIds: ['fotero', 'archivero'] },
      { csrfToken: 'a1' },
    );
    expect(await screen.findByText('Proyecto creado.')).toBeInTheDocument();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('validación local asociada a los campos, en puntos Unicode, y foco en el primer error', async () => {
    const client = emptyProjectsClient();
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(), projectsClient: client });
    await user.click(await screen.findByRole('button', { name: 'Crear proyecto' }));
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput()).toHaveAccessibleDescription(/entre 3 y 80 caracteres.*ahora tiene 0/i);
    expect(document.activeElement).toBe(nameInput());
    expect(screen.getByRole('group', { name: /Alternativas/ })).toHaveAccessibleDescription('Selecciona entre 1 y 10 alternativas.');

    await user.click(nameInput());
    await user.paste('😀'.repeat(81));
    await user.click(box('Gitero'));
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    expect(nameInput()).toHaveAccessibleDescription(/ahora tiene 81/);
    expect(nameInput()).not.toHaveAttribute('maxlength');
    expect(client.createProject).not.toHaveBeenCalled();

    await user.clear(nameInput());
    await user.paste('😀'.repeat(80));
    await user.click(descriptionInput());
    await user.paste('a'.repeat(1001));
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    expect(descriptionInput()).toHaveAccessibleDescription(/no puede superar 1000 caracteres \(ahora tiene 1001\)/);
    expect(document.activeElement).toBe(descriptionInput());
    expect(client.createProject).not.toHaveBeenCalled();
  });

  it('envío en curso: botón deshabilitado, sin doble envío', async () => {
    const pending = deferred();
    const client = emptyProjectsClient({ createProject: vi.fn(() => pending.promise), getProject: vi.fn(() => Promise.resolve(project())) });
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(), projectsClient: client });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    const busy = screen.getByRole('button', { name: 'Guardando…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(client.createProject).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(project()));
    await waitFor(() => expect(location()).toBe(`/proyectos/${P1}`));
  });

  it.each([
    [httpError(409, 'PROJECT_LIMIT_REACHED', 'Has alcanzado el máximo de 100 proyectos por cuenta.'), /máximo de 100/],
    [httpError(400, 'VALIDATION_ERROR', 'La selección incluye alternativas que no existen en el catálogo.'), /no existen en el catálogo/],
    [new AuthRequestError('network', 'No se pudo conectar con el servidor.'), /No se pudo conectar/],
  ])('error del servidor (%s): aviso enfocado, valores conservados y sin reintento', async (failure, text) => {
    const client = emptyProjectsClient({ createProject: vi.fn(() => Promise.reject(failure)) });
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(), projectsClient: client });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveTextContent(/siguen en el formulario/);
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(nameInput()).toHaveValue('  Mi nube  ');
    expect(descriptionInput()).toHaveValue('Fotos y archivos');
    expect(box('Fotero')).toBeChecked();
    expect(client.createProject).toHaveBeenCalledTimes(1);
    expect(location()).toBe('/proyectos/nuevo');
  });

  it('403 de CSRF: renueva, explica que no se guardó y no reenvía; el reenvío manual usa el token nuevo', async () => {
    const auth = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: USER_A, csrfToken: 'viejo' }).mockResolvedValue({ user: USER_A, csrfToken: 'nuevo' }),
    });
    const client = emptyProjectsClient({
      createProject: vi.fn().mockRejectedValueOnce(httpError(403, 'CSRF_INVALID', 'x')).mockResolvedValueOnce(project()),
      getProject: vi.fn(() => Promise.resolve(project())),
    });
    const { user } = renderApp('/proyectos/nuevo', { authClient: auth, projectsClient: client });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya se ha renovado. No se ha guardado ningún cambio/);
    expect(client.createProject).toHaveBeenCalledTimes(1);
    expect(nameInput()).toHaveValue('  Mi nube  ');
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() => expect(location()).toBe(`/proyectos/${P1}`));
    expect(client.createProject).toHaveBeenLastCalledWith(expect.any(Object), { csrfToken: 'nuevo' });
  });

  it('sesión caducada al guardar: pide entrar, recupera los valores para la misma cuenta y no reenvía solo', async () => {
    const client = emptyProjectsClient({
      createProject: vi.fn().mockRejectedValueOnce(httpError(401, 'UNAUTHENTICATED', 'x')).mockResolvedValueOnce(project()),
      getProject: vi.fn(() => Promise.resolve(project())),
    });
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(USER_A), projectsClient: client });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() => expect(location()).toBe('/entrar?siguiente=%2Fproyectos%2Fnuevo'));
    expect(within(main()).getByText(/tu sesión ha caducado/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Correo'), USER_A.email);
    await user.type(screen.getByLabelText('Contraseña'), 'una frase de paso larga');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(location()).toBe('/proyectos/nuevo'));
    expect(await screen.findByText(/hemos recuperado los datos/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('  Mi nube  ');
    expect(descriptionInput()).toHaveValue('Fotos y archivos');
    expect(box('Fotero')).toBeChecked();
    expect(client.createProject).toHaveBeenCalledTimes(1); // sin reintento automático
    expect(localStorage.length + sessionStorage.length).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() => expect(location()).toBe(`/proyectos/${P1}`));
    expect(client.createProject).toHaveBeenCalledTimes(2);
  });

  it('si entra otra cuenta tras caducar, no recibe el borrador de la anterior', async () => {
    const client = emptyProjectsClient({ createProject: vi.fn(() => Promise.reject(httpError(401, 'UNAUTHENTICATED', 'x'))) });
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(USER_A, { loginAs: USER_B }), projectsClient: client });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() => expect(location()).toBe('/entrar?siguiente=%2Fproyectos%2Fnuevo'));
    await user.type(screen.getByLabelText('Correo'), USER_B.email);
    await user.type(screen.getByLabelText('Contraseña'), 'una frase de paso larga');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(location()).toBe('/proyectos/nuevo'));
    expect(await screen.findByLabelText('Nombre')).toHaveValue('');
    expect(screen.queryByText(/hemos recuperado/i)).not.toBeInTheDocument();
  });

  it('Cancelar vuelve a la lista sin guardar', async () => {
    const client = emptyProjectsClient();
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(), projectsClient: client });
    await fillValid(user);
    await user.click(screen.getByRole('link', { name: 'Cancelar' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.createProject).not.toHaveBeenCalled();
  });

  it('teclado: Nombre → Descripción → casillas; Espacio marca y Enter envía', async () => {
    const client = emptyProjectsClient({ createProject: vi.fn(() => Promise.resolve(project())), getProject: vi.fn(() => Promise.resolve(project())) });
    const { user } = renderApp('/proyectos/nuevo', { authClient: signedIn(), projectsClient: client });
    (await screen.findByLabelText('Nombre')).focus();
    await user.keyboard('Teclado');
    await user.tab();
    expect(document.activeElement).toBe(descriptionInput());
    await user.tab();
    expect(document.activeElement).toBe(box('Archivero'));
    await user.keyboard(' ');
    expect(box('Archivero')).toBeChecked();
    nameInput().focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(client.createProject).toHaveBeenCalledWith({ name: 'Teclado', description: '', alternativeIds: ['archivero'] }, { csrfToken: 'a1' }));
  });
});

// ---------------------------------------------------------------------------
describe('identidad: formulario, escrituras pendientes y borrador por cuenta', () => {
  const VALUES_A = { name: 'Secreto de Ana', description: 'Notas privadas de Ana' };

  async function fillAsA(user) {
    await user.type(await screen.findByLabelText('Nombre'), VALUES_A.name);
    await user.type(screen.getByLabelText(/Descripción/), VALUES_A.description);
    await user.click(screen.getByRole('checkbox', { name: 'Fotero' }));
  }

  it('si la cuenta cambia de A a B con el formulario abierto, B ve un formulario vacío y solo envía lo suyo', async () => {
    const client = emptyProjectsClient({
      createProject: vi.fn(() => Promise.resolve(project({ id: P2, name: 'De Bea' }))),
      getProject: vi.fn(() => Promise.resolve(project({ id: P2, name: 'De Bea' }))),
    });
    const { user, authStore } = renderApp('/proyectos/nuevo', { authClient: signedIn(USER_A, { loginAs: USER_B }), projectsClient: client });
    await fillAsA(user);
    await act(async () => {
      await authStore.getState().login({ email: USER_B.email, password: 'una frase de paso larga' });
    });
    expect(await screen.findByLabelText('Nombre')).toHaveValue('');
    expect(screen.getByLabelText(/Descripción/)).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Fotero' })).not.toBeChecked();
    expect(screen.queryByDisplayValue(VALUES_A.name)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Nombre'), 'De Bea');
    await user.click(screen.getByRole('checkbox', { name: 'Gitero' }));
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() => expect(location()).toBe(`/proyectos/${P2}`));
    expect(client.createProject).toHaveBeenCalledTimes(1);
    expect(client.createProject).toHaveBeenCalledWith({ name: 'De Bea', description: '', alternativeIds: ['gitero'] }, { csrfToken: 'a2' });
  });

  it('resultado tardío de una escritura de A tras cambiar a B: se descarta sin navegar ni mostrar nada', async () => {
    const pending = deferred();
    const client = emptyProjectsClient({ createProject: vi.fn(() => pending.promise), getProject: vi.fn() });
    const { user, authStore } = renderApp('/proyectos/nuevo', { authClient: signedIn(USER_A, { loginAs: USER_B }), projectsClient: client });
    await fillAsA(user);
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await act(async () => {
      await authStore.getState().login({ email: USER_B.email, password: 'una frase de paso larga' });
    });
    await act(async () => pending.resolve(project({ name: VALUES_A.name })));
    expect(location()).toBe('/proyectos/nuevo');
    expect(screen.queryByText('Proyecto creado.')).not.toBeInTheDocument();
    expect(screen.queryByText(VALUES_A.name)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(client.getProject).not.toHaveBeenCalled();
    expect(takeProjectDraft(USER_A.id, '/proyectos/nuevo')).toBeNull(); // B no hereda el borrador de A
  });

  it('withCsrf: si al obtener el token la cuenta resulta ser otra, no ejecuta la escritura', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi
        .fn()
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' })
        .mockRejectedValueOnce(new AuthRequestError('network', 'Sin conexión')) // renovación fallida: sin token
        .mockResolvedValueOnce({ user: USER_B, csrfToken: 'b1' }), // otra pestaña entró como B
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    await expect(store.getState().withCsrf(() => Promise.reject(httpError(403, 'CSRF_INVALID', 'x')))).rejects.toMatchObject({ status: 403 });
    expect(store.getState().user).toEqual(USER_A);

    const write = vi.fn(() => Promise.resolve('escrito'));
    await expect(store.getState().withCsrf(write)).rejects.toMatchObject({ kind: 'stale' });
    expect(write).not.toHaveBeenCalled();
    expect(store.getState().user).toEqual(USER_B);
  });

  it('withCsrf: 403 cuya renovación tardía trae otra cuenta → stale, sin mensaje de «renovado» ni reenvío', async () => {
    const renewal = deferred();
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }).mockReturnValueOnce(renewal.promise),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    const write = vi.fn(() => Promise.reject(httpError(403, 'CSRF_INVALID', 'x')));
    const attempt = store.getState().withCsrf(write);
    renewal.resolve({ user: USER_B, csrfToken: 'b1' });
    await expect(attempt).rejects.toMatchObject({ kind: 'stale' });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('al entrar B directamente en su lista se descarta el borrador de A, sin visitar formularios', async () => {
    saveProjectDraft({ userId: USER_A.id, path: '/proyectos/nuevo', values: { ...VALUES_A, alternativeIds: ['fotero'] } });
    renderApp('/proyectos', { authClient: signedIn(USER_B) });
    expect(await screen.findByRole('heading', { name: 'Aún no tienes proyectos' })).toBeInTheDocument();
    expect(takeProjectDraft(USER_A.id, '/proyectos/nuevo')).toBeNull();
  });

  it('la misma cuenta conserva su borrador; salir explícitamente lo elimina', async () => {
    saveProjectDraft({ userId: USER_A.id, path: '/proyectos/nuevo', values: { ...VALUES_A, alternativeIds: ['fotero'] } });
    const { user } = renderApp('/proyectos', { authClient: signedIn(USER_A) });
    expect(await screen.findByRole('heading', { name: 'Aún no tienes proyectos' })).toBeInTheDocument();
    expect(takeProjectDraft(USER_A.id, '/proyectos/nuevo')).toMatchObject({ name: VALUES_A.name });
    await user.click(within(banner()).getByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(location()).toBe('/'));
    expect(takeProjectDraft(USER_A.id, '/proyectos/nuevo')).toBeNull();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('editar proyecto', () => {
  it('precarga, guarda solo lo editado y conserva la selección (no se reenvía si no cambia)', async () => {
    const client = emptyProjectsClient({
      getProject: vi.fn(() => Promise.resolve(RETIRED)),
      updateProject: vi.fn(() => Promise.resolve({ ...RETIRED, name: 'Nube editada' })),
    });
    const { user } = renderApp(`/proyectos/${P1}/editar`, { authClient: signedIn(), projectsClient: client });
    const name = await screen.findByLabelText('Nombre');
    expect(name).toHaveValue('Mi nube');
    const selected = screen.getByRole('list', { name: 'Alternativas seleccionadas' });
    expect(within(selected).getByText('No disponible')).toBeInTheDocument();
    expect(within(selected).getByText('retirada-vieja')).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, 'Nube editada');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(location()).toBe(`/proyectos/${P1}`));
    expect(client.updateProject).toHaveBeenCalledWith(P1, { name: 'Nube editada', description: 'Fotos y archivos' }, { csrfToken: 'a1' });
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
  });

  it('una selección nueva exige quitar la retirada; quitándola se envía la selección completa', async () => {
    const client = emptyProjectsClient({
      getProject: vi.fn(() => Promise.resolve(RETIRED)),
      updateProject: vi.fn(() => Promise.resolve(project())),
    });
    const { user } = renderApp(`/proyectos/${P1}/editar`, { authClient: signedIn(), projectsClient: client });
    await user.click(await screen.findByRole('checkbox', { name: 'Gitero' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByRole('group', { name: /Alternativas/ })).toHaveAccessibleDescription(/Quita las alternativas no disponibles/);
    expect(client.updateProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Quitar No disponible (retirada-vieja)' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(client.updateProject).toHaveBeenCalledWith(
        P1,
        { name: 'Mi nube', description: 'Fotos y archivos', alternativeIds: ['archivero', 'gitero'] },
        { csrfToken: 'a1' },
      ),
    );
  });

  it('404 al guardar (borrado o ajeno): explica y conserva valores', async () => {
    const client = emptyProjectsClient({
      getProject: vi.fn(() => Promise.resolve(project())),
      updateProject: vi.fn(() => Promise.reject(httpError(404, 'NOT_FOUND', 'El proyecto no existe.'))),
    });
    const { user } = renderApp(`/proyectos/${P1}/editar`, { authClient: signedIn(), projectsClient: client });
    await user.type(await screen.findByLabelText('Nombre'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no existe o no pertenece a tu cuenta/);
    expect(screen.getByLabelText('Nombre')).toHaveValue('Mi nube 2');
  });

  it('proyecto inexistente o ajeno: mismo «no encontrado»', async () => {
    renderApp(`/proyectos/${P2}/editar`, {
      authClient: signedIn(),
      projectsClient: emptyProjectsClient({ getProject: vi.fn(() => Promise.reject(httpError(404, 'NOT_FOUND', 'x'))) }),
    });
    expect(await screen.findByRole('heading', { name: 'Proyecto no encontrado' })).toBeInTheDocument();
    expect(screen.getByText('Este proyecto no existe o no pertenece a tu cuenta.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('detalle y borrado', () => {
  it('detalle: datos, enlaces a alternativas del catálogo, retirada marcada y acciones', async () => {
    renderApp(`/proyectos/${P1}`, {
      authClient: signedIn(),
      projectsClient: emptyProjectsClient({ getProject: vi.fn(() => Promise.resolve(RETIRED)) }),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi nube' })).toBeInTheDocument();
    expect(screen.getByText('Fotos y archivos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Archivero' })).toHaveAttribute('href', '/alternativas/archivero');
    expect(screen.getByText('retirada-vieja')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /retirada-vieja/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', `/proyectos/${P1}/editar`);
    expect(document.title).toBe('Mi nube · NoMoreSaaS');
  });

  it('Cancelar la confirmación no llama a la API y devuelve el foco', async () => {
    const client = emptyProjectsClient({ getProject: vi.fn(() => Promise.resolve(project())), deleteProject: vi.fn() });
    const { user } = renderApp(`/proyectos/${P1}`, { authClient: signedIn(), projectsClient: client });
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const heading = screen.getByRole('heading', { name: '¿Eliminar «Mi nube»?' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('region', { name: '¿Eliminar «Mi nube»?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(client.deleteProject).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Eliminar' })));
    expect(screen.getByRole('heading', { level: 1, name: 'Mi nube' })).toBeInTheDocument();
  });

  it('confirmar elimina con CSRF, vuelve a la lista y anuncia el resultado', async () => {
    const client = emptyProjectsClient({
      getProject: vi.fn(() => Promise.resolve(project())),
      deleteProject: vi.fn(() => Promise.resolve()),
    });
    const { user } = renderApp(`/proyectos/${P1}`, { authClient: signedIn(), projectsClient: client });
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar «Mi nube»' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.deleteProject).toHaveBeenCalledWith(P1, { csrfToken: 'a1' });
    // Aviso genérico: el estado de navegación no lleva el nombre del proyecto.
    expect(await screen.findByText('Proyecto eliminado.')).toBeInTheDocument();
    expect(screen.queryByText(/Mi nube/)).not.toBeInTheDocument();
  });

  it('fallo al eliminar: mantiene el detalle, lo explica y permite reintentar', async () => {
    const client = emptyProjectsClient({
      getProject: vi.fn(() => Promise.resolve(project())),
      deleteProject: vi
        .fn()
        .mockRejectedValueOnce(new AuthRequestError('network', 'No se pudo conectar con el servidor.'))
        .mockResolvedValueOnce(),
    });
    const { user } = renderApp(`/proyectos/${P1}`, { authClient: signedIn(), projectsClient: client });
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar «Mi nube»' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo conectar con el servidor. El proyecto no se ha eliminado.');
    expect(location()).toBe(`/proyectos/${P1}`);
    await user.click(screen.getByRole('button', { name: 'Eliminar «Mi nube»' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.deleteProject).toHaveBeenCalledTimes(2);
  });

  it('detalle de un proyecto inexistente o ajeno: «no encontrado» sin confirmar existencia', async () => {
    renderApp(`/proyectos/${P2}`, {
      authClient: signedIn(),
      projectsClient: emptyProjectsClient({ getProject: vi.fn(() => Promise.reject(httpError(404, 'NOT_FOUND', 'x'))) }),
    });
    expect(await screen.findByRole('heading', { name: 'Proyecto no encontrado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a mis proyectos' })).toHaveAttribute('href', '/proyectos');
  });
});
