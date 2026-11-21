import { FIELD_LABELS, formatDate } from '../format.js';
import { ExternalLink } from './ExternalLink.jsx';

export function SourceList({ sources }) {
  return (
    <ol className="source-list">
      {sources.map((source, index) => (
        <li key={`${source.url}-${index}`} className={`source source--${source.kind}`}>
          <p className="source__head">
            <span className={`badge badge--${source.kind}`}>{source.kind === 'official' ? 'Fuente oficial' : 'Evaluación editorial'}</span>
            <span className="source__date">{`Revisada el ${formatDate(source.checkedAt)}`}</span>
          </p>
          <p className="source__url">
            <ExternalLink href={source.url} unavailableLabel="Fuente">
              {source.url}
            </ExternalLink>
          </p>
          <p className="source__supports">{`Respalda: ${source.supports.map((field) => FIELD_LABELS[field] ?? field).join(', ')}`}</p>
          {source.note ? <p className="source__note">{source.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}
