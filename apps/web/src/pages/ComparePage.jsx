import { Link } from 'react-router';
import { ExternalLink } from '../components/ExternalLink.jsx';
import { Icon } from '../components/Icon.jsx';
import { SelectButton } from '../components/SelectButton.jsx';
import { CatalogGate } from '../components/StatusViews.jsx';
import { LICENSE_CLASSIFICATION_LABELS, difficultyLabel, formatDate, latestCheckedAt, plural, sourcesFor } from '../format.js';
import { useCatalog } from '../hooks/useCatalog.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { MAX_SELECTION, useComparison } from '../store/comparison.js';

function Unverified({ alternative, field }) {
  return sourcesFor(alternative, field).length ? null : <p className="verification verification--unverified">No verificado</p>;
}

function List({ items, empty }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="bullet-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Indica si las alternativas no comparten ningún SaaS (necesidades distintas). */
function sharedServices(index, alternatives) {
  const sets = alternatives.map((alt) => new Set(index.servicesForAlternative(alt.id).map((s) => s.id)));
  return [...sets[0]].filter((id) => sets.every((set) => set.has(id)));
}

const CRITERIA = [
  {
    key: 'replaces',
    label: 'Sustituye a',
    render: (alt, index) => (
      <ul className="stack stack--tight">
        {index.servicesForAlternative(alt.id).map((service) => (
          <li key={service.id}>
            <Link to={`/saas/${service.id}`}>{service.name}</Link>
          </li>
        ))}
      </ul>
    ),
  },
  { key: 'description', label: 'Descripción', render: (alt) => <p>{alt.description}</p> },
  {
    key: 'capabilities',
    label: 'Capacidades',
    render: (alt) => (
      <>
        <List items={alt.capabilities} empty="Desconocido: no se documentaron capacidades." />
        <Unverified alternative={alt} field="capabilities" />
      </>
    ),
  },
  {
    key: 'limitations',
    label: 'Limitaciones',
    render: (alt) => (
      <>
        <List items={alt.limitations} empty="No documentadas en este registro; no implica que no existan." />
        <Unverified alternative={alt} field="limitations" />
      </>
    ),
  },
  {
    key: 'license',
    label: 'Licencia',
    render: (alt) => (
      <>
        <p>
          <ExternalLink href={alt.license.url} unavailableLabel="Licencia">
            {alt.license.label}
          </ExternalLink>
        </p>
        <p className="muted">{LICENSE_CLASSIFICATION_LABELS[alt.license.classification]}</p>
        <Unverified alternative={alt} field="license" />
      </>
    ),
  },
  {
    key: 'difficulty',
    label: 'Dificultad (evaluación editorial)',
    render: (alt) => (
      <>
        <p className={`level level--${alt.difficulty.level}`}>{difficultyLabel(alt.difficulty.level)}</p>
        <p>{alt.difficulty.explanation}</p>
      </>
    ),
  },
  {
    key: 'hosting',
    label: 'Requisitos de autoalojamiento',
    render: (alt) => (
      <>
        <p>{alt.hostingNotes}</p>
        <Unverified alternative={alt} field="hostingNotes" />
      </>
    ),
  },
  {
    key: 'sources',
    label: 'Fuentes',
    render: (alt) => (
      <>
        <p>{`${plural(alt.sources.length, 'fuente', 'fuentes')} · última revisión ${formatDate(latestCheckedAt(alt.sources))}`}</p>
        <p>
          <Link to={`/alternativas/${alt.id}`}>{`Ver fuentes de ${alt.name}`}</Link>
        </p>
      </>
    ),
  },
];

export function ComparePage() {
  const catalog = useCatalog();
  const ids = useComparison((state) => state.ids);
  useDocumentTitle('Comparar alternativas');

  return (
    <div className="page">
      <header className="page-header">
        <h1>Comparar alternativas</h1>
        <p className="hero__lead">{`Hasta ${MAX_SELECTION} alternativas, criterio por criterio.`}</p>
      </header>
      <CatalogGate catalog={catalog}>
        {(index) => {
          const alternatives = ids.map((id) => index.alternative(id)).filter(Boolean);
          if (alternatives.length < 2) {
            const missing = 2 - alternatives.length;
            return (
              <div className="state state--empty">
                <h2>Todavía no hay suficientes alternativas</h2>
                <p>{`Selecciona al menos 2 alternativas para ver la comparación: ${missing === 1 ? 'falta 1' : `faltan ${missing}`}.`}</p>
                <p>
                  Usa el botón «Añadir a la comparación» en el catálogo, en la página de un SaaS o en una ficha. La selección se conserva
                  mientras navegas, pero se reinicia al recargar la página.
                </p>
                {alternatives.length ? (
                  <ul className="stack stack--tight">
                    {alternatives.map((alt) => (
                      <li key={alt.id} className="selected-item">
                        <Link to={`/alternativas/${alt.id}`}>{alt.name}</Link>
                        <SelectButton alternative={alt} compact />
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p>
                  <Link className="button button--primary" to="/">
                    Ir al catálogo
                  </Link>
                </p>
              </div>
            );
          }

          const shared = sharedServices(index, alternatives);
          return (
            <>
              {shared.length === 0 ? (
                <div className="callout callout--warning">
                  <Icon name="alert" className="callout__icon" />
                  <p>
                    <strong>Estas alternativas cubren necesidades distintas.</strong>{' '}
                    {alternatives
                      .map((alt) => `${alt.name} sustituye a ${index.servicesForAlternative(alt.id).map((s) => s.name).join(', ')}`)
                      .join('; ')}
                    . Compáralas con cautela: no resuelven el mismo problema.
                  </p>
                </div>
              ) : (
                <p className="callout">
                  <Icon name="info" className="callout__icon" />
                  {`Todas sustituyen a ${shared.map((id) => index.service(id).name).join(', ')}. Los datos ausentes no implican que una función no exista.`}
                </p>
              )}
              <p className="scroll-hint" aria-hidden="true">
                Desliza horizontalmente para ver todas las columnas
                <Icon name="arrow-right" />
              </p>
              <div className="table-scroll" role="region" aria-label="Tabla de comparación (desplazable horizontalmente)" tabIndex={0}>
                <table className="compare-table">
                  <caption className="sr-only">{`Comparación de ${alternatives.map((a) => a.name).join(', ')}`}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="compare-table__corner">
                        Criterio
                      </th>
                      {alternatives.map((alt) => (
                        <th key={alt.id} scope="col">
                          <Link className="compare-table__name" to={`/alternativas/${alt.id}`}>
                            {alt.name}
                          </Link>
                          <SelectButton alternative={alt} compact />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {CRITERIA.map((criterion) => (
                      <tr key={criterion.key}>
                        <th scope="row">{criterion.label}</th>
                        {alternatives.map((alt) => (
                          <td key={alt.id}>{criterion.render(alt, index)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </CatalogGate>
    </div>
  );
}
