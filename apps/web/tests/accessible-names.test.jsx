import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from './helpers.jsx';

// Regresión: el nombre accesible de cada botón debe separar sus partes
// ("Archiveroa" fue un error real); el monograma decorativo no se lee.
it('los círculos de servicio tienen nombres accesibles bien formados', async () => {
  renderApp('/');
  await screen.findByRole('searchbox');
  const names = [];
  screen.queryAllByRole('button', {
    name: (name) => {
      names.push(name);
      return false;
    },
  });
  expect(names).toEqual(['Drive Nube 1 alternativa', 'Fotos Nube 1 alternativa', 'Forja Nube 2 alternativas']);
});
