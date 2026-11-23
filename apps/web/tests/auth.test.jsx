import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequestError, fetchSession, login, logout, register } from '../src/api/auth.js';
import { RequireAuth, authPathFor, safeRedirectTarget } from '../src/components/RequireAuth.jsx';
import { AUTH_STATUS, AuthProvider, createAuthStore } from '../src/store/auth.js';
import { anonymousAuthClient, renderApp } from './helpers.jsx';

const USER_A = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com' };
const USER_B = { id: '22222222-2222-4222-8222-222222222222', email: 'bea@example.com' };
const STRONG = 'una frase de paso larga';
// 65 emoji de un solo punto Unicode = 65 puntos, 130 unidades UTF-16.
const EMOJI_65 = '😀'.repeat(65);

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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

const location = () => screen.getByTestId('location').textContent;
// jsdom no restringe el rol banner a la cabecera del sitio: se localiza por clase.
const banner = () => document.querySelector('.site-header');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe('cliente HTTP de auth', () => {
  function jsonResponse(status, body, headers = {}) {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  it('GET de sesión same-origin, sin caché y con DTO validado', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { user: { ...USER_A, extra: 'x' }, csrfToken: 't1' })));
    vi.stubGlobal('fetch', fetchMock);
    const session = await fetchSession();
    expect(session).toEqual({ user: USER_A, csrfToken: 't1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/session');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(init.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('las mutaciones envían JSON, el CSRF actual y la contraseña sin modificar', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(201, { user: USER_A, csrfToken: 't2' })));
    vi.stubGlobal('fetch', fetchMock);
    const password = `  ${EMOJI_65}  `;
    await register({ email: USER_A.email, password, csrfToken: 'tok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/register');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'tok' });
    expect(JSON.parse(init.body)).toEqual({ email: USER_A.email, password });
  });

  it('logout 204 sin cuerpo y errores con el envelope del servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos.' } }, { 'Retry-After': '60' }),
        )
        .mockResolvedValueOnce(new Response('<html>', { status: 502 })),
    );
    await expect(logout({ csrfToken: 't' })).resolves.toBeUndefined();
    await expect(login({ email: 'a@b.es', password: STRONG, csrfToken: 't' })).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Demasiados intentos.',
      retryAfterSeconds: 60,
    });
    await expect(login({ email: 'a@b.es', password: STRONG, csrfToken: 't' })).rejects.toMatchObject({ kind: 'http', status: 502 });
  });

  it('distingue fallo de red y respuesta sin el formato esperado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed')).mockResolvedValueOnce(jsonResponse(200, { user: null })));
    await expect(fetchSession()).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchSession()).rejects.toMatchObject({ kind: 'invalid' });
  });
});

