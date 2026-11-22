import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HERO_IMAGE_SRC } from '../src/pages/CatalogPage.jsx';
import { renderApp } from './helpers.jsx';

describe('portada', () => {
  it('muestra la computadora central de Higgsfield con texto alternativo y mantiene la búsqueda', async () => {
    renderApp('/');
    const image = screen.getByRole('img', { name: /computadora de escritorio negra/i });
    expect(image).toHaveAttribute('src', HERO_IMAGE_SRC);
    expect(HERO_IMAGE_SRC).toBe('/images/computadora-higgsfield.png');
    expect(screen.getByRole('heading', { level: 1, name: 'Tus servicios. Tus reglas.' })).toBeInTheDocument();
    expect(screen.getByText('Elige lo que usas. Encuentra su reemplazo.')).toBeInTheDocument();
    const search = await screen.findByRole('searchbox', { name: 'Encuentra una alternativa' });
    expect(search).toHaveAttribute('placeholder', 'Por ejemplo, Google Drive');
    expect(search).toHaveAccessibleDescription('Escribe el nombre del servicio que quieres reemplazar.');
  });

  it('si la imagen no carga se oculta sin sustituirla por otra; el resto de la portada sigue', async () => {
    renderApp('/');
    fireEvent.error(screen.getByRole('img', { name: /computadora de escritorio negra/i }));
    expect(screen.queryByRole('img', { name: /computadora/i })).not.toBeInTheDocument();
    expect(document.querySelector('.hero img')).toBeNull();
    expect(await screen.findByRole('searchbox', { name: 'Encuentra una alternativa' })).toBeInTheDocument();
  });
});
