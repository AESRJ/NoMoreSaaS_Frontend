import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import App from '../src/App.jsx';
import { createCatalogResource } from '../src/api/catalog.js';
import { CatalogProvider } from '../src/hooks/useCatalog.js';
import { useComparison } from '../src/store/comparison.js';
import { catalogFixture } from './fixtures.js';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export function resetSelection(ids = []) {
  useComparison.setState({ ids, notice: null });
}

/** Renderiza la SPA completa con un catálogo de fixture (sin red). */
export function renderApp(path = '/', { data, fetcher } = {}) {
  const fetchMock = fetcher ?? vi.fn(() => Promise.resolve(data ?? catalogFixture()));
  const resource = createCatalogResource({ fetcher: fetchMock });
  const user = userEvent.setup();
  const utils = render(
    <CatalogProvider resource={resource}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </CatalogProvider>,
  );
  return { ...utils, user, resource, fetcher: fetchMock };
}
