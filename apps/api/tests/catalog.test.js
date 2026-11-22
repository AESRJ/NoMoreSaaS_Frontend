import { describe, expect, it } from 'vitest';
import { CatalogValidationError, DEFAULT_CATALOG_PATH, findAlternative, isValidId, loadCatalog, validateCatalog } from '../src/catalog.js';
import { validAlternative, validCatalog } from './fixtures.js';

const TODAY = '2026-11-20';
const validate = (data, options = {}) => validateCatalog(data, { today: TODAY, ...options });

function problemsOf(data, options) {
  try {
    validate(data, options);
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogValidationError);
    return error.problems;
  }
  throw new Error('se esperaba un catálogo inválido');
}

function withAlternative(overrides) {
  const data = validCatalog();
  data.alternatives[1] = validAlternative(overrides);
  return data;
}

describe('validateCatalog: estructura y orden', () => {
  it('acepta un catálogo válido, lo ordena por nombre y lo congela', () => {
    const catalog = validate(validCatalog());
    expect(catalog.services.map((s) => s.id)).toEqual(['alfa', 'beta', 'zeta']);
    expect(catalog.alternatives.map((a) => a.id)).toEqual(['alt-uno', 'beta-alt', 'cuarta', 'otra']);
    expect(catalog.relations.map((r) => r.serviceId)).toEqual(['alfa', 'alfa', 'beta', 'zeta']);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.alternatives[0].sources[0])).toBe(true);
  });

  it('no muta el objeto de entrada', () => {
    const data = validCatalog();
    validate(data);
    expect(data.services[0].id).toBe('zeta');
    expect(Object.isFrozen(data)).toBe(false);
  });

  it('acepta un catálogo vacío (estado vacío) si no se exige cobertura de seed', () => {
    const catalog = validate({ schemaVersion: 1, services: [], alternatives: [], relations: [] });
    expect(catalog.services).toEqual([]);
  });

  it('rechaza raíz, schemaVersion y listas incorrectas', () => {
    expect(problemsOf(null)).toContain('raíz: debe ser un objeto');
    expect(problemsOf({ ...validCatalog(), schemaVersion: 2 })).toContain('schemaVersion: debe ser 1');
    expect(problemsOf({ schemaVersion: 1, services: {}, alternatives: [], relations: [] })).toContain('services: debe ser una lista');
  });

  it('exige cobertura mínima del seed (5/5) sin requerir dos alternativas por servicio', () => {
    // Cinco servicios con una alternativa cada uno: válido, no se inventan relaciones.
    const data = validCatalog();
    data.services.push({ id: 'gamma', name: 'Gamma', description: 'Servicio G' }, { id: 'delta', name: 'Delta', description: 'Servicio D' });
    data.alternatives.push(validAlternative({ id: 'quinta', name: 'Quinta' }));
    data.relations[2] = { serviceId: 'gamma', alternativeId: 'cuarta', coverage: 'x' };
    data.relations.push({ serviceId: 'delta', alternativeId: 'quinta', coverage: 'x' });
    expect(() => validate(data, { requireSeedCoverage: true })).not.toThrow();
    const small = validCatalog();
    small.services = small.services.slice(1);
    small.relations = small.relations.filter((r) => r.serviceId !== 'zeta');
    small.alternatives = small.alternatives.filter((a) => a.id !== 'otra');
    const smallProblems = problemsOf(small, { requireSeedCoverage: true });
    expect(smallProblems).toContain('seed: se requieren al menos 5 servicios');
    expect(smallProblems).toContain('seed: se requieren al menos 5 alternativas');
  });
});

describe('validateCatalog: Service', () => {
  it.each([
    ['id con mayúsculas', { id: 'Alfa' }, 'services[1].id'],
    ['id con guion final', { id: 'alfa-' }, 'services[1].id'],
    ['id demasiado largo', { id: 'a'.repeat(81) }, 'services[1].id'],
    ['nombre vacío', { name: '   ' }, 'services[1].name'],
    ['nombre largo', { name: 'x'.repeat(121) }, 'services[1].name'],
    ['descripción no textual', { description: 5 }, 'services[1].description'],
    ['descripción larga', { description: 'x'.repeat(1001) }, 'services[1].description'],
  ])('rechaza %s', (_label, overrides, path) => {
    const data = validCatalog();
    data.services[1] = { ...data.services[1], ...overrides };
    expect(problemsOf(data).some((p) => p.startsWith(path))).toBe(true);
  });

  it('rechaza IDs de servicio duplicados', () => {
    const data = validCatalog();
    data.services.push({ id: 'alfa', name: 'Copia', description: 'x' });
    expect(problemsOf(data)).toContain('services[3].id: duplicado "alfa"');
  });
});

