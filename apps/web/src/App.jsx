import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { AlternativePage } from './pages/AlternativePage.jsx';
import { CatalogPage } from './pages/CatalogPage.jsx';
import { ComparePage } from './pages/ComparePage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { ServicePage } from './pages/ServicePage.jsx';

// React Router en modo declarativo.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CatalogPage />} />
        <Route path="saas/:id" element={<ServicePage />} />
        <Route path="alternativas/:id" element={<AlternativePage />} />
        <Route path="comparar" element={<ComparePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