// ---------------------------------------------------------------------------
describe('store de sesión', () => {
  it('comparte una única petición durante la carga', async () => {
    const client = anonymousAuthClient();
    const store = createAuthStore({ client });
    const first = store.getState().ensureSession();
    const second = store.getState().ensureSession();
    expect(store.getState().status).toBe(AUTH_STATUS.loading);
    await Promise.all([first, second]);
    await store.getState().ensureSession();
    expect(client.fetchSession).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe(AUTH_STATUS.anonymous);
  });

  it('descarta una respuesta de sesión obsoleta llegada tras logout', async () => {
    const stale = deferred();
    const client = anonymousAuthClient({
      fetchSession: vi
        .fn()
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' })
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValue({ user: null, csrfToken: 'anon2' }),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    expect(store.getState().user).toEqual(USER_A);

    const reload = store.getState().reloadSession(); // queda pendiente
    const signal = client.fetchSession.mock.calls[1][0].signal;
    await store.getState().logout();
    expect(client.logout).toHaveBeenCalledWith({ csrfToken: 'a1' });
    expect(signal.aborted).toBe(true);

    stale.resolve({ user: USER_A, csrfToken: 'a1' });
    await reload;
    await waitFor(() => expect(client.fetchSession).toHaveBeenCalledTimes(3));
    expect(store.getState().status).toBe(AUTH_STATUS.anonymous);
    expect(store.getState().user).toBeNull();
  });

  it('descarta una carga anónima obsoleta que llega después del login', async () => {
    const stale = deferred();
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: null, csrfToken: 'p1' }).mockReturnValueOnce(stale.promise),
      login: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    const reload = store.getState().reloadSession();
    await store.getState().login({ email: USER_A.email, password: STRONG });
    stale.resolve({ user: null, csrfToken: 'viejo' });
    await reload;
    expect(store.getState().user).toEqual(USER_A);
    expect(client.login).toHaveBeenCalledWith({ email: USER_A.email, password: STRONG, csrfToken: 'p1' });
  });

  it('error de carga y reintento explícito', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi
        .fn()
        .mockRejectedValueOnce(new AuthRequestError('network', 'Sin conexión'))
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    expect(store.getState()).toMatchObject({ status: AUTH_STATUS.error, user: null });
    expect(store.getState().error.message).toBe('Sin conexión');
    await store.getState().reloadSession();
    expect(store.getState()).toMatchObject({ status: AUTH_STATUS.authenticated, user: USER_A, error: null });
  });

  it('ante 403 renueva el token pero no reenvía la escritura', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: null, csrfToken: 'viejo' }).mockResolvedValue({ user: null, csrfToken: 'nuevo' }),
      login: vi
        .fn()
        .mockRejectedValueOnce(httpError(403, 'CSRF_INVALID', 'token'))
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    await expect(store.getState().login({ email: USER_A.email, password: STRONG })).rejects.toMatchObject({ status: 403 });
    expect(client.login).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(client.fetchSession).toHaveBeenCalledTimes(2));
    await store.getState().login({ email: USER_A.email, password: STRONG });
    expect(client.login).toHaveBeenLastCalledWith({ email: USER_A.email, password: STRONG, csrfToken: 'nuevo' });
  });

  it('logout, 401 y cambio de usuario limpian los datos privados registrados', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }).mockResolvedValue({ user: null, csrfToken: 'p' }),
      login: vi
        .fn()
        .mockResolvedValueOnce({ user: USER_B, csrfToken: 'b1' })
        .mockResolvedValueOnce({ user: USER_B, csrfToken: 'b2' }),
      logout: vi.fn().mockRejectedValueOnce(httpError(401, 'UNAUTHENTICATED', 'x')),
    });
    const store = createAuthStore({ client });
    const reset = vi.fn();
    const unsubscribe = store.getState().onPrivateReset(reset);
    await store.getState().ensureSession();

    await store.getState().login({ email: USER_B.email, password: STRONG }); // A → B
    expect(reset).toHaveBeenCalledTimes(1);
    await store.getState().login({ email: USER_B.email, password: STRONG }); // mismo usuario
    expect(reset).toHaveBeenCalledTimes(1);

    await store.getState().logout(); // 401: la sesión ya no existía
    expect(reset).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({ status: AUTH_STATUS.anonymous, user: null });

    await store.getState().login({ email: USER_B.email, password: STRONG }).catch(() => {});
    store.getState().expireSession();
    expect(store.getState().user).toBeNull();
    unsubscribe();
  });

  it('una recarga fallida que pierde la identidad de A limpia sus datos privados; después entra B', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi
        .fn()
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' })
        .mockRejectedValueOnce(new AuthRequestError('network', 'Sin conexión'))
        .mockResolvedValueOnce({ user: null, csrfToken: 'p2' }),
      login: vi.fn(() => Promise.resolve({ user: USER_B, csrfToken: 'b1' })),
    });
    const store = createAuthStore({ client });
    const reset = vi.fn();
    store.getState().onPrivateReset(reset);
    await store.getState().ensureSession();
    expect(store.getState().user).toEqual(USER_A);

    await store.getState().reloadSession();
    expect(store.getState()).toMatchObject({ status: AUTH_STATUS.error, user: null });
    expect(reset).toHaveBeenCalledTimes(1);

    await store.getState().login({ email: USER_B.email, password: STRONG });
    expect(client.login).toHaveBeenCalledWith({ email: USER_B.email, password: STRONG, csrfToken: 'p2' });
    expect(store.getState().user).toEqual(USER_B);
    expect(reset).toHaveBeenCalledTimes(1); // sin identidad previa que limpiar
  });

  it('403 con renovación fallida: mensaje honesto, sin reenvío; el siguiente envío renueva antes', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi
        .fn()
        .mockResolvedValueOnce({ user: null, csrfToken: 'viejo' })
        .mockRejectedValueOnce(new AuthRequestError('network', 'Sin conexión'))
        .mockResolvedValueOnce({ user: null, csrfToken: 'nuevo' }),
      login: vi
        .fn()
        .mockRejectedValueOnce(httpError(403, 'CSRF_INVALID', 'x'))
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    const error = await store.getState().login({ email: USER_A.email, password: STRONG }).catch((e) => e);
    expect(error.message).toMatch(/no se pudo renovar/);
    expect(error.message).not.toMatch(/ya se ha renovado/);
    expect(client.login).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe(AUTH_STATUS.anonymous);

    await store.getState().login({ email: USER_A.email, password: STRONG });
    expect(client.fetchSession).toHaveBeenCalledTimes(3);
    expect(client.login).toHaveBeenLastCalledWith({ email: USER_A.email, password: STRONG, csrfToken: 'nuevo' });
  });

  it('403 con renovación tardía: no anuncia la renovación hasta confirmarla ni reenvía', async () => {
    const renewal = deferred();
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: null, csrfToken: 'viejo' }).mockReturnValueOnce(renewal.promise),
      login: vi.fn().mockRejectedValueOnce(httpError(403, 'CSRF_INVALID', 'x')),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    let outcome = null;
    const attempt = store
      .getState()
      .login({ email: USER_A.email, password: STRONG })
      .catch((e) => {
        outcome = e;
      });
    await waitFor(() => expect(client.fetchSession).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(outcome).toBeNull(); // sin mensaje mientras la renovación sigue pendiente
    renewal.resolve({ user: null, csrfToken: 'nuevo' });
    await attempt;
    expect(outcome.message).toMatch(/ya se ha renovado/);
    expect(client.login).toHaveBeenCalledTimes(1);
  });

  it('un fallo de red al salir conserva la identidad', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })),
      logout: vi.fn(() => Promise.reject(new AuthRequestError('network', 'Sin conexión'))),
    });
    const store = createAuthStore({ client });
    await store.getState().ensureSession();
    await expect(store.getState().logout()).rejects.toMatchObject({ kind: 'network' });
    expect(store.getState().user).toEqual(USER_A);
  });

  it('no persiste estado, token ni contraseña', async () => {
    const client = anonymousAuthClient({
      login: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'secreto-csrf' })),
    });
    const store = createAuthStore({ client });
    await store.getState().login({ email: USER_A.email, password: STRONG });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    const serialized = JSON.stringify(store.getState());
    expect(serialized).not.toContain(STRONG);
    expect(serialized).not.toContain('secreto-csrf');
  });
});