describe('validateCatalog: Alternative', () => {
  it.each([
    ['id inválido', { id: 'no válido' }, 'alternatives[1].id'],
    ['nombre largo', { name: 'x'.repeat(121) }, 'alternatives[1].name'],
    ['descripción vacía', { description: '' }, 'alternatives[1].description'],
    ['sin capacidades', { capabilities: [] }, 'alternatives[1].capabilities'],
    ['más de 20 capacidades', { capabilities: Array(21).fill('c') }, 'alternatives[1].capabilities'],
    ['capacidad de más de 500', { capabilities: ['x'.repeat(501)] }, 'alternatives[1].capabilities[0]'],
    ['capacidad vacía', { capabilities: ['  '] }, 'alternatives[1].capabilities[0]'],
    ['limitaciones no lista', { limitations: 'x' }, 'alternatives[1].limitations'],
    ['más de 20 limitaciones', { limitations: Array(21).fill('l') }, 'alternatives[1].limitations'],
    ['licencia ausente', { license: undefined }, 'alternatives[1].license'],
    ['etiqueta de licencia vacía', { license: { label: '', url: 'https://e.org', classification: 'open-source' } }, 'alternatives[1].license.label'],
    ['URL de licencia javascript', { license: { label: 'MIT', url: 'javascript:alert(1)', classification: 'open-source' } }, 'alternatives[1].license.url'],
    ['clasificación desconocida', { license: { label: 'X', url: 'https://e.org', classification: 'libre' } }, 'alternatives[1].license.classification'],
    ['licencia sin clasificar', { license: { label: 'X', url: 'https://e.org', classification: 'unknown' } }, 'alternatives[1].license.classification'],
    ['dificultad con nivel desconocido', { difficulty: { level: 'easy', explanation: 'x' } }, 'alternatives[1].difficulty.level'],
    ['dificultad sin explicación', { difficulty: { level: 'basic', explanation: '' } }, 'alternatives[1].difficulty.explanation'],
    ['hostingNotes vacío', { hostingNotes: '' }, 'alternatives[1].hostingNotes'],
    ['hostingNotes largo', { hostingNotes: 'x'.repeat(2001) }, 'alternatives[1].hostingNotes'],
    ['officialUrl data:', { officialUrl: 'data:text/html,hola' }, 'alternatives[1].officialUrl'],
    ['officialUrl file:', { officialUrl: 'file:///etc/passwd' }, 'alternatives[1].officialUrl'],
    ['officialUrl relativa', { officialUrl: '/relativa' }, 'alternatives[1].officialUrl'],
    ['documentationUrl inválida', { documentationUrl: 'ftp://e.org' }, 'alternatives[1].documentationUrl'],
    ['sin fuentes', { sources: [] }, 'alternatives[1].sources'],
  ])('rechaza %s', (_label, overrides, path) => {
    expect(problemsOf(withAlternative(overrides)).some((p) => p.startsWith(path))).toBe(true);
  });

  it('acepta licencias source-available declaradas como tales', () => {
    const bsl = { license: { label: 'BSL 1.1', url: 'https://e.org', classification: 'source-available' } };
    expect(() => validate(withAlternative(bsl))).not.toThrow();
  });

  it('acepta el nivel unknown de dificultad', () => {
    expect(() => validate(withAlternative({ difficulty: { level: 'unknown', explanation: 'No evaluado.' } }))).not.toThrow();
  });

  it('acepta limitaciones vacías solo si una fuente declara la revisión', () => {
    const base = validAlternative();
    const withoutNote = { ...base, limitations: [] };
    expect(problemsOf(withAlternative(withoutNote))).toContain(
      'alternatives[1].limitations: lista vacía sin una fuente con nota que declare la revisión',
    );
    const declared = {
      ...base,
      limitations: [],
      sources: [...base.sources, { url: 'https://e.org', checkedAt: '2026-11-01', supports: ['limitations'], kind: 'official', note: 'No se documentan limitaciones.' }],
    };
    expect(() => validate(withAlternative(declared))).not.toThrow();
  });

  it('exige que la dificultad tenga una fuente editorial', () => {
    const base = validAlternative();
    const official = { ...base, sources: [base.sources[0]] };
    expect(problemsOf(withAlternative(official))).toContain('alternatives[1].difficulty: requiere una fuente editorial con motivo');
  });

  it('rechaza IDs de alternativa duplicados', () => {
    const data = validCatalog();
    data.alternatives.push(validAlternative({ id: 'otra' }));
    expect(problemsOf(data)).toContain('alternatives[4].id: duplicado "otra"');
  });
});

