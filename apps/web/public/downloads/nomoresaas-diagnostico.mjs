#!/usr/bin/env node
// NoMoreSaaS — diagnóstico local de equipo (Windows 10/11, Node 22+).
//
// Qué hace:
//   - Lee, sin modificar nada, CPU, RAM, arquitectura, discos locales y nombres de GPU.
//   - Usa el módulo "os" de Node y UNA consulta CIM fija por PowerShell
//     (-NoProfile -NonInteractive, sin cambiar la política de ejecución, con tiempo límite).
//   - Escribe un único JSON en la ruta indicada con --output; si el archivo ya existe,
//     falla sin sobrescribirlo.
//
// Qué NO hace:
//   - No usa la red, no instala nada, no queda en segundo plano, no pide administrador.
//   - No guarda nombre del equipo, usuario, números de serie, MAC, IP, letras de unidad
//     ni rutas: los discos se exportan como "Volume 1", "Volume 2"...
//   - No interpola ningún texto del usuario en el comando de PowerShell.
//
// Uso:  node nomoresaas-diagnostico.mjs --output equipo.json
// Después, importa equipo.json en NoMoreSaaS y revisa los datos antes de guardar.

/* global process, Buffer */

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLLECTOR_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
export const MAX_EXPORT_BYTES = 64 * 1024;
export const QUERY_TIMEOUT_MS = 20_000;
export const MIN_NODE_MAJOR = 22;

const MAX_TEXT = 200;
const MAX_VOLUMES = 32;
const MAX_GPUS = 8;

// Consulta fija: solo se seleccionan las propiedades necesarias (nunca Name del equipo,
// DeviceID, VolumeSerialNumber, usuarios ni rutas). No depende de ninguna entrada.
export const CIM_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$p = @(Get-CimInstance -ClassName Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, Architecture)',
  '$c = Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object TotalPhysicalMemory',
  "$d = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object FreeSpace, Size)",
  '$g = @(Get-CimInstance -ClassName Win32_VideoController | Select-Object Name)',
  "[pscustomobject]@{ processors = $p; memory = $c.TotalPhysicalMemory; disks = $d; gpus = $g } | ConvertTo-Json -Compress -Depth 3",
].join('; ');

export function powershellPath(env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function powershellArgs() {
  return ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', CIM_SCRIPT];
}

export class DiagnosticError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiagnosticError';
    this.code = code;
  }
}

