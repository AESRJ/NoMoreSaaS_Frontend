import { formatDate, latestCheckedAt, sourcesFor } from '../format.js';

/**
 * Indica cómo está respaldado un campo: fuente oficial, evaluación editorial
 * o "no verificado" cuando ninguna fuente publicada lo respalda.
 */
export function VerificationNote({ alternative, field }) {
  const sources = sourcesFor(alternative, field);
  const official = sources.filter((source) => source.kind === 'official');
  const editorial = sources.filter((source) => source.kind === 'editorial');

  if (official.length) {
    return <p className="verification verification--official">{`Respaldado por fuente oficial · revisada el ${formatDate(latestCheckedAt(official))}`}</p>;
  }
  if (editorial.length) {
    return <p className="verification verification--editorial">{`Evaluación editorial de NoMoreSaaS · revisada el ${formatDate(latestCheckedAt(editorial))}`}</p>;
  }
  return <p className="verification verification--unverified">No verificado: ninguna fuente publicada respalda este dato.</p>;
}
