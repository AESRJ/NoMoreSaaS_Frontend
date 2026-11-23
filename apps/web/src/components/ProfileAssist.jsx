import { useEffect, useId, useRef, useState } from 'react';
import { MAX_DIAGNOSTIC_BYTES, bytesToGiB, formatNumber, importRows, parseDiagnostic, readBrowserHints } from '../diagnostic.js';

// Ayuda opcional para rellenar el equipo (entrega 007). Nada de esto guarda:
// solo rellena el formulario y marca el origen de cada campo; la persona revisa
// y pulsa Guardar. El navegador solo describe el equipo donde se abre; el
// diagnóstico describe el equipo donde se ejecutó. Datos desconocidos no
// rellenan nada.

export const TARGETS = [
  ['this-device', 'Este equipo', 'El ordenador en el que tienes abierto el navegador.'],
  ['other-device', 'Otro equipo', 'Un servidor, NAS o mini PC distinto de este.'],
];

const DOWNLOAD = '/downloads/nomoresaas-diagnostico.mjs';
const GUIDE = '/downloads/nomoresaas-diagnostico-LEEME.txt';
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
          Este navegador no ofrece datos de hardware. Escríbelos a mano o importa un diagnóstico.
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

function DiagnosticImport({ target, onApply }) {
  const uid = useId();
  const inputRef = useRef(null);
  const [state, setState] = useState(null);
  const [volume, setVolume] = useState(null);
  // Solo la selección más reciente puede mostrar vista previa: cada elección,
  // cancelación o desmontaje invalida las lecturas anteriores aún pendientes.
  const readId = useRef(0);
  useEffect(
    () => () => {
      readId.current += 1;
    },
    [],
  );

  async function choose(event) {
    const id = ++readId.current;
    const file = event.target.files?.[0];
    setVolume(null);
    if (!file) {
      setState(null);
      return;
    }
    if (file.size > MAX_DIAGNOSTIC_BYTES) {
      setState({ ok: false, errors: ['El archivo supera 64 KiB; no es un diagnóstico de NoMoreSaaS.'] });
      return;
    }
    setState({ loading: true });
    let result;
    try {
      result = parseDiagnostic(await file.text());
    } catch {
      result = { ok: false, errors: ['No se pudo leer el archivo.'] };
    }
    if (id !== readId.current) return; // lectura obsoleta: otra selección la sustituyó
    setState(result);
    if (result.ok && result.diagnostic.volumes.length === 1) setVolume(0);
  }

  const rows = state?.ok ? importRows(state.diagnostic, volume ?? undefined) : [];
  const applicable = rows.filter((row) => row.value !== undefined);

  function apply() {
    if (!state?.ok) return;
    readId.current += 1;
    onApply(applicable, { source: 'import', certainty: 'reported', capturedAt: state.diagnostic.capturedAt }, 'Datos del diagnóstico aplicados al formulario. Revísalos y pulsa Guardar; aún no se ha guardado nada.');
    setState(null);
    setVolume(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <>
      <p className="field__hint">
        Descarga el <a href={DOWNLOAD} download>recopilador para Windows (Node 22+)</a> y lee la <a href={GUIDE}>guía de uso</a>. Ejecútalo en el equipo que vas a evaluar: solo lee, no usa la red y crea un JSON que puedes revisar.
      </p>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-file`}>
          Archivo de diagnóstico (.json)
        </label>
        <input
          ref={inputRef}
          id={`${uid}-file`}
          className="field__file"
          type="file"
          accept=".json,application/json"
          onChange={choose}
          aria-describedby={state && state.ok === false ? `${uid}-errors` : undefined}
        />
      </div>
      {state?.loading && (
        <p className="field__hint" role="status">
          Leyendo el archivo…
        </p>
      )}
      {state && state.ok === false && (
        <div id={`${uid}-errors`} className="form-alert" role="alert">
          <p>No se puede importar este archivo. El formulario no ha cambiado.</p>
          <ul className="bullet-list">
            {state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      {state?.ok && (
        <div className="flow-assist__preview">
          <p className="field__hint">
            Capturado el {formatCapturedAt(state.diagnostic.capturedAt)}
            {state.diagnostic.cpu.model && <> · CPU: {state.diagnostic.cpu.model}</>}
            {state.diagnostic.cpu.logicalThreads && <> · {state.diagnostic.cpu.logicalThreads} hilos lógicos</>}
            {state.diagnostic.gpuNames.length > 0 && <> · GPU (informativo): {state.diagnostic.gpuNames.join(', ')}</>}
          </p>
          {state.warnings.map((warning) => (
            <p key={warning} className="callout callout--warning" role="note">
              {warning}
            </p>
          ))}
          {state.diagnostic.volumes.length > 1 && (
            <fieldset className="flow-assist__choice">
              <legend className="field__label">¿En qué volumen guardarás los servicios?</legend>
              {state.diagnostic.volumes.map((item, index) => (
                // Índice en el JSON leído: estable para esta vista previa y único aunque se repitan etiquetas.
                <label key={index} className="picker__option">
                  <input type="radio" name={`${uid}-volume`} checked={volume === index} onChange={() => setVolume(index)} />
                  <span>
                    {item.label}: {formatNumber(bytesToGiB(item.freeBytes))} GiB libres de {formatNumber(bytesToGiB(item.sizeBytes))} GiB
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <PreviewTable caption="Vista previa del diagnóstico" rows={rows} />
          {!target && <p className="field__hint">Elige arriba qué equipo vas a evaluar para poder aplicar estos datos.</p>}
          <button type="button" className="button button--secondary button--small" onClick={apply} disabled={!target || applicable.length === 0}>
            Aplicar al formulario
          </button>
        </div>
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
        <div className="flow-assist__method">
          <h4>Importar diagnóstico de Windows</h4>
          <DiagnosticImport target={target} onApply={onApply} />
        </div>
      </div>
    </section>
  );
}
