// Iconos SVG decorativos con un mismo trazo (1.5 px sobre 16 px). Siempre ocultos a lectores de pantalla.
const PATHS = {
  plus: 'M8 3.5v9M3.5 8h9',
  check: 'M3.5 8.5l3 3 6-7',
  'arrow-left': 'M12.5 8h-9M7 4.5L3.5 8 7 11.5',
  'arrow-right': 'M3.5 8h9M9 4.5l3.5 3.5L9 11.5',
  info: 'M8 7.25v4M8 4.75v.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z',
  alert: 'M8 6v3M8 11.25v.01M7.13 2.5 1.7 12a1 1 0 0 0 .87 1.5h10.86a1 1 0 0 0 .87-1.5L8.87 2.5a1 1 0 0 0-1.74 0Z',
  external: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3',
};

export function Icon({ name, className = '' }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
