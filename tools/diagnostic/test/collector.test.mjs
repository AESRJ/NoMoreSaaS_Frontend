// Pruebas del recopilador con fixtures. Ninguna prueba consulta el equipo real:
// la consulta CIM, la escritura y el entorno se inyectan.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CIM_SCRIPT,
  MAX_EXPORT_BYTES,
  QUERY_TIMEOUT_MS,
  buildDiagnostic,
  main,
  parseArgs,
  powershellArgs,
  powershellPath,
  runCimQuery,
  serializeDiagnostic,
} from '../nomoresaas-diagnostico.mjs';
import { CHECKSUM, SOURCE, TARGET, checksumLine } from '../build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');
const NOW = new Date('2026-11-22T12:00:00.000Z');
const WIN = { now: NOW, platform: 'win32', arch: 'x64', totalmem: () => 17179869184 };

// Comprobación estricta del esquema Diagnostic v1 de data-model.md (sin campos extra).
function assertSchema(d) {
  const allowed = ['schemaVersion', 'capturedAt', 'os', 'architecture', 'cpu', 'ramBytes', 'volumes', 'gpuNames'];
  for (const key of Object.keys(d)) assert.ok(allowed.includes(key), `campo extra ${key}`);
  assert.equal(d.schemaVersion, 1);
  assert.equal(new Date(d.capturedAt).toISOString(), d.capturedAt);
  assert.ok(['windows', 'linux', 'macos', 'unknown'].includes(d.os));
  assert.ok(['amd64', 'arm64', 'unknown'].includes(d.architecture));
  for (const key of Object.keys(d.cpu)) assert.ok(['model', 'physicalCores', 'logicalThreads'].includes(key));
  if ('model' in d.cpu) assert.ok(typeof d.cpu.model === 'string' && d.cpu.model.length <= 200);
  if ('physicalCores' in d.cpu) assert.ok(Number.isInteger(d.cpu.physicalCores) && d.cpu.physicalCores >= 1 && d.cpu.physicalCores <= 256);
  if ('logicalThreads' in d.cpu) assert.ok(Number.isInteger(d.cpu.logicalThreads) && d.cpu.logicalThreads >= 1 && d.cpu.logicalThreads <= 1024);
  assert.ok(d.ramBytes === null || (Number.isSafeInteger(d.ramBytes) && d.ramBytes > 0));
  assert.ok(Array.isArray(d.volumes) && d.volumes.length <= 32);
  d.volumes.forEach((v, i) => {
    assert.deepEqual(Object.keys(v).sort(), ['freeBytes', 'label', 'sizeBytes']);
    assert.equal(v.label, `Volume ${i + 1}`);
    assert.ok(Number.isSafeInteger(v.freeBytes) && Number.isSafeInteger(v.sizeBytes));
    assert.ok(v.freeBytes >= 0 && v.freeBytes <= v.sizeBytes);
  });
  if ('gpuNames' in d) {
    assert.ok(Array.isArray(d.gpuNames) && d.gpuNames.length <= 8);
    d.gpuNames.forEach((g) => assert.ok(typeof g === 'string' && g.length > 0 && g.length <= 200));
  }
}