// ---------------------------------------------------------------------------
// Desde T005 (contracts/ui.md): tras entrar se va a /proyectos o a una ruta
// privada interna validada; cualquier otro destino cae en /proyectos.
describe('redirección interna segura', () => {
  it.each([
    ['/proyectos/nuevo', '/proyectos/nuevo'],
    ['/proyectos/11111111-1111-4111-8111-111111111111/editar?x=1#a', '/proyectos/11111111-1111-4111-8111-111111111111/editar?x=1#a'],
    ['/proyectos', '/proyectos'],
    ['/comparar', '/proyectos'],
    ['/proyectosx', '/proyectos'],
    ['//evil.example', '/proyectos'],
    ['https://evil.example/proyectos', '/proyectos'],
    ['/\\evil.example', '/proyectos'],
    ['javascript:alert(1)', '/proyectos'],
    ['/entrar', '/proyectos'],
    ['/registro?siguiente=/x', '/proyectos'],
    ['/proyectos/a\nb', '/proyectos'],
    [null, '/proyectos'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirectTarget(input)).toBe(expected);
  });

  it('authPathFor solo añade destinos privados distintos de /proyectos', () => {
    expect(authPathFor('/entrar', '/proyectos/nuevo')).toBe('/entrar?siguiente=%2Fproyectos%2Fnuevo');
    expect(authPathFor('/entrar', '/proyectos')).toBe('/entrar');
    expect(authPathFor('/entrar', '/comparar')).toBe('/entrar');
    expect(authPathFor('/entrar', '//evil.example')).toBe('/entrar');
  });
});

