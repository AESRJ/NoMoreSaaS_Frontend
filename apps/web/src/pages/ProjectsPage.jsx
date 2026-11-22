import { Link, useLocation } from 'react-router';
import { useProjectsClient } from '../api/projects.js';
import { EmptyState } from '../components/StatusViews.jsx';
import { DateTime, PageNotice, ProjectAlternative, ProjectsError, ProjectsLoading } from '../components/ProjectParts.jsx';
import { plural } from '../format.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useOwnedRequest } from '../hooks/useOwnedRequest.js';

export const PROJECT_LIMIT = 100;

export function ProjectsPage() {
  useDocumentTitle('Mis proyectos');
  const client = useProjectsClient();
  const location = useLocation();
  const notice = typeof location.state?.notice === 'string' ? location.state.notice : null;
  const list = useOwnedRequest((signal) => client.listProjects({ signal }), 'projects');
  const atLimit = list.status === 'success' && list.data.length >= PROJECT_LIMIT;

  return (
    <div className="page">
      <header className="page-header projects-header">
        <div>
          <h1>Mis proyectos</h1>
          <p className="hero__lead">Tus selecciones de alternativas guardadas. Solo tú puedes verlas.</p>
        </div>
        {list.status === 'success' && list.data.length > 0 && !atLimit && (
          <Link className="button button--primary" to="/proyectos/nuevo">
            Nuevo proyecto
          </Link>
        )}
      </header>
      <PageNotice>{notice}</PageNotice>

      {list.status === 'loading' && <ProjectsLoading label="Cargando tus proyectos…" />}
      {list.status === 'error' && <ProjectsError title="No se pudieron cargar tus proyectos" error={list.error} onRetry={list.retry} />}
      {list.status === 'success' && list.data.length === 0 && (
        <EmptyState
          title="Aún no tienes proyectos"
          action={
            <Link className="button button--primary" to="/proyectos/nuevo">
              Crear proyecto
            </Link>
          }
        >
          <p>Un proyecto guarda un nombre, una descripción y entre 1 y 10 alternativas del catálogo.</p>
        </EmptyState>
      )}
      {list.status === 'success' && list.data.length > 0 && (
        <>
          <p className="results-summary">
            {plural(list.data.length, 'proyecto', 'proyectos')}
            {atLimit && ` · Has alcanzado el máximo de ${PROJECT_LIMIT}; elimina alguno para crear otro.`}
          </p>
          <ul className="project-list">
            {list.data.map((project) => (
              <li key={project.id} className="card project-card">
                <h2 className="card__title">
                  <Link to={`/proyectos/${project.id}`}>{project.name}</Link>
                </h2>
                {project.description && <p className="card__text project-card__description">{project.description}</p>}
                <ul className="inline-list project-card__alternatives" aria-label={`Alternativas de ${project.name}`}>
                  {project.alternatives.map((alternative) => (
                    <li key={alternative.id}>
                      <ProjectAlternative alternative={alternative} link={false} />
                    </li>
                  ))}
                </ul>
                <p className="card__meta">
                  Actualizado: <DateTime value={project.updatedAt} />
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
