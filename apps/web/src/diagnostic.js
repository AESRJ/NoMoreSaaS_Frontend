// Ayuda opcional para rellenar el equipo (entrega 007): importación del
// diagnóstico local (esquema Diagnostic v1 de data-model.md) y lectura
// aproximada del navegador. Todo ocurre en el navegador: el archivo nunca se
// envía entero al servidor; solo se aplican al formulario campos normalizados
// que la persona revisa y guarda explícitamente. Los textos del archivo nunca
// se evalúan ni se usan como HTML/URL: React los muestra como texto.

export const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const OLD_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const GIB = 1024 ** 3;

const TOP_KEYS = ['schemaVersion', 'capturedAt', 'os', 'architecture', 'cpu', 'ramBytes', 'volumes', 'gpuNames'];
const REQUIRED_KEYS = TOP_KEYS.filter((key) => key !== 'gpuNames');
const CPU_KEYS = ['model', 'physicalCores', 'logicalThreads'];
const VOLUME_KEYS = ['freeBytes', 'label', 'sizeBytes'];
const OS = ['windows', 'linux', 'macos', 'unknown'];
const ARCHITECTURES = ['amd64', 'arm64', 'unknown'];
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const VOLUME_LABEL = /^Volume ([1-9]\d?)$/;

// Límites del perfil (data-model 004): fuera de rango es error, nunca se recorta.
export const PROFILE_LIMITS = {
  cpuCores: { min: 1, max: 256 },
  ramGiB: { min: 0.5, max: 4096 },
  storageGiB: { min: 1, max: 100000 },
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const intIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const textOk = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 200;

/** Bytes → GiB redondeando hacia abajo a 2 decimales (nunca sobrestima). */
export const bytesToGiB = (bytes) => Math.floor((bytes / GIB) * 100) / 100;

const NUMBER = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
/** Número para mostrar en español (coma decimal); el valor aplicado sigue siendo numérico. */
export const formatNumber = (n) => NUMBER.format(n);

function isInstant(value) {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19);
}

/**
 * Valida el texto de un archivo de diagnóstico. Devuelve
 * {ok:true, diagnostic, warnings} o {ok:false, errors:[texto]}. Rechaza campos
 * extra, anidamientos inesperados, tipos o rangos inválidos y tamaño > 64 KiB.
 */
export function parseDiagnostic(text, { now = Date.now() } = {}) {
  if (typeof text !== 'string') return { ok: false, errors: ['No se pudo leer el archivo.'] };
  if (new TextEncoder().encode(text).length > MAX_DIAGNOSTIC_BYTES) {
    return { ok: false, errors: ['El archivo supera 64 KiB; no es un diagnóstico de NoMoreSaaS.'] };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['El archivo no es JSON válido.'] };
  }
  if (!isObject(data)) return { ok: false, errors: ['El archivo no tiene el formato de diagnóstico esperado.'] };

  const errors = [];
  const extra = Object.keys(data).filter((key) => !TOP_KEYS.includes(key));
  if (extra.length) errors.push(`Contiene campos no admitidos (${extra.length}).`);
  const missing = REQUIRED_KEYS.filter((key) => !Object.hasOwn(data, key));
  if (missing.length) errors.push(`Faltan campos obligatorios: ${missing.join(', ')}.`);
  if (errors.length) return { ok: false, errors };

  if (data.schemaVersion !== 1) errors.push('Versión de esquema no compatible (se espera 1).');
  const capturedMs = isInstant(data.capturedAt) ? Date.parse(data.capturedAt) : Number.NaN;
  if (!Number.isFinite(capturedMs)) errors.push('Fecha de captura no válida.');
  else if (capturedMs > now + FUTURE_TOLERANCE_MS) errors.push('La fecha de captura está en el futuro.');
  if (!OS.includes(data.os)) errors.push('Sistema operativo no válido.');
  if (!ARCHITECTURES.includes(data.architecture)) errors.push('Arquitectura no válida.');

  const cpu = data.cpu;
  if (!isObject(cpu) || Object.keys(cpu).some((key) => !CPU_KEYS.includes(key))) {
    errors.push('Datos de CPU con formato no válido.');
  } else {
    if (Object.hasOwn(cpu, 'model') && !textOk(cpu.model)) errors.push('Modelo de CPU no válido.');
    if (Object.hasOwn(cpu, 'physicalCores') && !intIn(cpu.physicalCores, 1, 256)) errors.push('Núcleos físicos fuera de rango (1–256).');
    if (Object.hasOwn(cpu, 'logicalThreads') && !intIn(cpu.logicalThreads, 1, 1024)) errors.push('Hilos lógicos fuera de rango (1–1024).');
  }
  if (data.ramBytes !== null && !intIn(data.ramBytes, 1, Number.MAX_SAFE_INTEGER)) errors.push('RAM no válida.');

  if (!Array.isArray(data.volumes) || data.volumes.length > 32) {
    errors.push('Lista de volúmenes no válida (máximo 32).');
  } else {
    data.volumes.forEach((volume, index) => {
      const valid =
        isObject(volume) &&
        Object.keys(volume).sort().join() === VOLUME_KEYS.join() &&
        VOLUME_LABEL.test(volume.label) &&
        intIn(volume.sizeBytes, 0, Number.MAX_SAFE_INTEGER) &&
        intIn(volume.freeBytes, 0, volume.sizeBytes);
      if (!valid) errors.push(`Volumen ${index + 1} no válido.`);
    });
  }
  if (Object.hasOwn(data, 'gpuNames') && (!Array.isArray(data.gpuNames) || data.gpuNames.length > 8 || !data.gpuNames.every(textOk))) {
    errors.push('Nombres de GPU no válidos.');
  }
  if (errors.length) return { ok: false, errors };

  const warnings = [];
  if (now - capturedMs > OLD_AFTER_MS) warnings.push('El diagnóstico tiene más de 30 días: puede no reflejar el equipo actual.');
  if (data.os !== 'windows') warnings.push('El recopilador de NoMoreSaaS es solo para Windows; este archivo no se generó con él o no está certificado.');
  return {
    ok: true,
    warnings,
    diagnostic: {
      schemaVersion: 1,
      capturedAt: data.capturedAt,
      os: data.os,
      architecture: data.architecture,
      cpu: { ...cpu },
      ramBytes: data.ramBytes,
      volumes: data.volumes.map((v) => ({ label: v.label, freeBytes: v.freeBytes, sizeBytes: v.sizeBytes })),
      gpuNames: data.gpuNames ? [...data.gpuNames] : [],
    },
  };
}

