import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { AuthRequestError } from '../api/auth.js';
import { useProjectsClient } from '../api/projects.js';
import {
  DateTime,
  PageNotice,
  ProjectAlternative,
  ProjectNotFound,
  ProjectsError,
  ProjectsLoading,
  isMissing,
} from '../components/ProjectParts.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useOwnedRequest } from '../hooks/useOwnedRequest.js';
import { isStaleWrite, useAuth } from '../store/auth.js';

/** Confirmación en línea (sin modal): Cancelar no llama a la API. */
function DeleteConfirmation({ project, onCancel, onDeleted }) {
  const client = useProjectsClient();
  const withCsrf = useAuth((state) => state.withCsrf);
  const expireSession = useAuth((state) => state.expireSession);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const headingRef = useRef(null);
  const errorRef = useRef(null);
  const busy = useRef(false);
  const headingId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setDeleting(true);
    setError(null);
    try {
      await withCsrf((csrfToken) => client.deleteProject(project.id, { csrfToken }));
      onDeleted();
      return;
    } catch (failure) {
      if (isStaleWrite(failure)) return; // la cuenta cambió: la vista se recarga para la nueva
      const known = failure instanceof AuthRequestError;
      if (known && failure.status === 401) {
        expireSession();
        return;
      }
      const message =
        known && failure.status === 404
          ? 'Este proyecto ya no existe o no pertenece a tu cuenta.'
          : known
            ? `${failure.message} El proyecto no se ha eliminado.`
            : 'No se pudo eliminar el proyecto. Inténtalo de nuevo.';
      setError({ message, id: Date.now() });
    } finally {
      busy.current = false;
      setDeleting(false);
    }
  }

  return (
    <section className="confirm-panel" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        ¿Eliminar «{project.name}»?
      </h2>
      <p>Se borrarán definitivamente el proyecto y su selección de alternativas. Esta acción no se puede deshacer.</p>
      {error && (
        <p ref={errorRef} className="form-alert" role="alert" tabIndex={-1}>
          {error.message}
        </p>
      )}
      <div className="confirm-panel__actions">
        <button type="button" className="button button--danger" onClick={confirm} aria-disabled={deleting ? true : undefined}>
          {deleting ? 'Eliminando…' : `Eliminar «${project.name}»`}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={deleting}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

export function ProjectPage() {
  const { id } = useParams();
  const client = useProjectsClient();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = typeof location.state?.notice === 'string' ? location.state.notice : null;
  const request = useOwnedRequest((signal) => client.getProject(id, { signal }), `project:${id}`);
  const [confirming, setConfirming] = useState(false);
  const deleteButtonRef = useRef(null);
  const project = request.status === 'success' ? request.data : null;
  useDocumentTitle(project ? project.name : isMissing(request.error) ? 'Proyecto no encontrado' : 'Proyecto');

  if (request.status === 'loading') return <ProjectsLoading label="Cargando el proyecto…" />;
  if (request.status === 'error') {
    if (isMissing(request.error)) return <ProjectNotFound />;
    return <ProjectsError title="No se pudo cargar el proyecto" error={request.error} onRetry={request.retry} />;
  }

  function cancelDelete() {
    setConfirming(false);
    // Devuelve el foco al botón que abrió la confirmación.
    requestAnimationFrame(() => deleteButtonRef.current?.focus());
  }

  function deleted() {
    // history.state no guarda datos privados: aviso genérico, sin el nombre.
    navigate('/proyectos', { state: { notice: 'Proyecto eliminado.' } });
  }

  return (
    <article className="page detail project-detail">
      <nav className="breadcrumb" aria-label="Ruta">
        <Link to="/proyectos">Mis proyectos</Link>
      </nav>
      <PageNotice>{notice}</PageNotice>
      <header className="detail__header">
        <div>
          <h1>{project.name}</h1>
          <p className="page-meta">
            <span>
              Creado: <DateTime value={project.createdAt} />
            </span>
            <span>
              Actualizado: <DateTime value={project.updatedAt} />
            </span>
          </p>
        </div>
        {!confirming && (
          <div className="detail__actions project-detail__actions">
            <Link className="button button--secondary" to={`/proyectos/${project.id}/editar`}>
              Editar
            </Link>
            <button ref={deleteButtonRef} type="button" className="button button--ghost" onClick={() => setConfirming(true)}>
              Eliminar
            </button>
          </div>
        )}
      </header>

      {confirming && <DeleteConfirmation project={project} onCancel={cancelDelete} onDeleted={deleted} />}

      <section className="detail-section project-flow-link">
        <h2>Siguiente paso</h2>
        <p>Declara tu equipo, revisa la evaluación orientativa y sigue el plan guiado con prompts copiables.</p>
        <p>
          <Link className="button button--primary" to={`/proyectos/${project.id}/flujo`}>
            Equipo, evaluación y plan
          </Link>
        </p>
      </section>

      <section className="detail-section">
        <h2>Descripción</h2>
        {project.description ? <p className="project-detail__description">{project.description}</p> : <p className="muted">Sin descripción.</p>}
      </section>

      <section className="detail-section">
        <h2>Alternativas seleccionadas</h2>
        <ol className="project-selection">
          {project.alternatives.map((alternative) => (
            <li key={alternative.id}>
              <ProjectAlternative alternative={alternative} />
            </li>
          ))}
        </ol>
        {project.alternatives.some((alternative) => !alternative.available) && (
          <p className="muted">Las alternativas marcadas como no disponibles ya no están en el catálogo. Puedes quitarlas al editar.</p>
        )}
      </section>
    </article>
  );
}
