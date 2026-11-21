import { Link } from 'react-router';

export function LoadingState({ label = 'Cargando el catálogo…' }) {
  return (
    <div className="state state--loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <h2>No se pudo cargar el catálogo</h2>
      <p>{error?.message || 'Se produjo un error inesperado.'} Esto no significa que el catálogo esté vacío.</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state state--empty">
      <h2>{title}</h2>
      {children}
      {action}
    </div>
  );
}

export function NotFoundContent({ title, children }) {
  return (
    <div className="page page--narrow">
      <h1>{title}</h1>
      <p>{children}</p>
      <p>
        <Link className="button button--primary" to="/">
          Volver al catálogo
        </Link>
      </p>
    </div>
  );
}

/** Representa carga y error del catálogo; si hay datos, delega en children(index). */
export function CatalogGate({ catalog, children }) {
  if (catalog.status === 'loading') return <LoadingState />;
  if (catalog.status === 'error') return <ErrorState error={catalog.error} onRetry={catalog.retry} />;
  return children(catalog.index);
}
