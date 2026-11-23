import { useId, useState } from 'react';
import { readBrowserHints } from '../diagnostic.js';

// Ayuda opcional para rellenar el equipo (entrega 007). Nada de esto guarda:
// solo rellena el formulario y marca el origen de cada campo; la persona revisa
// y pulsa Guardar. El navegador solo describe el equipo donde se abre; para
// otro equipo los datos se escriben a mano. Datos desconocidos no rellenan nada.

export const TARGETS = [
  ['this-device', 'Este equipo', 'El ordenador en el que tienes abierto el navegador.'],
  ['other-device', 'Otro equipo', 'Un servidor, NAS o mini PC distinto de este.'],
];

const OS_LABEL = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };

export function formatCapturedAt(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function display(row) {
  if (row.key === 'os' && OS_LABEL[row.display]) return OS_LABEL[row.display];
  return row.unit ? `${row.display} ${row.unit}` : row.display;
}

function PreviewTable({ caption, rows }) {
  return (
    <div className="table-scroll">
      <table className="flow-totals flow-assist__table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Campo</th>
            <th scope="col">Valor</th>
            <th scope="col">Se aplicará</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>
                {display(row)}
                {row.note && <span className="flow-assist__note">{row.note}</span>}
              </td>
              <td>{row.value !== undefined ? 'Sí' : row.error ? <span className="field__error">{row.error}</span> : 'No: queda como está'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrowserHelp({ target, onApply }) {
  const [hints, setHints] = useState(null);
  const applicable = hints?.filter((hint) => hint.value !== undefined) ?? [];
  if (target !== 'this-device') {
    return <p className="field__hint">Solo sirve si evalúas este equipo: el navegador no puede ver otros ordenadores.</p>;
  }
  return (
    <>
      <button type="button" className="button button--secondary button--small" onClick={() => setHints(readBrowserHints())}>
        Leer datos de este navegador
      </button>
      {hints && hints.length === 0 && (
        <p className="field__hint" role="status">
          Este navegador no ofrece datos de hardware. Escríbelos a mano en el formulario.
        </p>
      )}
      {hints && hints.length > 0 && (
        <>
          <PreviewTable caption="Datos aproximados del navegador" rows={hints} />
          <p className="field__hint">El disco no se puede leer desde el navegador: escribe el espacio libre a mano.</p>
          {applicable.length > 0 && (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                onApply(applicable, { source: 'browser', certainty: 'approximate', capturedAt: new Date().toISOString() }, 'Valores aproximados del navegador aplicados al formulario. Revísalos y pulsa Guardar.');
                setHints(null);
              }}
            >
              Usar estos valores aproximados
            </button>
          )}
        </>
      )}
    </>
  );
}

/**
 * @param {{ target: string|null, onTarget: (t: string) => void,
 *   onApply: (rows: {key: string, value: unknown}[], entry: object, message: string) => void }} props
 */
export function ProfileAssist({ target, onTarget, onApply }) {
  const uid = useId();
  return (
    <section className="flow-assist" aria-labelledby={`${uid}-title`}>
      <h3 id={`${uid}-title`} className="flow-assist__title">
        Rellenar con ayuda (opcional)
      </h3>
      <fieldset className="flow-assist__choice">
        <legend className="field__label">¿Qué equipo vas a evaluar?</legend>
        <div className="flow-assist__targets">
          {TARGETS.map(([value, label, hint]) => (
            <label key={value} className="picker__option flow-assist__target">
              <input type="radio" name={`${uid}-target`} value={value} checked={target === value} onChange={() => onTarget(value)} />
              <span>
                <strong>{label}</strong>
                <span className="flow-assist__note">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flow-assist__methods">
        <div className="flow-assist__method">
          <h4>Datos aproximados del navegador</h4>
          <BrowserHelp target={target} onApply={onApply} />
        </div>
      </div>
    </section>
  );
}