// ---------------------------------------------------------------------------
describe('cabecera y estados de sesión', () => {
  it('visitante: Entrar y Crear cuenta, sin enlaces a rutas privadas', async () => {
    renderApp('/');
    const header = banner();
    expect(await within(header).findByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar');
    expect(within(header).getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', '/registro');
    expect(within(header).queryByRole('link', { name: /proyectos/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/proyectos"]')).toBeNull();
  });

  it('mientras carga no muestra identidad ni acciones de cuenta', async () => {
    const pending = deferred();
    renderApp('/', { authClient: anonymousAuthClient({ fetchSession: vi.fn(() => pending.promise) }) });
    await screen.findByRole('searchbox');
    expect(within(banner()).queryByRole('link', { name: 'Entrar' })).not.toBeInTheDocument();
    expect(within(banner()).queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
    await act(async () => pending.resolve({ user: USER_A, csrfToken: 'a1' }));
    expect(within(banner()).getByText(USER_A.email)).toBeInTheDocument();
  });

  it('error de sesión con reintento', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockRejectedValueOnce(new AuthRequestError('network', 'x')).mockResolvedValueOnce({ user: null, csrfToken: 'p' }),
    });
    const { user } = renderApp('/', { authClient: client });
    await user.click(await within(banner()).findByRole('button', { name: 'Reintentar' }));
    expect(await within(banner()).findByRole('link', { name: 'Entrar' })).toBeInTheDocument();
    expect(client.fetchSession).toHaveBeenCalledTimes(2);
  });

  it('desde una página pública, Entrar no añade destino (se irá a /proyectos)', async () => {
    renderApp('/saas/drive');
    expect(await within(banner()).findByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar');
  });

  it('autenticado: enlace Mis proyectos en la cabecera', async () => {
    renderApp('/', {
      authClient: anonymousAuthClient({ fetchSession: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })) }),
    });
    expect(await within(banner()).findByRole('link', { name: 'Mis proyectos' })).toHaveAttribute('href', '/proyectos');
  });

  it('autenticado: correo y Salir; al salir vuelve al catálogo, anuncia y limpia identidad', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }).mockResolvedValue({ user: null, csrfToken: 'p2' }),
    });
    const { user, authStore } = renderApp('/saas/drive', { authClient: client });
    const reset = vi.fn();
    authStore.getState().onPrivateReset(reset);
    expect(await within(banner()).findByText(USER_A.email)).toBeInTheDocument();
    await user.click(within(banner()).getByRole('button', { name: 'Salir' }));
    expect(await within(banner()).findByRole('link', { name: 'Entrar' })).toBeInTheDocument();
    expect(client.logout).toHaveBeenCalledWith({ csrfToken: 'a1' });
    expect(reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(location()).toBe('/'));
    expect(within(banner()).getByText('Has cerrado sesión.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));
    expect(within(banner()).queryByText(USER_A.email)).not.toBeInTheDocument();
  });

  it('si salir falla, lo explica y mantiene la sesión', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })),
      logout: vi.fn(() => Promise.reject(new AuthRequestError('network', 'No se pudo conectar con el servidor.'))),
    });
    const { user } = renderApp('/', { authClient: client });
    await user.click(await within(banner()).findByRole('button', { name: 'Salir' }));
    expect(await within(banner()).findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor.');
    expect(within(banner()).getByText(USER_A.email)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('formulario de entrada', () => {
  const emailInput = () => screen.getByLabelText('Correo');
  const passwordInput = () => screen.getByLabelText('Contraseña');

  it('campos etiquetados, autocomplete correcto y sin maxLength', async () => {
    renderApp('/entrar');
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute('type', 'email');
    expect(emailInput()).toHaveAttribute('autocomplete', 'username');
    expect(passwordInput()).toHaveAttribute('type', 'password');
    expect(passwordInput()).toHaveAttribute('autocomplete', 'current-password');
    expect(passwordInput()).not.toHaveAttribute('maxlength');
    expect(emailInput()).not.toHaveAttribute('maxlength');
    expect(document.title).toBe('Entrar · NoMoreSaaS');
    expect(screen.queryByText(/olvidaste|recuperar|github/i)).not.toBeInTheDocument();
    // Desde 006 Google solo aparece si la API lo confirma; aquí no está configurado: sin botón.
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  });

  it('login correcto: redirige a /proyectos y muestra la identidad', async () => {
    const client = anonymousAuthClient({ login: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })) });
    const { user } = renderApp('/entrar', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), '  Ana@Example.com ');
    await user.type(passwordInput(), STRONG);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.login).toHaveBeenCalledWith({ email: 'Ana@Example.com', password: STRONG, csrfToken: 'csrf-anon' });
    expect(within(banner()).getByText(USER_A.email)).toBeInTheDocument();
    expect(within(banner()).getByText(`Has entrado como ${USER_A.email}.`)).toBeInTheDocument();
  });

  it('respeta un destino interno y rechaza uno externo', async () => {
    const client = anonymousAuthClient({ login: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })) });
    const first = renderApp('/entrar?siguiente=%2Fproyectos%2Fnuevo', { authClient: client });
    await first.user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await first.user.type(passwordInput(), STRONG);
    await first.user.keyboard('{Enter}');
    await waitFor(() => expect(location()).toBe('/proyectos/nuevo'));
    first.unmount();

    const second = renderApp('/entrar?siguiente=https%3A%2F%2Fevil.example', { authClient: anonymousAuthClient({ login: client.login }) });
    await second.user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await second.user.type(passwordInput(), STRONG);
    await second.user.keyboard('{Enter}');
    await waitFor(() => expect(location()).toBe('/proyectos'));
  });

  it('credenciales incorrectas: aviso genérico enfocado y valores conservados', async () => {
    const client = anonymousAuthClient({
      login: vi.fn(() => Promise.reject(httpError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.'))),
    });
    const { user } = renderApp('/entrar', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.type(passwordInput(), 'otra contraseña larga');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Correo o contraseña incorrectos.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(emailInput()).toHaveValue(USER_A.email);
    expect(passwordInput()).toHaveValue('otra contraseña larga');
    expect(location()).toBe('/entrar');
  });

  it('validación local asociada a los campos y foco en el primero inválido', async () => {
    const client = anonymousAuthClient();
    const { user } = renderApp('/entrar', { authClient: client });
    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(emailInput()).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput()).toHaveAccessibleDescription('Introduce tu correo.');
    expect(passwordInput()).toHaveAccessibleDescription('Introduce tu contraseña.');
    expect(document.activeElement).toBe(emailInput());
    expect(client.login).not.toHaveBeenCalled();

    await user.type(emailInput(), 'sin-arroba');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(emailInput()).toHaveAccessibleDescription(/correo válido/);
  });

  it('un envío en curso no se duplica y el botón indica el estado', async () => {
    const pending = deferred();
    const client = anonymousAuthClient({ login: vi.fn(() => pending.promise) });
    const { user } = renderApp('/entrar', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.type(passwordInput(), STRONG);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    const busy = screen.getByRole('button', { name: 'Entrando…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(client.login).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ user: USER_A, csrfToken: 'a1' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
  });

  it('403 de CSRF: explica, renueva y no reenvía; el reenvío manual usa el token nuevo', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockResolvedValueOnce({ user: null, csrfToken: 'viejo' }).mockResolvedValue({ user: null, csrfToken: 'nuevo' }),
      login: vi
        .fn()
        .mockRejectedValueOnce(httpError(403, 'CSRF_INVALID', 'x'))
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }),
    });
    const { user } = renderApp('/entrar', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.type(passwordInput(), STRONG);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/vuelve a enviar/i);
    expect(client.login).toHaveBeenCalledTimes(1);
    expect(passwordInput()).toHaveValue(STRONG);
    await waitFor(() => expect(client.fetchSession).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.login).toHaveBeenLastCalledWith(expect.objectContaining({ csrfToken: 'nuevo' }));
  });

  it('403 con renovación fallida en el formulario: aviso recuperable y valores conservados', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi
        .fn()
        .mockResolvedValueOnce({ user: null, csrfToken: 'viejo' })
        .mockRejectedValueOnce(new AuthRequestError('network', 'Sin conexión'))
        .mockResolvedValueOnce({ user: null, csrfToken: 'nuevo' }),
      login: vi
        .fn()
        .mockRejectedValueOnce(httpError(403, 'CSRF_INVALID', 'x'))
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }),
    });
    const { user } = renderApp('/entrar', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.type(passwordInput(), STRONG);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo renovar/i);
    expect(client.login).toHaveBeenCalledTimes(1);
    expect(emailInput()).toHaveValue(USER_A.email);
    expect(passwordInput()).toHaveValue(STRONG);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.login).toHaveBeenLastCalledWith(expect.objectContaining({ csrfToken: 'nuevo' }));
  });

  it('teclado: correo → contraseña → Entrar y Enter envía', async () => {
    const client = anonymousAuthClient({ login: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })) });
    const { user } = renderApp('/entrar', { authClient: client });
    const email = await screen.findByLabelText('Correo');
    email.focus();
    await user.keyboard(USER_A.email);
    await user.tab();
    expect(document.activeElement).toBe(passwordInput());
    await user.keyboard(STRONG);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Entrar' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(location()).toBe('/proyectos'));
  });

  it('un usuario ya autenticado que abre /entrar va a su destino', async () => {
    renderApp('/entrar?siguiente=%2Fproyectos%2Fnuevo', {
      authClient: anonymousAuthClient({ fetchSession: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })) }),
    });
    await waitFor(() => expect(location()).toBe('/proyectos/nuevo'));
  });
});