/** Ejecuta la consulta CIM fija. Devuelve el texto JSON producido por PowerShell. */
export function runCimQuery({ exec = execFile, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    exec(
      powershellPath(env),
      powershellArgs(),
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024, encoding: 'utf8', shell: false },
      (error, stdout) => {
        if (error) {
          const code = error.killed || error.signal ? 'query-timeout' : 'query-failed';
          reject(new DiagnosticError(code, code === 'query-timeout'
            ? 'La consulta del sistema superó el tiempo límite.'
            : 'No se pudo leer la información del sistema con PowerShell.'));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

function cleanText(value) {
  if (typeof value !== 'string') return undefined;
  // Quita caracteres de control y espacios repetidos; nunca se interpreta el texto.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT).trim() : text;
}

function safeInt(value, min, max) {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) return undefined;
  return n;
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Win32_Processor.Architecture: 9 = x64, 12 = ARM64 (documentación CIM de Microsoft).
// No se usa process.arch/os.arch: describen el binario de Node (x64 puede ir emulado en ARM64).
const CIM_ARCHITECTURES = new Map([[9, 'amd64'], [12, 'arm64']]);

/** Arquitectura solo si todos los procesadores informan el mismo valor conocido; si no, unknown. */
export function mapArchitecture(processors) {
  if (!processors.length) return 'unknown';
  const found = new Set();
  for (const processor of processors) {
    const value = processor?.Architecture;
    const name = Number.isInteger(value) ? CIM_ARCHITECTURES.get(value) : undefined;
    if (!name) return 'unknown';
    found.add(name);
  }
  return found.size === 1 ? [...found][0] : 'unknown';
}

export function mapOs(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'macos';
  return 'unknown';
}

function sumField(items, field, max) {
  let total = 0;
  for (const item of items) {
    const n = safeInt(item?.[field], 1, max);
    if (n === undefined) return undefined; // un procesador sin dato hace el total desconocido
    total += n;
  }
  return items.length && total <= max ? total : undefined;
}

/**
 * Normaliza la salida CIM (ya parseada) al esquema Diagnostic v1.
 * Cualquier dato ausente o fuera de rango queda desconocido; nunca se inventa.
 */
export function buildDiagnostic(raw, { now = new Date(), platform = process.platform, totalmem = os.totalmem } = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const processors = asArray(source.processors).filter((p) => p && typeof p === 'object');
  const cpu = {};
  const model = cleanText(processors[0]?.Name);
  if (model) cpu.model = model;
  const physicalCores = sumField(processors, 'NumberOfCores', 256);
  if (physicalCores !== undefined) cpu.physicalCores = physicalCores;
  const logicalThreads = sumField(processors, 'NumberOfLogicalProcessors', 1024);
  if (logicalThreads !== undefined) cpu.logicalThreads = logicalThreads;

  let ramBytes = safeInt(source.memory, 1, Number.MAX_SAFE_INTEGER) ?? null;
  if (ramBytes === null && typeof totalmem === 'function') {
    ramBytes = safeInt(totalmem(), 1, Number.MAX_SAFE_INTEGER) ?? null;
  }

  const volumes = [];
  for (const disk of asArray(source.disks)) {
    if (volumes.length >= MAX_VOLUMES) break;
    const sizeBytes = safeInt(disk?.Size, 1, Number.MAX_SAFE_INTEGER);
    const freeBytes = safeInt(disk?.FreeSpace, 0, Number.MAX_SAFE_INTEGER);
    if (sizeBytes === undefined || freeBytes === undefined || freeBytes > sizeBytes) continue;
    volumes.push({ label: `Volume ${volumes.length + 1}`, freeBytes, sizeBytes });
  }

  const gpuNames = [];
  for (const gpu of asArray(source.gpus)) {
    const name = cleanText(gpu?.Name);
    if (name && !gpuNames.includes(name)) gpuNames.push(name);
    if (gpuNames.length >= MAX_GPUS) break;
  }

  const diagnostic = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: now.toISOString(),
    os: mapOs(platform),
    architecture: mapArchitecture(processors),
    cpu,
    ramBytes,
    volumes,
  };
  if (gpuNames.length) diagnostic.gpuNames = gpuNames;
  return diagnostic;
}

export function serializeDiagnostic(diagnostic) {
  const text = `${JSON.stringify(diagnostic, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > MAX_EXPORT_BYTES) {
    throw new DiagnosticError('export-too-large', 'El diagnóstico supera 64 KiB y no se escribió.');
  }
  return text;
}

/** Escribe el JSON con flag "wx": nunca sobrescribe un archivo existente. */
export function writeExport(outputPath, text, { write = writeFileSync } = {}) {
  try {
    write(outputPath, text, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new DiagnosticError('output-exists', 'El archivo de salida ya existe; elige otro nombre. No se ha modificado.');
    }
    throw new DiagnosticError('write-failed', 'No se pudo escribir el archivo de salida.');
  }
}

export const USAGE = [
  'Uso: node nomoresaas-diagnostico.mjs --output equipo.json',
  '',
  'Lee CPU, RAM, arquitectura, discos locales y nombres de GPU de este equipo Windows',
  'y los guarda en un JSON nuevo para importarlo en NoMoreSaaS. Solo lectura, sin red.',
].join('\n');

export function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true };
  if (argv.length === 2 && argv[0] === '--output' && argv[1] && !argv[1].startsWith('-')) {
    return { output: argv[1] };
  }
  const match = argv.length === 1 && /^--output=(.+)$/.exec(argv[0]);
  if (match) return { output: match[1] };
  throw new DiagnosticError('usage', USAGE);
}

export function checkRuntime({ platform = process.platform, nodeVersion = process.versions.node } = {}) {
  const major = Number.parseInt(String(nodeVersion).split('.')[0], 10);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    throw new DiagnosticError('node-too-old', `Se necesita Node ${MIN_NODE_MAJOR} o superior.`);
  }
  if (platform !== 'win32') {
    throw new DiagnosticError('unsupported-os', 'Este recopilador solo es compatible con Windows 10/11. Usa la entrada manual en NoMoreSaaS.');
  }
}

/**
 * Flujo completo. Todas las dependencias externas son inyectables para probar con fixtures
 * sin consultar el equipo real.
 */
export async function main(argv, deps = {}) {
  const {
    query = runCimQuery,
    write = writeFileSync,
    log = (m) => process.stdout.write(`${m}\n`),
    logError = (m) => process.stderr.write(`${m}\n`),
    now = () => new Date(),
    platform = process.platform,
    nodeVersion = process.versions.node,
    totalmem = os.totalmem,
  } = deps;
  try {
    const args = parseArgs(argv);
    if (args.help) {
      log(USAGE);
      return 0;
    }
    checkRuntime({ platform, nodeVersion });
    const stdout = await query();
    let raw;
    try {
      raw = JSON.parse(stdout);
    } catch {
      throw new DiagnosticError('query-invalid', 'La respuesta del sistema no tenía el formato esperado.');
    }
    const diagnostic = buildDiagnostic(raw, { now: now(), platform, totalmem });
    writeExport(args.output, serializeDiagnostic(diagnostic), { write });
    log(`Diagnóstico guardado en ${args.output}. Revísalo y luego impórtalo en NoMoreSaaS.`);
    return 0;
  } catch (error) {
    logError(error instanceof DiagnosticError ? error.message : 'Error inesperado; no se escribió ningún archivo.');
    return error instanceof DiagnosticError && error.code === 'usage' ? 2 : 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
