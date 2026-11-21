import { Link, useParams } from 'react-router';
import { DifficultyBadge, LicenseBadge } from '../components/Badges.jsx';
import { SelectButton } from '../components/SelectButton.jsx';
import { CatalogGate, NotFoundContent } from '../components/StatusViews.jsx';
import { useCatalog } from '../hooks/useCatalog.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export function ServicePage() {
  const { id } = useParams();
  const catalog = useCatalog();
  const service = catalog.index?.service(id) ?? null;
  useDocumentTitle(service ? `Alternativas a ${service.name}` : catalog.status === 'success' ? 'SaaS no encontrado' : 'Cargando');

  return (
    <CatalogGate catalog={catalog}>
      {(index) => {
        if (!service) {
          return <NotFoundContent title="No encontramos este SaaS">El servicio solicitado no existe en el catálogo.</NotFoundContent>;
        }
        const relations = index.relationsForService(service.id);
        return (
          <div className="page">
            <p className="breadcrumb">
              <Link to="/">Volver al catálogo</Link>
            </p>
            <header className="page-header">
              <p className="eyebrow">Servicio SaaS</p>
              <h1>{service.name}</h1>
              <p className="hero__lead">{service.description}</p>
            </header>
            <p className="callout">
              Cada alternativa cubre parte de la necesidad descrita; el catálogo no garantiza una equivalencia completa con el servicio
              original.
            </p>
            <section className="section" aria-labelledby="relacionadas-titulo">
              <h2 id="relacionadas-titulo">{`Alternativas a ${service.name}`}</h2>
              <ul className="stack">
                {relations.map((relation) => {
                  const alternative = index.alternative(relation.alternativeId);
                  return (
                    <li key={alternative.id} className="card card--relation">
                      <h3 className="card__title">
                        <Link to={`/alternativas/${alternative.id}`}>{alternative.name}</Link>
                      </h3>
                      <p className="card__text">{alternative.description}</p>
                      <h4 className="card__subtitle">Qué cubre y diferencias</h4>
                      <p className="card__text">{relation.coverage}</p>
                      <p className="badge-row">
                        <LicenseBadge license={alternative.license} />
                        <DifficultyBadge difficulty={alternative.difficulty} />
                      </p>
                      <div className="card__actions">
                        <SelectButton alternative={alternative} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        );
      }}
    </CatalogGate>
  );
}