// ---------------------------------------------------------------------------
describe('formulario de registro', () => {
  const emailInput = () => screen.getByLabelText('Correo');
  const passwordInput = () => screen.getByLabelText('Contraseña');

  it('autocomplete de alta, ayuda asociada y enlace a Entrar', async () => {
    renderApp('/registro');
    expect(await screen.findByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute('autocomplete', 'email');
    expect(passwordInput()).toHaveAttribute('autocomplete', 'new-password');
    expect(passwordInput()).toHaveAccessibleDescription('Usa una frase de al menos 15 caracteres.');
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar');
  });

  it('acepta 65 emoji (65 puntos Unicode) y envía la contraseña sin trim ni truncado', async () => {
    const client = anonymousAuthClient({ register: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })) });
    const { user } = renderApp('/registro', { authClient: client });
    const password = ` ${EMOJI_65} `;
    expect(password.length).toBe(132); // unidades UTF-16 > 128
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.click(passwordInput());
    await user.paste(password);
    expect(passwordInput()).toHaveValue(password);
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.register).toHaveBeenCalledWith({ email: USER_A.email, password, csrfToken: 'csrf-anon' });
    expect(within(banner()).getByText(`Cuenta creada. Has entrado como ${USER_A.email}.`)).toBeInTheDocument();
  });

  it('rechaza localmente menos de 15 y más de 128 puntos Unicode', async () => {
    const client = anonymousAuthClient();
    const { user } = renderApp('/registro', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.click(passwordInput());
    await user.paste('😀'.repeat(14));
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(passwordInput()).toHaveAttribute('aria-invalid', 'true');
    expect(passwordInput()).toHaveAccessibleDescription(/al menos 15 caracteres \(ahora tiene 14\)/);
    expect(document.activeElement).toBe(passwordInput());

    await user.clear(passwordInput());
    await user.paste('a'.repeat(129));
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(passwordInput()).toHaveAccessibleDescription(/no puede superar 128 caracteres \(ahora tiene 129\)/);
    expect(passwordInput()).toHaveValue('a'.repeat(129));
    expect(client.register).not.toHaveBeenCalled();
  });

  it('correo no disponible (409) se asocia al campo y conserva valores', async () => {
    const client = anonymousAuthClient({
      register: vi.fn(() => Promise.reject(httpError(409, 'EMAIL_UNAVAILABLE', 'No es posible registrar una cuenta con ese correo.'))),
    });
    const { user } = renderApp('/registro', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.type(passwordInput(), STRONG);
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(emailInput()).toHaveAccessibleDescription('No es posible registrar una cuenta con ese correo.'));
    expect(document.activeElement).toBe(emailInput());
    expect(passwordInput()).toHaveValue(STRONG);
    await user.type(emailInput(), 'x');
    expect(emailInput()).not.toHaveAttribute('aria-invalid');
  });

  it('límite 429 y fallo de red se muestran con aviso recuperable', async () => {
    const client = anonymousAuthClient({
      register: vi
        .fn()
        .mockRejectedValueOnce(httpError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'))
        .mockRejectedValueOnce(new AuthRequestError('network', 'No se pudo conectar con el servidor.'))
        .mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }),
    });
    const { user } = renderApp('/registro', { authClient: client });
    await user.type(await screen.findByLabelText('Correo'), USER_A.email);
    await user.type(passwordInput(), STRONG);
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No se pudo conectar'));
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.register).toHaveBeenCalledTimes(3);
  });

  it('si la sesión inicial falló, obtiene un token antes de registrar', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockRejectedValueOnce(new AuthRequestError('network', 'x')).mockResolvedValueOnce({ user: null, csrfToken: 't2' }),
      register: vi.fn(() => Promise.resolve({ user: USER_A, csrfToken: 'a1' })),
    });
    const { user } = renderApp('/registro', { authClient: client });
    await within(banner()).findByRole('button', { name: 'Reintentar' });
    await user.type(emailInput(), USER_A.email);
    await user.type(passwordInput(), STRONG);
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(location()).toBe('/proyectos'));
    expect(client.register).toHaveBeenCalledWith(expect.objectContaining({ csrfToken: 't2' }));
  });
});

