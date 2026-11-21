import { LICENSE_CLASSIFICATION_LABELS, difficultyLabel } from '../format.js';

export function LicenseBadge({ license }) {
  return (
    <span className="badge badge--license" title={LICENSE_CLASSIFICATION_LABELS[license.classification]}>
      {license.label}
    </span>
  );
}

export function DifficultyBadge({ difficulty }) {
  return (
    <span className={`badge badge--difficulty badge--${difficulty.level}`}>
      {`Dificultad: ${difficultyLabel(difficulty.level)} (editorial)`}
    </span>
  );
}
