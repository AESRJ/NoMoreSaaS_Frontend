import { Link } from 'react-router';
import { plural } from '../format.js';
import { DifficultyBadge, LicenseBadge } from './Badges.jsx';
import { SelectButton } from './SelectButton.jsx';

export function ServiceCard({ service, alternatives }) {
  return (
    <article className="card card--service">
      <h3 className="card__title">
        <Link to={`/saas/${service.id}`}>{service.name}</Link>
      </h3>
      <p className="card__text">{service.description}</p>
      <p className="card__meta">{`${plural(alternatives.length, 'alternativa', 'alternativas')} en el catálogo:`}</p>
      <ul className="chip-list">
        {alternatives.map((alternative) => (
          <li key={alternative.id}>
            <Link className="chip" to={`/alternativas/${alternative.id}`}>
              {alternative.name}
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function AlternativeCard({ alternative, services }) {
  return (
    <article className="card card--alternative">
      <h3 className="card__title">
        <Link to={`/alternativas/${alternative.id}`}>{alternative.name}</Link>
      </h3>
      <p className="card__text">{alternative.description}</p>
      <p className="badge-row">
        <LicenseBadge license={alternative.license} />
        <DifficultyBadge difficulty={alternative.difficulty} />
      </p>
      <div className="card__meta">
        <span>Sustituye a: </span>
        <ul className="inline-list">
          {services.map((service) => (
            <li key={service.id}>
              <Link to={`/saas/${service.id}`}>{service.name}</Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="card__actions">
        <SelectButton alternative={alternative} />
      </div>
    </article>
  );
}
