import { useId, useState } from 'react';
import { normalizeQuery, searchCatalog, servicesForResult } from '../catalog-index.js';

/**
 * Selector de proyecto por servicio conocido (005 US3). El usuario busca el
 * servicio que usa y marca sus reemplazos; la selección (ProjectSelection.
 * alternativeIds) se muestra como chips «servicio → alternativa», en orden de
 * alta, sin duplicados. Las retiradas siguen visibles hasta que se quitan.
 * Produce solo IDs; el formulario conserva validación, límites y envío de 003.
 */
export function ServiceReplacementPicker({ index, ids, onChange, retiredIds, error, errorId, max, min }) {
  const baseId = useId();
  const searchId = `${baseId}-buscar`;
  const hintId = `${baseId}-buscar-ayuda`;
  const [query, setQuery] = useState('');
  const full = ids.length >= max;
  const services = servicesForResult(index, searchCatalog(index, query));
  const filtered = Boolean(normalizeQuery(query));

  const servicesOf = (alternativeId) => index.servicesForAlternative(alternativeId).map((service) => service.name).join(', ');

  function toggle(id, checked) {
    if (checked) {
      if (!ids.includes(id)) onChange([...ids, id]);
    } else {
      onChange(ids.filter((current) => current !== id));
    }
  }

  return (
    <fieldset className="field picker" aria-describedby={error ? errorId : undefined}>
      <legend className="field__label">
        Reemplazos ({ids.length} de {max})
      </legend>
      <p className="field__hint">
        Busca cada servicio que usas y marca su reemplazo. Elige entre {min} y {max}; se guardan en el orden en que los añades.
      </p>
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}

      {ids.length > 0 && (
        <ol className="picker__selected" aria-label="Reemplazos elegidos">
          {ids.map((id) => {
            const retired = retiredIds.has(id);
            const alternative = retired ? null : index.alternative(id);
            const label = alternative ? `${servicesOf(id)} → ${alternative.name}` : `No disponible (${id})`;
            return (
              <li key={id} className="picker__item">
                {alternative ? (
                  <span>
                    <span className="picker__service">{servicesOf(id)}</span>
                    {' → '}
                    <strong>{alternative.name}</strong>
                  </span>
                ) : (
                  <span className="retired">
                    <span className="tag tag--retired">No disponible</span> <code className="retired__id">{id}</code>
                    <span className="picker__retired-hint"> Ya no está en el catálogo; quítala y elige otro reemplazo.</span>
                  </span>
                )}
                <button type="button" className="button button--ghost button--small" aria-label={`Quitar ${label}`} onClick={() => toggle(id, false)}>
                  Quitar
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="picker__search">
        <label className="field__label" htmlFor={searchId}>
          Servicio que quieres reemplazar
        </label>
        <input
          id={searchId}
          className="field__input"
          type="search"
          autoComplete="off"
          spellCheck="false"
          placeholder="Por ejemplo, Google Drive"
          aria-describedby={hintId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // Enter filtra; no envía el formulario del proyecto.
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
        <p id={hintId} className="field__hint">
          {filtered ? `${services.length === 1 ? '1 servicio coincide' : `${services.length} servicios coinciden`}.` : 'Se muestran todos los servicios del catálogo.'}
        </p>
      </div>

      {services.length === 0 ? (
        <p className="picker__empty">
          {`Ningún servicio coincide con «${query.trim()}».`}{' '}
          <button type="button" className="button button--ghost button--small" onClick={() => setQuery('')}>
            Ver todos los servicios
          </button>
        </p>
      ) : (
        <ul className="picker__services">
          {services.map((service) => {
            const groupId = `${baseId}-${service.id}`;
            return (
              <li key={service.id} className="picker__group" role="group" aria-labelledby={groupId}>
                <p id={groupId} className="picker__group-title">
                  {service.name}
                </p>
                <ul className="picker__options">
                  {index.alternativesForService(service.id).map((alternative) => {
                    const checked = ids.includes(alternative.id);
                    return (
                      <li key={alternative.id}>
                        <label className="picker__option">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && full}
                            onChange={(event) => toggle(alternative.id, event.target.checked)}
                          />
                          <span>{alternative.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {full && <p className="field__hint">Has llegado al máximo de {max}. Quita alguno para elegir otro.</p>}
    </fieldset>
  );
}
