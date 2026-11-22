import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import App from '../src/App.jsx';
import { createCatalogResource } from '../src/api/catalog.js';
import { CatalogProvider } from '../src/hooks/useCatalog.js';
import { AuthProvider, createAuthStore } from '../src/store/auth.js';
import { useComparison } from '../src/store/comparison.js';
import { catalogFixture } from './fixtures.js';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export function resetSelection(ids = []) {
  useComparison.setState({ ids, notice: null });
}

/** Cliente de auth simulado: visitante anónimo salvo que se sustituyan métodos. */
export function anonymousAuthClient(overrides = {}) {
  return {
    fetchSession: vi.fn(() => Promise.resolve({ user: null, csrfToken: 'csrf-anon' })),
    register: vi.fn(() => Promise.reject(new Error('register no simulado'))),
    login: vi.fn(() => Promise.reject(new Error('login no simulado'))),
    logout: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

/**
 * Renderiza la SPA completa con un catálogo de fixture (sin red).
 * Desde T003 la cabecera consulta la sesión: se inyecta un store de auth con
 * cliente simulado para que ninguna prueba acceda a /api/auth real.
 */
export function renderApp(path = '/', { data, fetcher, authClient, authStore } = {}) {
  const fetchMock = fetcher ?? vi.fn(() => Promise.resolve(data ?? catalogFixture()));
  const resource = createCatalogResource({ fetcher: fetchMock });
  const auth = authStore ?? createAuthStore({ client: authClient ?? anonymousAuthClient() });
  const user = userEvent.setup();
  const utils = render(
    <CatalogProvider resource={resource}>
      <AuthProvider store={auth}>
        <MemoryRouter initialEntries={[path]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </AuthProvider>
    </CatalogProvider>,
  );
  return { ...utils, user, resource, fetcher: fetchMock, authStore: auth };
}