describe('consulta CIM fija', () => {
  it('usa powershell.exe de System32 con argumentos constantes y sin bypass de política', () => {
    assert.equal(powershellPath({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(powershellArgs(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', CIM_SCRIPT]);
    assert.doesNotMatch(CIM_SCRIPT, /ExecutionPolicy|Invoke-Expression|iex|Set-|Remove-|New-|Start-Process|Invoke-WebRequest/i);
    for (const cls of ['Win32_Processor', 'Win32_ComputerSystem', 'Win32_LogicalDisk', 'Win32_VideoController']) {
      assert.match(CIM_SCRIPT, new RegExp(cls));
    }
    // La arquitectura sale de la misma consulta Win32_Processor, no de otra.
    assert.match(CIM_SCRIPT, /Win32_Processor \| Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, Architecture\)/);
    assert.equal(CIM_SCRIPT.match(/Get-CimInstance/g).length, 4);
    // Solo se seleccionan propiedades no identificativas.
    assert.doesNotMatch(CIM_SCRIPT, /DeviceID|Serial|UserName|Domain|VolumeName|PNPDeviceID|ProcessorId/);
  });

  it('pasa tiempo límite, sin shell y sin la ruta de salida en la invocación', async () => {
    const calls = [];
    const exec = (file, args, options, cb) => {
      calls.push({ file, args, options });
      cb(null, '{"processors":[]}');
    };
    const out = await runCimQuery({ exec, env: { SystemRoot: 'D:\\Win' } });
    assert.equal(out, '{"processors":[]}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(calls[0].options.timeout, QUERY_TIMEOUT_MS);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsHide, true);
    assert.deepEqual(calls[0].args, powershellArgs());
  });

  it('distingue tiempo agotado de otros fallos sin exponer detalles', async () => {
    const timeout = (f, a, o, cb) => cb(Object.assign(new Error('secret detail'), { killed: true, signal: 'SIGTERM' }));
    await assert.rejects(runCimQuery({ exec: timeout }), (e) => e.code === 'query-timeout' && !/secret/.test(e.message));
    const failed = (f, a, o, cb) => cb(Object.assign(new Error('secret detail'), { code: 1 }));
    await assert.rejects(runCimQuery({ exec: failed }), (e) => e.code === 'query-failed' && !/secret/.test(e.message));
  });
});

describe('normalización a Diagnostic v1', () => {
  it('convierte un fixture típico conservando bytes y etiquetando volúmenes por índice', () => {
    const d = buildDiagnostic(JSON.parse(fixture('cim-typical.json')), WIN);
    assertSchema(d);
    assert.deepEqual(d, {
      schemaVersion: 1,
      capturedAt: '2026-11-22T12:00:00.000Z',
      os: 'windows',
      architecture: 'amd64',
      cpu: { model: 'Ficticio CPU 8-Core Processor', physicalCores: 8, logicalThreads: 16 },
      ramBytes: 34359738368,
      volumes: [
        { label: 'Volume 1', freeBytes: 214748364800, sizeBytes: 512110190592 },
        { label: 'Volume 2', freeBytes: 1099511627776, sizeBytes: 2000398934016 },
      ],
      gpuNames: ['Ficticia GPU 4000', 'Microsoft Basic Display Adapter'],
    });
  });

  it('descarta identificadores, rangos inválidos y texto hostil sin inventar datos', () => {
    const d = buildDiagnostic(JSON.parse(fixture('cim-hostile.json')), { ...WIN, arch: 'ia32', totalmem: () => NaN });
    assertSchema(d);
    const text = JSON.stringify(d);
    for (const leaked of ['PC-DE-PERSONA', 'persona', 'ABC123', 'BFEBFBFF', '1234ABCD', 'C:', 'Documentos', 'VEN_0000']) {
      assert.ok(!text.includes(leaked), `filtra ${leaked}`);
    }
    assert.equal(d.architecture, 'unknown');
    assert.equal(d.cpu.physicalCores, undefined);
    assert.equal(d.cpu.logicalThreads, undefined);
    assert.ok(!/[\u0000-\u001f]/.test(d.cpu.model));
    assert.equal(d.ramBytes, null);
    assert.deepEqual(d.volumes, [{ label: 'Volume 1', freeBytes: 0, sizeBytes: 1073741824 }]);
    assert.equal('gpuNames' in d, false);
  });

  describe('arquitectura desde Win32_Processor.Architecture (9=x64, 12=ARM64)', () => {
    const cpu = (...archs) => ({ processors: archs.map((a) => (a === undefined ? { Name: 'X' } : { Name: 'X', Architecture: a })) });
    const archOf = (raw, nodeArch = 'x64') => buildDiagnostic(raw, { ...WIN, arch: nodeArch }).architecture;

    it('x64 → amd64 y ARM64 → arm64', () => {
      assert.equal(archOf(cpu(9)), 'amd64');
      assert.equal(archOf(cpu(12), 'arm64'), 'arm64');
    });

    it('Node x64 emulado con CIM ARM64 exporta arm64', () => {
      assert.equal(archOf(cpu(12), 'x64'), 'arm64');
    });

    it('ausente o desconocido es unknown aunque Node diga x64/arm64', () => {
      assert.equal(archOf({}, 'x64'), 'unknown');
      assert.equal(archOf(cpu(undefined), 'x64'), 'unknown');
      assert.equal(archOf(cpu(undefined), 'arm64'), 'unknown');
      for (const value of [0, 5, 6, 99, -1, null, '9', 9.5, 'ARM64']) {
        assert.equal(archOf(cpu(value)), 'unknown', `valor ${JSON.stringify(value)}`);
      }
    });

    it('varios procesadores: coherentes se aceptan; mezcla o faltante es unknown', () => {
      assert.equal(archOf(cpu(9, 9)), 'amd64');
      assert.equal(archOf(cpu(12, 12)), 'arm64');
      assert.equal(archOf(cpu(9, 12)), 'unknown');
      assert.equal(archOf(cpu(12, undefined)), 'unknown');
      assert.equal(archOf(cpu(9, 0)), 'unknown');
    });
  });

  it('suma varios procesadores y deja desconocido si falta uno', () => {
    const two = { processors: [{ Name: 'X', NumberOfCores: 4, NumberOfLogicalProcessors: 8 }, { Name: 'X', NumberOfCores: 4, NumberOfLogicalProcessors: 8 }] };
    assert.deepEqual(buildDiagnostic(two, WIN).cpu, { model: 'X', physicalCores: 8, logicalThreads: 16 });
    const partial = { processors: [{ Name: 'X', NumberOfCores: 4 }, { NumberOfCores: null }] };
    assert.deepEqual(buildDiagnostic(partial, WIN).cpu, { model: 'X' });
  });

  it('usa os.totalmem si CIM no informa RAM y nunca acepta datos no objeto', () => {
    assert.equal(buildDiagnostic({}, WIN).ramBytes, 17179869184);
    for (const raw of [null, [], 'x', 42]) {
      const d = buildDiagnostic(raw, { ...WIN, totalmem: () => 0 });
      assertSchema(d);
      assert.deepEqual(d.cpu, {});
      assert.equal(d.ramBytes, null);
      assert.deepEqual(d.volumes, []);
    }
  });

  it('limita volúmenes, GPU y longitud de texto', () => {
    const raw = {
      processors: { Name: 'Z'.repeat(500) },
      disks: Array.from({ length: 40 }, () => ({ FreeSpace: 1, Size: 2 })),
      gpus: Array.from({ length: 12 }, (_, i) => ({ Name: `GPU ${i}` })),
    };
    const d = buildDiagnostic(raw, WIN);
    assertSchema(d);
    assert.equal(d.volumes.length, 32);
    assert.equal(d.gpuNames.length, 8);
    assert.equal(d.cpu.model.length, 200);
    assert.ok(Buffer.byteLength(serializeDiagnostic(d)) <= MAX_EXPORT_BYTES);
  });

  it('rechaza exportaciones mayores de 64 KiB', () => {
    assert.throws(() => serializeDiagnostic({ padding: 'x'.repeat(MAX_EXPORT_BYTES) }), (e) => e.code === 'export-too-large');
  });
});

describe('argumentos y flujo completo', () => {
  it('acepta solo --output y --help', () => {
    assert.deepEqual(parseArgs(['--output', 'equipo.json']), { output: 'equipo.json' });
    assert.deepEqual(parseArgs(['--output=equipo.json']), { output: 'equipo.json' });
    assert.deepEqual(parseArgs(['--help']), { help: true });
    for (const bad of [[], ['equipo.json'], ['--output'], ['--output', '--force'], ['--output', 'a', '--x']]) {
      assert.throws(() => parseArgs(bad), (e) => e.code === 'usage');
    }
  });

  function harness(overrides = {}) {
    const logs = [];
    const errors = [];
    let queries = 0;
    const deps = {
      query: async () => {
        queries += 1;
        return fixture('cim-typical.json');
      },
      log: (m) => logs.push(m),
      logError: (m) => errors.push(m),
      now: () => NOW,
      platform: 'win32',
      arch: 'x64',
      nodeVersion: '22.0.0',
      totalmem: () => 1,
      ...overrides,
    };
    return { deps, logs, errors, queries: () => queries };
  }

  it('escribe un único JSON nuevo y no sobrescribe uno existente', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nms-diag-'));
    try {
      const out = path.join(dir, 'equipo.json');
      const h = harness();
      assert.equal(await main(['--output', out], h.deps), 0);
      const written = JSON.parse(readFileSync(out, 'utf8'));
      assertSchema(written);
      assert.equal(written.cpu.physicalCores, 8);

      writeFileSync(out, 'previo');
      const h2 = harness();
      assert.equal(await main(['--output', out], h2.deps), 1);
      assert.equal(readFileSync(out, 'utf8'), 'previo');
      assert.match(h2.errors.join(), /ya existe/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('se niega fuera de Windows o con Node < 22 sin consultar el sistema ni escribir', async () => {
    for (const overrides of [{ platform: 'linux' }, { platform: 'darwin' }, { nodeVersion: '20.11.1' }]) {
      let wrote = false;
      const h = harness({ ...overrides, write: () => { wrote = true; } });
      assert.equal(await main(['--output', 'x.json'], h.deps), 1);
      assert.equal(h.queries(), 0);
      assert.equal(wrote, false);
    }
  });

  it('no escribe nada si la consulta falla o devuelve algo no JSON', async () => {
    for (const query of [async () => 'not json', async () => { throw new Error('boom'); }]) {
      let wrote = false;
      const h = harness({ query, write: () => { wrote = true; } });
      assert.equal(await main(['--output', 'x.json'], h.deps), 1);
      assert.equal(wrote, false);
      assert.ok(!h.errors.join().includes('boom'));
    }
  });

  it('muestra la ayuda y devuelve 2 ante uso incorrecto sin consultar', async () => {
    const h = harness();
    assert.equal(await main(['--help'], h.deps), 0);
    assert.match(h.logs.join(), /--output/);
    const bad = harness();
    assert.equal(await main([], bad.deps), 2);
    assert.equal(bad.queries(), 0);
  });
});

describe('archivo publicado', () => {
  const source = readFileSync(SOURCE);

  it('public/downloads contiene la misma versión que la fuente y su SHA-256 válido', () => {
    assert.ok(existsSync(TARGET), 'ejecuta node tools/diagnostic/build.mjs');
    assert.ok(readFileSync(TARGET).equals(source), 'la copia publicada no coincide con la fuente');
    assert.equal(readFileSync(CHECKSUM, 'utf8'), checksumLine(source));
  });

  it('fuente, copia y checksum están en LF y Git los fija con eol=lf (autocrlf no los altera)', () => {
    const repo = path.resolve(here, '..', '..', '..');
    const files = [SOURCE, TARGET, CHECKSUM];
    for (const file of files) {
      assert.ok(!readFileSync(file).includes(0x0d), `${path.basename(file)} contiene CR`);
    }
    const rel = files.map((f) => path.relative(repo, f).split(path.sep).join('/'));
    const out = execFileSync('git', ['check-attr', 'text', 'eol', '--', ...rel], { cwd: repo, encoding: 'utf8' });
    for (const file of rel) {
      assert.ok(out.includes(`${file}: text: set`), `${file} sin text`);
      assert.ok(out.includes(`${file}: eol: lf`), `${file} sin eol=lf`);
    }
  });

  it('la fuente no usa red, eval ni escritura distinta del JSON con wx', () => {
    const text = source.toString('utf8');
    assert.doesNotMatch(text, /from ['"]node:(https?|net|dgram|dns|tls|http2)['"]|\bfetch\(|\beval\(|new Function|\bexecSync\b|\bspawn\(/);
    assert.equal(text.match(/flag: 'wx'/g)?.length, 1);
    assert.doesNotMatch(text, /appendFile|createWriteStream|\bunlink|\brm\(/);
    // La arquitectura del binario de Node no se usa como arquitectura del equipo.
    assert.doesNotMatch(text, /=\s*process\.arch|os\.arch\(\)/);
  });
});
