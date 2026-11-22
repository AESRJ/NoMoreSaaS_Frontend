import { LICENSE_CLASSIFICATION_LABELS, difficultyLabel } from '../format.js';

export function LicenseBadge({ license }) {
  const classification = LICENSE_CLASSIFICATION_LABELS[license.classification] ?? LICENSE_CLASSIFICATION_LABELS.unknown;
  // Solo el código abierto se sobrentiende; cualquier otra clasificación se muestra visible, no solo en el title.
  const visible = license.classification === 'open-source' ? license.label : `${license.label} · ${classification}`;
  return (
    <span className={`badge badge--license badge--${license.classification}`} title={classification}>
      {visible}
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
