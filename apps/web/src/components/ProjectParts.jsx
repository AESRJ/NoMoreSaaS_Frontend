import { Link } from 'react-router';

// Piezas comunes de las vistas de proyectos. Todo el contenido del usuario se
// representa como texto React (nunca HTML crudo).

const dateTimeFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' });

export function DateTime({ value }) {
  const date = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(date.getTime())) return <>fecha desconocida</>;
  return <time dateTime={value}>{dateTimeFormatter.format(date)}</time>;
}

/** Alternativa del proyecto: enlace si sigue en el catálogo; si no, «No disponible» con su ID. */
export function ProjectAlternative({ alternative, link = true }) {
  if (!alternative.available) {
    return (
      <span className="retired">
        <span className="tag tag--retired">No disponible</span> <code className="retired__id">{alternative.id}</code>
      </span>
    );
  }
  const name = alternative.name ?? alternative.id;
  return link ? <Link to={`/alternativas/${alternative.id}`}>{name}</Link> : <>{name}</>;
}

export function PageNotice({ children }) {
  if (!children) return null;
  return (
    <p className="page-notice" role="status">
      {children}
    </p>
  );
}

export function ProjectsLoading({ label }) {
  return (
    <div className="loading" role="status">
      <p className="loading__label">{label}</p>
    </div>
  );
}

export function ProjectsError({ title, error, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <h2>{title}</h2>
      <p>{error?.message || 'Se produjo un error inesperado.'} Tus datos no se han modificado.</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

/** Mismo mensaje para inexistente o ajeno: no se confirma la existencia de proyectos de otros. */
export function ProjectNotFound() {
  return (
    <div className="page page--narrow">
      <h1>Proyecto no encontrado</h1>
      <p>Este proyecto no existe o no pertenece a tu cuenta.</p>
      <p>
        <Link className="button button--primary" to="/proyectos">
          Volver a mis proyectos
        </Link>
      </p>
    </div>
  );
}

/** 404 o ID inválido del servidor. */
export const isMissing = (error) => error && (error.status === 404 || error.status === 400);
