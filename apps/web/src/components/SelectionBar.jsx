import { Link, useLocation } from 'react-router';
import { MAX_SELECTION, useComparison } from '../store/comparison.js';

function removedMessage(count) {
  return count === 1
    ? 'Se retiró 1 alternativa de tu selección porque ya no está en el catálogo.'
    : `Se retiraron ${count} alternativas de tu selección porque ya no están en el catálogo.`;
}

// La comparación es pública: en cuenta y proyectos privados la banda no aparece.
const PRIVATE_PREFIXES = ['/proyectos', '/entrar', '/registro'];
const isPrivatePath = (pathname) => PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/** Contador 1–3, acciones y avisos accesibles de la selección (oculta sin selección ni aviso). */
export function SelectionBar() {
  const ids = useComparison((state) => state.ids);
  const notice = useComparison((state) => state.notice);
  const clear = useComparison((state) => state.clear);
  const dismissNotice = useComparison((state) => state.dismissNotice);
  const { pathname } = useLocation();
  const onComparePage = pathname === '/comparar';
  const missing = Math.max(0, 2 - ids.length);

  if (isPrivatePath(pathname) || (!ids.length && !notice)) return null;

  function clearSelection() {
    clear();
    // El botón desaparece con la banda: el foco vuelve al contenido principal.
    document.getElementById('contenido')?.focus({ preventScroll: true });
  }

  return (
    <aside className="selection-bar" aria-label="Selección para comparar">
      <div className="selection-bar__inner">
        <p className="selection-bar__count">
          <span data-testid="selection-count" className="selection-bar__number">{`${ids.length} de ${MAX_SELECTION}`}</span>
          <span>{` seleccionadas${missing && ids.length ? ` · añade ${missing} más para comparar` : ''}`}</span>
        </p>
        <div className="selection-bar__actions">
          {!onComparePage && ids.length >= 2 ? (
            <Link className="button button--primary button--small" to="/comparar">
              Ver comparación
            </Link>
          ) : null}
          {ids.length ? (
            <button type="button" className="button button--ghost button--small" onClick={clearSelection}>
              Limpiar selección
            </button>
          ) : null}
        </div>
      </div>
      {notice?.kind === 'limit' ? (
        <div className="notice notice--warning" role="alert" key={notice.id}>
          <p>{`Has alcanzado el máximo de ${MAX_SELECTION} alternativas. Retira una antes de añadir otra.`}</p>
          <button type="button" className="button button--ghost button--small" onClick={dismissNotice}>
            Cerrar aviso
          </button>
        </div>
      ) : null}
      <div role="status" aria-label="Aviso de selección" className={notice?.kind === 'removed' ? 'notice notice--info' : 'sr-only'}>
        {notice?.kind === 'removed' ? (
          <>
            <p>{removedMessage(notice.count)}</p>
            <button type="button" className="button button--ghost button--small" onClick={dismissNotice}>
              Cerrar aviso
            </button>
          </>
        ) : null}
      </div>
    </aside>
  );
}
