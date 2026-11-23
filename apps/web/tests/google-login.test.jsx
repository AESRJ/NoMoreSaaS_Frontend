import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequestError, fetchProviders, startGoogleLogin } from '../src/api/auth.js';
import { anonymousAuthClient, renderApp } from './helpers.jsx';

// «Continuar con Google» en /entrar y /registro con clientes simulados (sin red
// ni Google real). La prueba viva con Google requiere credenciales reales.
const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s';
const location = () => screen.getByTestId('location').textContent;
const enabledClient = (overrides = {}) =>
  anonymousAuthClient({
    fetchProviders: vi.fn(() => Promise.resolve({ google: { enabled: true } })),
    startGoogleLogin: vi.fn(() => Promise.resolve(GOOGLE_URL)),
    ...overrides,
  });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cliente de proveedores', () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('fetchProviders solo copia el indicador booleano', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { google: { enabled: true, clientId: 'x' } }))));
    await expect(fetchProviders()).resolves.toEqual({ google: { enabled: true } });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { google: { enabled: 'si' } }))));
    await expect(fetchProviders()).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('startGoogleLogin envía {} con CSRF y rechaza URLs que no sean de accounts.google.com', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { authorizationUrl: GOOGLE_URL })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startGoogleLogin({ csrfToken: 'tok' })).resolves.toBe(GOOGLE_URL);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/google/start');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({});
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { authorizationUrl: 'https://evil.example/' }))));
    await expect(startGoogleLogin({ csrfToken: 'tok' })).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('Continuar con Google', () => {
  it.each(['/entrar', '/registro'])('%s: botón con Google configurado, navegación completa y formulario local intacto', async (path) => {
    const client = enabledClient();
    const { user } = renderApp(path, { authClient: client });
    const button = await screen.findByRole('button', { name: 'Continuar con Google' });
    expect(screen.getByText('o con tu correo')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();

    await user.click(button);
    await waitFor(() => expect(client.navigate).toHaveBeenCalledWith(GOOGLE_URL));
    expect(client.startGoogleLogin).toHaveBeenCalledTimes(1);
    expect(client.startGoogleLogin).toHaveBeenCalledWith({ csrfToken: 'csrf-anon' });
    expect(screen.getByRole('button', { name: 'Abriendo Google…' })).toHaveAttribute('aria-disabled', 'true');
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  it('sin configuración: no hay botón falso y se explica con fallback local', async () => {
    const client = anonymousAuthClient();
    renderApp('/entrar', { authClient: client });
    expect(await screen.findByText(/El acceso con Google no está disponible en este servidor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(client.startGoogleLogin).not.toHaveBeenCalled();
  });

  it('error al consultar proveedores: aviso y reintento que muestra el botón', async () => {
    const fetchProvidersMock = vi
      .fn()
      .mockRejectedValueOnce(new AuthRequestError('network', 'sin red'))
      .mockResolvedValueOnce({ google: { enabled: true } });
    const { user } = renderApp('/entrar', { authClient: enabledClient({ fetchProviders: fetchProvidersMock }) });
    await user.click(await screen.findByRole('button', { name: 'Volver a comprobar' }));
    expect(await screen.findByRole('button', { name: 'Continuar con Google' })).toBeInTheDocument();
    expect(fetchProvidersMock).toHaveBeenCalledTimes(2);
  });

  it('503 al iniciar: mensaje, sin navegar y el botón desaparece', async () => {
    const client = enabledClient({
      startGoogleLogin: vi.fn(() =>
        Promise.reject(new AuthRequestError('http', 'El acceso con Google no está disponible en este momento.', { status: 503, code: 'AUTH_PROVIDER_UNAVAILABLE' })),
      ),
    });
    const { user } = renderApp('/entrar', { authClient: client });
    await user.click(await screen.findByRole('button', { name: 'Continuar con Google' }));
    expect(await screen.findByText(/no está disponible en este servidor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    expect(client.navigate).not.toHaveBeenCalled();
  });

  it('403 CSRF: renueva la sesión sin reenviar y lo explica', async () => {
    const client = enabledClient({
      startGoogleLogin: vi.fn(() => Promise.reject(new AuthRequestError('http', 'csrf', { status: 403, code: 'CSRF_INVALID' }))),
    });
    const { user } = renderApp('/entrar', { authClient: client });
    await user.click(await screen.findByRole('button', { name: 'Continuar con Google' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ya se ha renovado/);
    expect(alert).toHaveFocus();
    expect(client.startGoogleLogin).toHaveBeenCalledTimes(1);
    expect(client.fetchSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(client.navigate).not.toHaveBeenCalled();
    expect(within(document.querySelector('.auth-panel')).getByRole('button', { name: 'Continuar con Google' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('motivos del callback en /entrar', () => {
  it.each([
    ['google_cancelled', 'status', /Cancelaste el acceso con Google/],
    ['google_failed', 'alert', /No se pudo completar el acceso con Google/],
    ['google_conflict', 'alert', /Ya existe una cuenta de NoMoreSaaS con el correo/],
  ])('%s: aviso fijo y URL limpia conservando ?siguiente', async (reason, role, text) => {
    renderApp(`/entrar?siguiente=%2Fcuenta&reason=${reason}`, { authClient: enabledClient() });
    const notice = await screen.findByText(text);
    expect(notice.closest(`[role="${role}"]`)).not.toBeNull();
    await waitFor(() => expect(location()).toBe('/entrar?siguiente=%2Fcuenta'));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each(['toString', '__proto__', 'google_linked', '%3Cb%3Ehola%3C%2Fb%3E'])('motivo no aplicable (%s) se ignora', async (value) => {
    renderApp(`/entrar?reason=${value}`, { authClient: enabledClient() });
    await screen.findByRole('button', { name: 'Continuar con Google' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.querySelector('.page-notice')).toBeNull();
    expect(document.body.textContent).not.toContain('hola');
    await waitFor(() => expect(location()).toBe('/entrar'));
  });
});
