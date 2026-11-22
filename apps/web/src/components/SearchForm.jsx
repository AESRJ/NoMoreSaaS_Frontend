import { useId } from 'react';

/** Formulario de búsqueda etiquetado. El filtrado es local; no hay petición por pulsación. */
export function SearchForm({ value, onChange, inputRef }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
      <label className="search__label" htmlFor={id}>
        Buscar SaaS o alternativa
      </label>
      <input
        ref={inputRef}
        id={id}
        className="search__input"
        type="search"
        name="q"
        autoComplete="off"
        spellCheck="false"
        placeholder="Por ejemplo: Google Drive o WireGuard"
        aria-describedby={hintId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={hintId} className="search__hint">
        Busca por el nombre del servicio que usas o de la alternativa; no distingue mayúsculas.
      </p>
    </form>
  );
}
