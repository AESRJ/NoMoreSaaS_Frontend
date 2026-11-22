import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HERO_IMAGE_SRC } from '../src/pages/CatalogPage.jsx';
import { renderApp, resetSelection } from './helpers.jsx';

beforeEach(() => resetSelection());

describe('portada', () => {
  it('muestra la computadora central de Higgsfield con texto alternativo y mantiene la búsqueda', async () => {
    renderApp('/');
    const image = screen.getByRole('img', { name: /computadora de escritorio negra/i });
    expect(image).toHaveAttribute('src', HERO_IMAGE_SRC);
    expect(HERO_IMAGE_SRC).toBe('/images/computadora-higgsfield.png');
    expect(screen.getByRole('heading', { level: 1, name: 'Alternativas autoalojables a servicios SaaS' })).toBeInTheDocument();
    expect(await screen.findByRole('searchbox', { name: /buscar saas o alternativa/i })).toBeInTheDocument();
  });

  it('si la imagen no carga se oculta sin sustituirla por otra; el resto de la portada sigue', async () => {
    renderApp('/');
    fireEvent.error(screen.getByRole('img', { name: /computadora de escritorio negra/i }));
    expect(screen.queryByRole('img', { name: /computadora/i })).not.toBeInTheDocument();
    expect(document.querySelector('.hero img')).toBeNull();
    expect(await screen.findByRole('searchbox', { name: /buscar saas o alternativa/i })).toBeInTheDocument();
  });
});
