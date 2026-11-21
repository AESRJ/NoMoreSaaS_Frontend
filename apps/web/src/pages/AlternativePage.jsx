import { Link, useParams } from 'react-router';
import { ExternalLink } from '../components/ExternalLink.jsx';
import { Icon } from '../components/Icon.jsx';
import { SelectButton } from '../components/SelectButton.jsx';
import { SourceList } from '../components/SourceList.jsx';
import { CatalogGate, NotFoundContent } from '../components/StatusViews.jsx';
import { VerificationNote } from '../components/Verification.jsx';
import { LICENSE_CLASSIFICATION_LABELS, difficultyLabel, formatDate, latestCheckedAt } from '../format.js';
import { useCatalog } from '../hooks/useCatalog.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

function Section({ id, title, children }) {
  return (
    <section className="detail-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function AlternativePage() {
  const { id } = useParams();
  const catalog = useCatalog();
  const alternative = catalog.index?.alternative(id) ?? null;
  useDocumentTitle(alternative ? alternative.name : catalog.status === 'success' ? 'Alternativa no encontrada' : 'Cargando');

  return (
    <CatalogGate catalog={catalog}>
      {(index) => {
        if (!alternative) {
          return (
            <NotFoundContent title="No encontramos esta alternativa">
              El enlace no corresponde a ninguna alternativa publicada en el catálogo.
            </NotFoundContent>
          );
        }
        const relations = index.relationsForAlternative(alternative.id);
        const latest = latestCheckedAt(alternative.sources);
        return (
          <article className="page detail">
            <p className="breadcrumb">
              <Link to="/">
                <Icon name="arrow-left" />
                Volver al catálogo
              </Link>
            </p>
            <header className="page-header detail__header">
              <div>
                <h1>{alternative.name}</h1>
                <p className="hero__lead">{alternative.description}</p>
                <p className="page-meta">
                  <span className="tag">Alternativa autoalojable</span>
                  <span>{`Última revisión de fuentes: ${formatDate(latest)}`}</span>
                </p>
              </div>
              <div className="detail__actions">
                <SelectButton alternative={alternative} />
              </div>
            </header>

            <div className="detail__grid">
              <Section id="sustituye" title="Sustituye a">
                <ul className="stack stack--tight">
                  {relations.map((relation) => {
                    const service = index.service(relation.serviceId);
                    return (
                      <li key={service.id}>
                        <Link className="strong-link" to={`/saas/${service.id}`}>
                          {service.name}
                        </Link>
                        <p>{relation.coverage}</p>
                      </li>
                    );
                  })}
                </ul>
              </Section>

              <Section id="capacidades" title="Capacidades">
                <ul className="bullet-list">
                  {alternative.capabilities.map((capability, i) => (
                    <li key={i}>{capability}</li>
                  ))}
                </ul>
                <VerificationNote alternative={alternative} field="capabilities" />
              </Section>

              <Section id="limitaciones" title="Limitaciones">
                {alternative.limitations.length ? (
                  <ul className="bullet-list">
                    {alternative.limitations.map((limitation, i) => (
                      <li key={i}>{limitation}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No se documentaron limitaciones en este registro; eso no implica que no existan.</p>
                )}
                <VerificationNote alternative={alternative} field="limitations" />
              </Section>

              <Section id="licencia" title="Licencia">
                <p>
                  <ExternalLink href={alternative.license.url} unavailableLabel="Texto de la licencia" className="strong-link">
                    {alternative.license.label}
                  </ExternalLink>
                </p>
                <p className="muted">{LICENSE_CLASSIFICATION_LABELS[alternative.license.classification]}</p>
                <VerificationNote alternative={alternative} field="license" />
              </Section>

              <Section id="dificultad" title="Dificultad de autoalojamiento">
                <p className={`level level--${alternative.difficulty.level}`}>{difficultyLabel(alternative.difficulty.level)}</p>
                <p>{alternative.difficulty.explanation}</p>
                <VerificationNote alternative={alternative} field="difficulty" />
              </Section>

              <Section id="requisitos" title="Requisitos de autoalojamiento">
                <p>{alternative.hostingNotes}</p>
                <VerificationNote alternative={alternative} field="hostingNotes" />
              </Section>

              <Section id="enlaces" title="Enlaces oficiales">
                <ul className="stack stack--tight">
                  <li>
                    <ExternalLink href={alternative.officialUrl} unavailableLabel="Sitio oficial" className="strong-link">
                      {`Sitio oficial de ${alternative.name}`}
                    </ExternalLink>
                  </li>
                  <li>
                    <ExternalLink href={alternative.documentationUrl} unavailableLabel="Documentación oficial" className="strong-link">
                      {`Documentación oficial de ${alternative.name}`}
                    </ExternalLink>
                  </li>
                </ul>
              </Section>
            </div>

            <Section id="fuentes" title="Fuentes y fecha de revisión">
              <p className="muted">
                Las fuentes oficiales respaldan hechos; las evaluaciones editoriales de NoMoreSaaS se identifican como tales e incluyen su
                motivo.
              </p>
              <SourceList sources={alternative.sources} />
            </Section>
          </article>
        );
      }}
    </CatalogGate>
  );
}
