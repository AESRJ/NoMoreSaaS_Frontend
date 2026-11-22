import { useId, useState } from 'react';
import { Link } from 'react-router';
import { LICENSE_CLASSIFICATION_LABELS, difficultyLabel, formatDate, latestCheckedAt, plural } from '../format.js';
import { ExternalLink } from './ExternalLink.jsx';
import { VerificationNote } from './Verification.jsx';

/** Monograma del círculo: iniciales de hasta dos palabras («Google Drive» → «GD»). */
export function monogram(name) {
  const words = name.split(/[\s()]+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('')
    .toLocaleUpperCase('es');
}

function Cell({ label, children }) {
  return (
    <div className="compare-cell">
      <p className="compare-cell__label">{label}</p>
      {children}
    </div>
  );
}

function Unknown({ children }) {
  return <p className="compare-unknown">{children}</p>;
}

function Row({ title, children }) {
  return (
    <div className="compare-row">
      <h4 className="compare-row__title">{title}</h4>
      <div className="compare-row__cells">{children}</div>
    </div>
  );
}

function ServiceSources({ service }) {
  const sources = Array.isArray(service.sources) ? service.sources : [];
  if (!sources.length) {
    return <Unknown>{`Sin fuente oficial registrada para ${service.name}.`}</Unknown>;
  }
  return (
    <ul className="stack stack--tight">
      {sources.map((source, i) => (
        <li key={`${source.url}-${i}`}>
          <ExternalLink href={source.url} unavailableLabel="Fuente oficial">
            {`Fuente oficial de ${service.name}`}
          </ExternalLink>
          <p>{source.note}</p>
          <p>{`Revisada el ${formatDate(source.checkedAt)}`}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Comparativa servicio ↔ alternativa: solo atributos del catálogo con fuente;
 * lo que el catálogo no documenta del servicio se declara desconocido.
 */
function Comparison({ id, service, alternative, relation }) {
  const titleId = `${id}-titulo`;
  return (
    <section id={id} className="comparison" aria-labelledby={titleId}>
      <h3 id={titleId} className="comparison__title">
        {service.name} <span className="comparison__vs">frente a</span> {alternative.name}
      </h3>

      <Row title="Qué es">
        <Cell label={service.name}>
          <p>{service.description}</p>
        </Cell>
        <Cell label={alternative.name}>
          <p>{alternative.description}</p>
        </Cell>
      </Row>

      <Row title={`Qué cubre de ${service.name}`}>
        <Cell label={alternative.name}>
          <p>{relation.coverage}</p>
          <p className="muted">El catálogo no garantiza una equivalencia completa con el servicio original.</p>
        </Cell>
      </Row>

      <Row title="Capacidades">
        <Cell label={service.name}>
          <Unknown>Desconocido: el catálogo no documenta sus capacidades.</Unknown>
        </Cell>
        <Cell label={alternative.name}>
          <ul className="bullet-list">
            {alternative.capabilities.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <VerificationNote alternative={alternative} field="capabilities" />
        </Cell>
      </Row>

      <Row title="Limitaciones">
        <Cell label={service.name}>
          <Unknown>Desconocido: el catálogo no documenta sus limitaciones.</Unknown>
        </Cell>
        <Cell label={alternative.name}>
          {alternative.limitations.length ? (
            <ul className="bullet-list">
              {alternative.limitations.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>No documentadas en este registro; no implica que no existan.</p>
          )}
          <VerificationNote alternative={alternative} field="limitations" />
        </Cell>
      </Row>

      <Row title="Licencia">
        <Cell label={service.name}>
          <Unknown>Desconocida en este catálogo.</Unknown>
        </Cell>
        <Cell label={alternative.name}>
          <p>
            <ExternalLink href={alternative.license.url} unavailableLabel="Licencia">
              {alternative.license.label}
            </ExternalLink>
          </p>
          <p className="muted">{LICENSE_CLASSIFICATION_LABELS[alternative.license.classification]}</p>
        </Cell>
      </Row>

      <Row title="Alojamiento y mantenimiento">
        <Cell label={service.name}>
          <Unknown>Desconocido: el catálogo no documenta con fuente quién lo aloja ni cómo se mantiene.</Unknown>
        </Cell>
        <Cell label={alternative.name}>
          <p>{alternative.hostingNotes}</p>
          <VerificationNote alternative={alternative} field="hostingNotes" />
          <p>{`Dificultad: ${difficultyLabel(alternative.difficulty.level)} (evaluación editorial). ${alternative.difficulty.explanation}`}</p>
        </Cell>
      </Row>

      <Row title="Fuentes">
        <Cell label={service.name}>
          <ServiceSources service={service} />
        </Cell>
        <Cell label={alternative.name}>
          <p>{`${plural(alternative.sources.length, 'fuente', 'fuentes')} · última revisión ${formatDate(latestCheckedAt(alternative.sources))}`}</p>
        </Cell>
      </Row>

      <p className="comparison__more">
        <Link className="strong-link" to={`/alternativas/${alternative.id}`}>{`Ver ficha completa de ${alternative.name}`}</Link>
      </p>
    </section>
  );
}

/**
 * Explorador por servicio: círculos de servicios; al abrir uno se despliega el
 * árbol de sus alternativas y, al elegir una, la comparativa en la misma página.
 * Estado (ExplorerState) ligado a pares válidos del catálogo:
 * - chosenServiceId: undefined (sin elección), null (cerrado a propósito) o ID.
 * - chosenAlternativeId: solo cuenta si se relaciona con el servicio activo.
 */
export function ServiceExplorer({ index, services, query, autoExpandId = null }) {
  const baseId = useId();
  const treeId = `${baseId}-arbol`;
  const comparisonId = `${baseId}-comparativa`;
  const [chosenServiceId, setChosenServiceId] = useState(undefined);
  const [chosenAlternativeId, setChosenAlternativeId] = useState(null);

  // Una búsqueda nueva vuelve a permitir abrir automáticamente el único resultado.
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    if (chosenServiceId === null) setChosenServiceId(undefined);
  }

  const visible = new Set(services.map((service) => service.id));
  let activeServiceId = null;
  if (chosenServiceId && visible.has(chosenServiceId)) activeServiceId = chosenServiceId;
  else if (chosenServiceId !== null && autoExpandId && visible.has(autoExpandId)) activeServiceId = autoExpandId;

  const activeService = activeServiceId ? index.service(activeServiceId) : null;
  const relations = activeService ? index.relationsForService(activeService.id) : [];
  const activeRelation = relations.find((relation) => relation.alternativeId === chosenAlternativeId) ?? null;
  const activeAlternative = activeRelation ? index.alternative(activeRelation.alternativeId) : null;

  function toggleService(id) {
    setChosenAlternativeId(null);
    setChosenServiceId(id === activeServiceId ? null : id);
  }

  function toggleAlternative(id) {
    setChosenServiceId(activeServiceId);
    setChosenAlternativeId(id === activeAlternative?.id ? null : id);
  }

  let announcement = '';
  if (activeAlternative) announcement = `Comparando ${activeService.name} con ${activeAlternative.name}.`;
  else if (activeService) announcement = `${activeService.name}: ${plural(relations.length, 'alternativa', 'alternativas')}.`;

  return (
    <div className="explorer">
      <ul className="orbit">
        {services.map((service) => {
          const expanded = service.id === activeServiceId;
          const count = index.relationsForService(service.id).length;
          return (
            <li key={service.id} className="orbit__item">
              <button
                type="button"
                className={`orbit__node${expanded ? ' orbit__node--active' : ''}`}
                aria-expanded={expanded}
                aria-controls={expanded ? treeId : undefined}
                onClick={() => toggleService(service.id)}
              >
                <span className="orbit__mark" aria-hidden="true">
                  {monogram(service.name)}
                </span>
                <span className="orbit__name">{service.name}</span>{' '}
                <span className="orbit__count">{plural(count, 'alternativa', 'alternativas')}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="sr-only" role="status">
        {announcement}
      </p>

      {activeService ? (
        <section id={treeId} key={activeService.id} className="branch" aria-labelledby={`${treeId}-titulo`}>
          <div className="branch__head">
            <h3 id={`${treeId}-titulo`}>{`Alternativas a ${activeService.name}`}</h3>
            <Link to={`/saas/${activeService.id}`}>{`Página de ${activeService.name}`}</Link>
          </div>
          <p className="branch__hint">{`Elige una para compararla con ${activeService.name}.`}</p>
          <ul className="tree">
            {relations.map((relation) => {
              const alternative = index.alternative(relation.alternativeId);
              const selected = alternative.id === activeAlternative?.id;
              return (
                <li key={alternative.id} className="tree__branch">
                  <button
                    type="button"
                    className={`tree__node${selected ? ' tree__node--active' : ''}`}
                    aria-expanded={selected}
                    aria-controls={selected ? comparisonId : undefined}
                    onClick={() => toggleAlternative(alternative.id)}
                  >
                    <span className="tree__dot" aria-hidden="true" />
                    {alternative.name}
                  </button>
                </li>
              );
            })}
          </ul>
          {activeAlternative ? (
            <Comparison
              key={activeAlternative.id}
              id={comparisonId}
              service={activeService}
              alternative={activeAlternative}
              relation={activeRelation}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
