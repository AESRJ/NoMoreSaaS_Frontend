import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { RequireAuth } from './components/RequireAuth.jsx';
import { AlternativePage } from './pages/AlternativePage.jsx';
import { CatalogPage } from './pages/CatalogPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { ProjectFormPage } from './pages/ProjectFormPage.jsx';
import { ProjectPage } from './pages/ProjectPage.jsx';
import { ProjectsPage } from './pages/ProjectsPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { ServicePage } from './pages/ServicePage.jsx';
import { WorkflowPage } from './pages/WorkflowPage.jsx';

// React Router en modo declarativo. /proyectos/* solo con sesión (RequireAuth).
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CatalogPage />} />
        <Route path="saas/:id" element={<ServicePage />} />
        <Route path="alternativas/:id" element={<AlternativePage />} />
        {/* La comparación global se retiró (005): la ruta antigua vuelve al catálogo. */}
        <Route path="comparar" element={<Navigate to="/" replace state={{ compareMoved: true }} />} />
        <Route path="entrar" element={<LoginPage />} />
        <Route path="registro" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route path="proyectos" element={<ProjectsPage />} />
          <Route path="proyectos/nuevo" element={<ProjectFormPage />} />
          <Route path="proyectos/:id" element={<ProjectPage />} />
          <Route path="proyectos/:id/editar" element={<ProjectFormPage />} />
          <Route path="proyectos/:id/flujo" element={<WorkflowPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
