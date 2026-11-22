import { useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { AlternativeCard, ServiceCard } from '../components/Cards.jsx';
import { SearchForm } from '../components/SearchForm.jsx';
import { CatalogGate, EmptyState } from '../components/StatusViews.jsx';
import { searchCatalog } from '../catalog-index.js';
import { plural } from '../format.js';
import { useCatalog } from '../hooks/useCatalog.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

const FROM_SEARCH = { fromSearch: true };

// Imagen generada con Higgsfield (job ade277e0-1c97-4ed2-9256-26620b81639d,
// modelo gpt_image_2_6). Si el archivo no está disponible no se sustituye por
// otra imagen: la portada sigue funcionando solo con el texto.
export const HERO_IMAGE_SRC = '/images/computadora-higgsfield.png';

function HeroComputer() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="hero__visual">
      <img
        src={HERO_IMAGE_SRC}
        alt="Computadora de escritorio negra y minimalista con una franja de luz lima en el frontal"
        width="1168"
        height="880"
        decoding="async"
        fetchPriority="high"
        onError={() => setFailed(true)}
      />
    </figure>
  );
}

export function CatalogPage() {
  const catalog = useCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const urlQuery = searchParams.get('q') ?? '';
  // El texto vive en estado local y se refleja en la URL. React Router aplica
  // la navegación en una transición; un input controlado solo por la URL
  // perdería pulsaciones al escribir rápido.
  const [query, setQuery] = useState(urlQuery);
  const inputRef = useRef(null);
  useDocumentTitle(null);

  // Resincroniza solo ante navegaciones externas (enlace, atrás/adelante).
  const external = !location.state?.fromSearch;
  const [syncedKey, setSyncedKey] = useState(location.key);
  if (external && syncedKey !== location.key) {
    setSyncedKey(location.key);
    setQuery(urlQuery);
  }

  function updateQuery(value) {
    setQuery(value);
    setSearchParams(value ? { q: value } : {}, { replace: true, state: FROM_SEARCH });
  }

  function resetSearch() {
    updateQuery('');
    inputRef.current?.focus();
  }

  return (
    <div className="page">
      <header className="hero">
        <HeroComputer />
        <div className="hero__text">
          <h1>Tus servicios. Tus reglas.</h1>
          <p className="hero__lead">Elige lo que usas. Encuentra su reemplazo.</p>
          <p className="page-meta">
            <span className="tag">Catálogo público</span>
            <span>Sin registro</span>
          </p>
        </div>
      </header>

      <CatalogGate catalog={catalog}>
        {(index) => {
          if (index.isEmpty) {
            return (
              <EmptyState title="El catálogo todavía no tiene alternativas publicadas">
                <p>Cuando se publiquen registros verificados aparecerán aquí.</p>
              </EmptyState>
            );
          }
          const result = searchCatalog(index, query);
          return (
            <>
              <SearchForm value={query} onChange={updateQuery} inputRef={inputRef} />
              <p className="results-summary" role="status">
                {result.filtered ? `${plural(result.total, 'resultado', 'resultados')} para «${query.trim()}»` : ''}
              </p>

              {result.filtered && result.total === 0 ? (
                <EmptyState
                  title="Sin resultados"
                  action={
                    <button type="button" className="button button--primary" onClick={resetSearch}>
                      Restablecer búsqueda
                    </button>
                  }
                >
                  <p>{`Ningún servicio ni alternativa coincide con «${query.trim()}». Prueba con el nombre del servicio que usas.`}</p>
                </EmptyState>
              ) : null}

              {result.services.length ? (
                <section className="section" aria-labelledby="servicios-titulo">
                  <h2 id="servicios-titulo">{result.filtered ? 'Servicios SaaS que coinciden' : 'Servicios SaaS'}</h2>
                  <div className="grid grid--services">
                    {result.services.map((service) => (
                      <ServiceCard key={service.id} service={service} alternatives={index.alternativesForService(service.id)} />
                    ))}
                  </div>
                </section>
              ) : null}

              {result.alternatives.length ? (
                <section className="section" aria-labelledby="alternativas-titulo">
                  <h2 id="alternativas-titulo">{result.filtered ? 'Alternativas que coinciden' : 'Alternativas'}</h2>
                  <div className="grid grid--alternatives">
                    {result.alternatives.map((alternative) => (
                      <AlternativeCard
                        key={alternative.id}
                        alternative={alternative}
                        services={index.servicesForAlternative(alternative.id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          );
        }}
      </CatalogGate>
    </div>
  );
}
