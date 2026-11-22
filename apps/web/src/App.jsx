import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { AlternativePage } from './pages/AlternativePage.jsx';
import { CatalogPage } from './pages/CatalogPage.jsx';
import { ComparePage } from './pages/ComparePage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { ServicePage } from './pages/ServicePage.jsx';

// React Router en modo declarativo. Las rutas privadas (RequireAuth) llegan con T005.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CatalogPage />} />
        <Route path="saas/:id" element={<ServicePage />} />
        <Route path="alternativas/:id" element={<AlternativePage />} />
        <Route path="comparar" element={<ComparePage />} />
        <Route path="entrar" element={<LoginPage />} />
        <Route path="registro" element={<RegisterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
