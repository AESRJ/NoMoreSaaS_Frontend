import { useId } from 'react';

/** Formulario de búsqueda etiquetado. El filtrado es local; no hay petición por pulsación. */
export function SearchForm({ value, onChange, inputRef }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
      <label className="search__label" htmlFor={id}>
        Encuentra una alternativa
      </label>
      <input
        ref={inputRef}
        id={id}
        className="search__input"
        type="search"
        name="q"
        autoComplete="off"
        spellCheck="false"
        placeholder="Por ejemplo, Google Drive"
        aria-describedby={hintId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={hintId} className="search__hint">
        Escribe el nombre del servicio que quieres reemplazar.
      </p>
    </form>
  );
}
