// Ayuda opcional para rellenar el equipo (entrega 007): lectura aproximada del
// navegador. Solo rellena el formulario; la persona revisa y guarda.

// Límites del perfil (data-model 004): fuera de rango es error, nunca se recorta.
export const PROFILE_LIMITS = {
  cpuCores: { min: 1, max: 256 },
  ramGiB: { min: 0.5, max: 4096 },
  storageGiB: { min: 1, max: 100000 },
};

const NUMBER = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
/** Número para mostrar en español (coma decimal); el valor aplicado sigue siendo numérico. */
export const formatNumber = (n) => NUMBER.format(n);

/** `value` debe ser el valor EXACTO (sin redondear): el rango nunca se comprueba tras recortar. */
function rangeError(key, value, unit) {
  const { min, max } = PROFILE_LIMITS[key];
  if (value > max) return `Fuera del rango admitido (${min}–${max} ${unit}): supera el máximo. Escríbelo a mano.`;
  if (value < min) return `Fuera del rango admitido (${min}–${max} ${unit}): está por debajo del mínimo. Escríbelo a mano.`;
  return null;
}

/**
 * Lectura aproximada del navegador (solo describe el equipo donde se abre).
 * hardwareConcurrency son hilos lógicos disponibles, no núcleos físicos;
 * deviceMemory es opcional, redondeado y limitado por el navegador. No se usa
 * storage.estimate: la cuota de un sitio no es espacio libre en disco.
 */
export function readBrowserHints(nav = globalThis.navigator) {
  const hints = [];
  const threads = nav?.hardwareConcurrency;
  if (Number.isInteger(threads) && threads >= 1) {
    const error = rangeError('cpuCores', threads, 'hilos');
    hints.push({ key: 'cpuCores', label: 'Hilos de CPU disponibles (aprox.)', display: String(threads), unit: 'hilos', note: 'Hilos lógicos que el navegador deja usar; pueden ser menos que los reales y no son núcleos físicos.', ...(error ? { error } : { value: threads }) });
  }
  const memory = nav?.deviceMemory;
  if (typeof memory === 'number' && Number.isFinite(memory) && memory > 0) {
    const error = rangeError('ramGiB', memory, 'GiB');
    hints.push({ key: 'ramGiB', label: 'RAM aproximada', display: formatNumber(memory), unit: 'GiB', note: 'El navegador la redondea y la limita (a menudo a 8 GiB como máximo).', ...(error ? { error } : { value: memory }) });
  }
  return hints;
}