// ---------------------------------------------------------------------------
describe('guard RequireAuth', () => {
  function renderGuard(client, path = '/proyectos/privado?vista=1') {
    const store = createAuthStore({ client });
    const user = userEvent.setup();
    render(
      <AuthProvider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/proyectos/privado"
              element={
                <RequireAuth>
                  <p>Contenido privado</p>
                </RequireAuth>
              }
            />
            <Route path="/entrar" element={<p>Página de entrada</p>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthProvider>,
    );
    return { store, user };
  }

  it('espera a la sesión sin mostrar contenido privado', async () => {
    const pending = deferred();
    renderGuard(anonymousAuthClient({ fetchSession: vi.fn(() => pending.promise) }));
    expect(screen.getByText('Comprobando tu sesión…').closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ user: USER_A, csrfToken: 'a1' }));
    expect(screen.getByText('Contenido privado')).toBeInTheDocument();
  });

  it('visitante: redirige a /entrar conservando el destino', async () => {
    renderGuard(anonymousAuthClient());
    expect(await screen.findByText('Página de entrada')).toBeInTheDocument();
    expect(location()).toBe('/entrar?siguiente=%2Fproyectos%2Fprivado%3Fvista%3D1');
  });

  it('error de sesión con reintento y sin redirigir', async () => {
    const client = anonymousAuthClient({
      fetchSession: vi.fn().mockRejectedValueOnce(new AuthRequestError('network', 'Sin conexión')).mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }),
    });
    const { user } = renderGuard(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
    expect(location()).toBe('/proyectos/privado?vista=1');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Contenido privado')).toBeInTheDocument();
  });

  it('al caducar la sesión retira el contenido privado', async () => {
    const { store } = renderGuard(anonymousAuthClient({ fetchSession: vi.fn().mockResolvedValueOnce({ user: USER_A, csrfToken: 'a1' }).mockResolvedValue({ user: null, csrfToken: 'p' }) }));
    expect(await screen.findByText('Contenido privado')).toBeInTheDocument();
    act(() => store.getState().expireSession());
    expect(await screen.findByText('Página de entrada')).toBeInTheDocument();
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();
  });
});