describe('validateCatalog: Source', () => {
  const sourceAt = (source) => {
    const base = validAlternative();
    return withAlternative({ sources: [{ ...base.sources[0], ...source }, base.sources[1]] });
  };

  it.each([
    ['URL no HTTP', { url: 'mailto:a@b.c' }, 'alternatives[1].sources[0].url'],
    ['fecha con formato incorrecto', { checkedAt: '20-11-2026' }, 'alternatives[1].sources[0].checkedAt'],
    ['fecha imposible', { checkedAt: '2026-02-30' }, 'alternatives[1].sources[0].checkedAt'],
    ['fecha futura', { checkedAt: '2026-11-21' }, 'alternatives[1].sources[0].checkedAt'],
    ['supports vacío', { supports: [] }, 'alternatives[1].sources[0].supports'],
    ['supports con campo desconocido', { supports: ['precio'] }, 'alternatives[1].sources[0].supports[0]'],
    ['kind desconocido', { kind: 'blog' }, 'alternatives[1].sources[0].kind'],
    ['nota larga', { note: 'x'.repeat(1001) }, 'alternatives[1].sources[0].note'],
  ])('rechaza %s', (_label, source, path) => {
    expect(problemsOf(sourceAt(source)).some((p) => p.startsWith(path))).toBe(true);
  });

  it('exige nota en fuentes editoriales', () => {
    const base = validAlternative();
    const data = withAlternative({ sources: [base.sources[0], { ...base.sources[1], note: ' ' }] });
    expect(problemsOf(data).some((p) => p.startsWith('alternatives[1].sources[1].note'))).toBe(true);
  });
});

describe('validateCatalog: Relation y reglas de conjunto', () => {
  it('rechaza referencias inexistentes, cobertura vacía y parejas duplicadas', () => {
    const data = validCatalog();
    data.relations.push({ serviceId: 'nada', alternativeId: 'otra', coverage: 'x' });
    data.relations.push({ serviceId: 'alfa', alternativeId: 'fantasma', coverage: 'x' });
    data.relations.push({ serviceId: 'zeta', alternativeId: 'otra', coverage: '' });
    const problems = problemsOf(data);
    expect(problems).toContain('relations[4].serviceId: referencia inexistente');
    expect(problems).toContain('relations[5].alternativeId: referencia inexistente');
    expect(problems.some((p) => p.startsWith('relations[6].coverage'))).toBe(true);
    expect(problems).toContain('relations[6]: pareja serviceId/alternativeId duplicada');
  });

  it('exige relación para todo servicio y alternativa publicados', () => {
    const data = validCatalog();
    data.services.push({ id: 'huerfano', name: 'Huérfano', description: 'x' });
    data.alternatives.push(validAlternative({ id: 'sola', name: 'Sola' }));
    const problems = problemsOf(data);
    expect(problems).toContain('servicio "huerfano": no tiene relaciones');
    expect(problems).toContain('alternativa "sola": no tiene relaciones');
  });
});

describe('utilidades', () => {
  it('isValidId aplica patrón y longitud', () => {
    expect(isValidId('nextcloud')).toBe(true);
    expect(isValidId('a'.repeat(80))).toBe(true);
    expect(isValidId('a'.repeat(81))).toBe(false);
    expect(isValidId('../etc')).toBe(false);
    expect(isValidId('')).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });

  it('findAlternative devuelve ficha y relaciones o null', () => {
    const catalog = validate(validCatalog());
    expect(findAlternative(catalog, 'cuarta').relations).toHaveLength(1);
    expect(findAlternative(catalog, 'inexistente')).toBeNull();
  });
});

describe('seed publicado', () => {
  it('apps/api/data/catalog.json es válido y publica las cinco alternativas vigentes', async () => {
    const catalog = await loadCatalog(DEFAULT_CATALOG_PATH, { requireSeedCoverage: true });
    expect(catalog.alternatives.map((a) => a.id).sort()).toEqual(['immich', 'matrix-synapse', 'nextcloud', 'outline', 'wireguard']);
    expect(catalog.services.map((s) => s.id).sort()).toEqual(['google-drive', 'google-photos', 'notion', 'slack', 'tailscale']);
    const pairs = catalog.relations.map((r) => `${r.serviceId}>${r.alternativeId}`).sort();
    expect(pairs).toEqual([
      'google-drive>nextcloud',
      'google-photos>immich',
      'notion>outline',
      'slack>matrix-synapse',
      'tailscale>wireguard',
    ]);
    const byId = Object.fromEntries(catalog.alternatives.map((a) => [a.id, a]));
    expect(byId.outline.license.classification).toBe('source-available');
    for (const id of ['nextcloud', 'immich', 'matrix-synapse', 'wireguard']) {
      expect(byId[id].license.classification).toBe('open-source');
    }
    for (const alt of catalog.alternatives) expect(alt.sources.length).toBeGreaterThan(0);
  });

  it('el seed vigente ya no ofrece GitHub, Gitea ni Forgejo', async () => {
    const catalog = await loadCatalog(DEFAULT_CATALOG_PATH, { requireSeedCoverage: true });
    const ids = [...catalog.services, ...catalog.alternatives].map((item) => item.id);
    for (const retired of ['github', 'gitea', 'forgejo']) {
      expect(ids).not.toContain(retired);
      expect(findAlternative(catalog, retired)).toBeNull();
    }
  });

  it('loadCatalog rechaza JSON mal formado', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'catalogo-'));
    const file = join(dir, 'roto.json');
    await writeFile(file, '{ no es json');
    await expect(loadCatalog(file)).rejects.toBeInstanceOf(CatalogValidationError);
  });
});
