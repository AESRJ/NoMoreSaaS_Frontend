import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { RequireAuth } from './components/RequireAuth.jsx';
import { AlternativePage } from './pages/AlternativePage.jsx';
import { CatalogPage } from './pages/CatalogPage.jsx';
import { ComparePage } from './pages/ComparePage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { ProjectFormPage } from './pages/ProjectFormPage.jsx';
import { ProjectPage } from './pages/ProjectPage.jsx';
import { ProjectsPage } from './pages/ProjectsPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { ServicePage } from './pages/ServicePage.jsx';

// React Router en modo declarativo. /proyectos/* solo con sesión (RequireAuth).
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
        <Route element={<RequireAuth />}>
          <Route path="proyectos" element={<ProjectsPage />} />
          <Route path="proyectos/nuevo" element={<ProjectFormPage />} />
          <Route path="proyectos/:id" element={<ProjectPage />} />
          <Route path="proyectos/:id/editar" element={<ProjectFormPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
