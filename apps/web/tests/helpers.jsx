import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import App from '../src/App.jsx';
import { AccountProvider } from '../src/api/account.js';
import { createCatalogResource } from '../src/api/catalog.js';
import { CatalogProvider } from '../src/hooks/useCatalog.js';
import { ProjectsProvider } from '../src/api/projects.js';
import { AuthProvider, createAuthStore } from '../src/store/auth.js';
import { catalogFixture } from './fixtures.js';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

/** Cliente de auth simulado: visitante anónimo salvo que se sustituyan métodos. */
export function anonymousAuthClient(overrides = {}) {
  return {
    fetchSession: vi.fn(() => Promise.resolve({ user: null, csrfToken: 'csrf-anon' })),
    register: vi.fn(() => Promise.reject(new Error('register no simulado'))),
    login: vi.fn(() => Promise.reject(new Error('login no simulado'))),
    logout: vi.fn(() => Promise.resolve()),
    // Desde 006/T004: Google desactivado por defecto (sin botón) salvo sustitución.
    fetchProviders: vi.fn(() => Promise.resolve({ google: { enabled: false } })),
    startGoogleLogin: vi.fn(() => Promise.reject(new Error('startGoogleLogin no simulado'))),
    navigate: vi.fn(),
    ...overrides,
  };
}

/**
 * Renderiza la SPA completa con un catálogo de fixture (sin red).
 * Desde T003 la cabecera consulta la sesión: se inyecta un store de auth con
 * cliente simulado para que ninguna prueba acceda a /api/auth real.
 */
/** Cliente de proyectos simulado (desde T005): lista vacía salvo que se sustituyan métodos. */
export function emptyProjectsClient(overrides = {}) {
  return {
    listProjects: vi.fn(() => Promise.resolve([])),
    getProject: vi.fn(() => Promise.reject(new Error('getProject no simulado'))),
    createProject: vi.fn(() => Promise.reject(new Error('createProject no simulado'))),
    updateProject: vi.fn(() => Promise.reject(new Error('updateProject no simulado'))),
    deleteProject: vi.fn(() => Promise.reject(new Error('deleteProject no simulado'))),
    ...overrides,
  };
}

/** Cliente de cuenta simulado (desde 006/T003): falla si una prueba lo usa sin sustituirlo. */
export function unusedAccountClient(overrides = {}) {
  return {
    fetchAccount: vi.fn(() => Promise.reject(new Error('fetchAccount no simulado'))),
    startGoogleLink: vi.fn(() => Promise.reject(new Error('startGoogleLink no simulado'))),
    navigate: vi.fn(),
    ...overrides,
  };
}

export function renderApp(path = '/', { data, fetcher, authClient, authStore, projectsClient, accountClient } = {}) {
  const fetchMock = fetcher ?? vi.fn(() => Promise.resolve(data ?? catalogFixture()));
  const resource = createCatalogResource({ fetcher: fetchMock });
  const auth = authStore ?? createAuthStore({ client: authClient ?? anonymousAuthClient() });
  const projects = projectsClient ?? emptyProjectsClient();
  const user = userEvent.setup();
  const utils = render(
    <CatalogProvider resource={resource}>
      <AuthProvider store={auth}>
        <ProjectsProvider client={projects}>
          <AccountProvider client={accountClient ?? unusedAccountClient()}>
            <MemoryRouter initialEntries={[path]}>
              <App />
              <LocationProbe />
            </MemoryRouter>
          </AccountProvider>
        </ProjectsProvider>
      </AuthProvider>
    </CatalogProvider>,
  );
  return { ...utils, user, resource, fetcher: fetchMock, authStore: auth, projectsClient: projects };
}
