import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAccount, safeGoogleAuthorizationUrl, startGoogleLink } from '../src/api/account.js';
import { AuthRequestError } from '../src/api/auth.js';
import { anonymousAuthClient, renderApp, unusedAccountClient } from './helpers.jsx';

// /cuenta y vínculo Google con clientes simulados (sin red ni Google real).
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com' };
const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s';
const PASSWORD = 'una frase de paso larga';
const location = () => screen.getByTestId('location').textContent;
const signedIn = () => anonymousAuthClient({ fetchSession: vi.fn(() => Promise.resolve({ user: USER, csrfToken: 'csrf-ana' })) });
const account = (overrides = {}) => ({ hasPassword: true, google: { enabled: true, linked: false }, ...overrides });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cliente de cuenta', () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('fetchAccount valida y copia solo los campos del contrato', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { user: USER, hasPassword: true, google: { enabled: true, linked: false, sub: 'x' } }))));
    await expect(fetchAccount()).resolves.toEqual({ hasPassword: true, google: { enabled: true, linked: false } });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { google: {} }))));
    await expect(fetchAccount()).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('startGoogleLink envía contraseña y CSRF, y solo acepta URL de accounts.google.com', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { authorizationUrl: GOOGLE_URL })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startGoogleLink({ password: PASSWORD, csrfToken: 'tok' })).resolves.toBe(GOOGLE_URL);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/google/link/start');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ password: PASSWORD });

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { authorizationUrl: 'https://evil.example/?x' }))));
    await expect(startGoogleLink({ password: PASSWORD, csrfToken: 'tok' })).rejects.toMatchObject({ kind: 'invalid' });
    for (const bad of ['http://accounts.google.com/x', 'https://accounts.google.com.evil.example/', 'javascript:alert(1)', 5]) {
      expect(safeGoogleAuthorizationUrl(bad)).toBeNull();
    }
  });
});

describe('página /cuenta', () => {
  it('sin sesión redirige a /entrar conservando /cuenta como destino', async () => {
    renderApp('/cuenta');
    await waitFor(() => expect(location()).toBe('/entrar?siguiente=%2Fcuenta'));
  });

  it('muestra cuenta sin vincular y vincula: contraseña + CSRF y navegación completa a Google', async () => {
    const client = unusedAccountClient({
      fetchAccount: vi.fn(() => Promise.resolve(account())),
      startGoogleLink: vi.fn(() => Promise.resolve(GOOGLE_URL)),
    });
    const { user } = renderApp('/cuenta', { authClient: signedIn(), accountClient: client });
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument();
    expect(screen.getByText(USER.email, { selector: 'strong' })).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Acceso con Google' });
    expect(within(section).getByText('Sin vincular')).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Vincular con Google' }));
    expect(await within(section).findByText('Introduce tu contraseña actual.')).toBeInTheDocument();
    expect(client.startGoogleLink).not.toHaveBeenCalled();

    await user.type(within(section).getByLabelText('Contraseña actual'), PASSWORD);
    await user.click(within(section).getByRole('button', { name: 'Vincular con Google' }));
    await waitFor(() => expect(client.navigate).toHaveBeenCalledWith(GOOGLE_URL));
    expect(client.startGoogleLink).toHaveBeenCalledWith({ password: PASSWORD, csrfToken: 'csrf-ana' });
    expect(within(section).getByRole('button', { name: 'Abriendo Google…' })).toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(PASSWORD);
  });

  it('contraseña incorrecta: error en el campo, sin navegar; 409 recarga el estado vinculado', async () => {
    const fetchAccountMock = vi
      .fn()
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce(account({ google: { enabled: true, linked: true } }));
    const startGoogleLinkMock = vi
      .fn()
      .mockRejectedValueOnce(new AuthRequestError('http', 'La contraseña actual no es correcta.', { status: 400, code: 'INVALID_PASSWORD' }))
      .mockRejectedValueOnce(new AuthRequestError('http', 'Ya vinculada.', { status: 409, code: 'GOOGLE_ALREADY_LINKED' }));
    const client = unusedAccountClient({ fetchAccount: fetchAccountMock, startGoogleLink: startGoogleLinkMock });
    const { user } = renderApp('/cuenta', { authClient: signedIn(), accountClient: client });
    const field = await screen.findByLabelText('Contraseña actual');
    await user.type(field, PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Vincular con Google' }));
    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(client.navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Vincular con Google' }));
    expect(await screen.findByText('Vinculada')).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña actual')).not.toBeInTheDocument();
    expect(client.navigate).not.toHaveBeenCalled();
  });

  it('Google no configurado: lo explica sin botón ni formulario', async () => {
    const client = unusedAccountClient({ fetchAccount: vi.fn(() => Promise.resolve(account({ google: { enabled: false, linked: false } }))) });
    renderApp('/cuenta', { authClient: signedIn(), accountClient: client });
    expect(await screen.findByText('No disponible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña actual')).not.toBeInTheDocument();
  });

  it.each([
    ['google_linked', 'status', /ha quedado vinculada/],
    ['google_cancelled', 'status', /Cancelaste la vinculación/],
    ['google_failed', 'alert', /No se pudo completar la vinculación/],
    ['google_conflict', 'alert', /ya está vinculada a otra cuenta/],
  ])('motivo %s: aviso fijo y URL limpia', async (reason, role, text) => {
    const client = unusedAccountClient({ fetchAccount: vi.fn(() => Promise.resolve(account({ google: { enabled: true, linked: reason === 'google_linked' } }))) });
    renderApp(`/cuenta?reason=${reason}`, { authClient: signedIn(), accountClient: client });
    const notice = await screen.findByText(text);
    expect(notice.closest(`[role="${role}"]`)).not.toBeNull();
    await waitFor(() => expect(location()).toBe('/cuenta'));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each(['%3Cb%3Ehola%3C%2Fb%3E', 'toString', '__proto__', 'constructor', 'hasOwnProperty'])(
    'un motivo desconocido o heredado (%s) no muestra nada',
    async (value) => {
      const client = unusedAccountClient({ fetchAccount: vi.fn(() => Promise.resolve(account())) });
      renderApp(`/cuenta?reason=${value}`, { authClient: signedIn(), accountClient: client });
      await screen.findByText('Sin vincular');
      expect(document.body.textContent).not.toContain('hola');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(document.querySelector('.page-notice')).toBeNull();
      await waitFor(() => expect(location()).toBe('/cuenta'));
    },
  );

  it('la cabecera enlaza a Mi cuenta con sesión', async () => {
    const client = unusedAccountClient({ fetchAccount: vi.fn(() => Promise.resolve(account())) });
    const { user } = renderApp('/', { authClient: signedIn(), accountClient: client });
    const header = document.querySelector('.site-header');
    await user.click(await within(header).findByRole('link', { name: 'Mi cuenta' }));
    expect(location()).toBe('/cuenta');
  });
});