/** `value` debe ser el valor EXACTO (sin redondear): el rango nunca se comprueba tras recortar. */
function rangeError(key, value, unit) {
  const { min, max } = PROFILE_LIMITS[key];
  if (value > max) return `Fuera del rango admitido (${min}–${max} ${unit}): supera el máximo. Escríbelo a mano.`;
  if (value < min) return `Fuera del rango admitido (${min}–${max} ${unit}): está por debajo del mínimo. Escríbelo a mano.`;
  return null;
}

/** Bytes → fila en GiB: rango con el valor exacto; solo se redondea (hacia abajo) lo que se muestra y aplica. */
function bytesRow(key, bytes) {
  const error = rangeError(key, bytes / GIB, 'GiB');
  const gib = bytesToGiB(bytes);
  return error ? { error, gib } : { value: gib, gib };
}

/**
 * Campos de perfil que se pueden aplicar desde el diagnóstico. Cada fila:
 * {key, label, value?, display, unit, note?, error?}. Solo las filas con
 * `value` se aplican; lo desconocido o fuera de rango no rellena nada.
 */
export function importRows(diagnostic, volumeIndex) {
  const rows = [];
  const { physicalCores, logicalThreads } = diagnostic.cpu;
  if (physicalCores !== undefined) {
    const error = rangeError('cpuCores', physicalCores, 'núcleos');
    rows.push({ key: 'cpuCores', label: 'Núcleos de CPU (físicos)', display: String(physicalCores), unit: 'núcleos', ...(error ? { error } : { value: physicalCores }) });
  } else {
    rows.push({ key: 'cpuCores', label: 'Núcleos de CPU (físicos)', display: 'No informado', unit: '', note: logicalThreads ? `Solo hay ${logicalThreads} hilos lógicos: no equivalen a núcleos físicos.` : undefined });
  }
  if (diagnostic.ramBytes !== null) {
    const { gib, ...result } = bytesRow('ramGiB', diagnostic.ramBytes);
    rows.push({ key: 'ramGiB', label: 'RAM total', display: formatNumber(gib), unit: 'GiB', note: `${formatNumber(diagnostic.ramBytes)} bytes`, ...result });
  } else {
    rows.push({ key: 'ramGiB', label: 'RAM total', display: 'No informada', unit: '' });
  }
  const volume = Number.isInteger(volumeIndex) ? diagnostic.volumes[volumeIndex] : undefined;
  if (volume) {
    const { gib, ...result } = bytesRow('storageGiB', volume.freeBytes);
    rows.push({ key: 'storageGiB', label: `Espacio libre (${volume.label})`, display: formatNumber(gib), unit: 'GiB', note: `de ${formatNumber(bytesToGiB(volume.sizeBytes))} GiB`, ...result });
  } else {
    rows.push({ key: 'storageGiB', label: 'Espacio libre', display: diagnostic.volumes.length ? 'Elige un volumen' : 'Sin volúmenes', unit: '' });
  }
  rows.push(diagnostic.os === 'unknown'
    ? { key: 'os', label: 'Sistema operativo', display: 'Desconocido', unit: '' }
    : { key: 'os', label: 'Sistema operativo', display: diagnostic.os, unit: '', value: diagnostic.os });
  rows.push(diagnostic.architecture === 'unknown'
    ? { key: 'architecture', label: 'Arquitectura', display: 'Desconocida', unit: '' }
    : { key: 'architecture', label: 'Arquitectura', display: diagnostic.architecture, unit: '', value: diagnostic.architecture });
  return rows;
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
