// Etiquetas en español y utilidades de presentación de datos del catálogo.

const dateFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' });

export function formatDate(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 'fecha desconocida';
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'fecha desconocida' : dateFormatter.format(date);
}

export const DIFFICULTY_LABELS = {
  basic: 'Básica',
  intermediate: 'Intermedia',
  advanced: 'Avanzada',
  unknown: 'Desconocida',
};

export const LICENSE_CLASSIFICATION_LABELS = {
  'open-source': 'Código abierto',
  'source-available': 'Código disponible (no open source)',
  unknown: 'Clasificación desconocida',
};

export const FIELD_LABELS = {
  name: 'Nombre',
  description: 'Descripción',
  capabilities: 'Capacidades',
  limitations: 'Limitaciones',
  license: 'Licencia',
  difficulty: 'Dificultad',
  hostingNotes: 'Requisitos de autoalojamiento',
  officialUrl: 'Sitio oficial',
  documentationUrl: 'Documentación',
};

export function difficultyLabel(level) {
  return DIFFICULTY_LABELS[level] ?? DIFFICULTY_LABELS.unknown;
}

export function sourcesFor(alternative, field) {
  return (alternative.sources ?? []).filter((source) => Array.isArray(source.supports) && source.supports.includes(field));
}

/** Fecha ISO más reciente entre las fuentes (las fechas ISO se comparan como texto). */
export function latestCheckedAt(sources) {
  return (sources ?? []).reduce((latest, source) => (source.checkedAt > latest ? source.checkedAt : latest), '');
}

/** Solo HTTP(S) absolutas; cualquier otro esquema se descarta. */
export function safeHref(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
