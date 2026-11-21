import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import { CatalogProvider } from './hooks/useCatalog.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CatalogProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </CatalogProvider>
  </StrictMode>,
);
