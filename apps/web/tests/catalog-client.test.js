import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogLoadError, createCatalogResource, fetchCatalog } from '../src/api/catalog.js';
import { indexCatalog, normalizeQuery, searchCatalog } from '../src/catalog-index.js';
import { catalogFixture, emptyCatalog } from './fixtures.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCatalog', () => {
  it('pide /api/catalog y devuelve el JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogFixture()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = await fetchCatalog();
    expect(data.services).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledWith('/api/catalog', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  it('convierte HTTP no OK en error, nunca en catálogo vacío', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(fetchCatalog()).rejects.toMatchObject({ name: 'CatalogLoadError', kind: 'http', status: 500 });
  });

  it('rechaza respuestas con forma inesperada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"services":"x"}', { status: 200 })));
    await expect(fetchCatalog()).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('convierte fallos de red en error de red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchCatalog()).rejects.toBeInstanceOf(CatalogLoadError);
    await expect(fetchCatalog()).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('createCatalogResource', () => {
  it('comparte una sola petición entre consumidores', async () => {
    const fetcher = vi.fn().mockResolvedValue(catalogFixture());
    const resource = createCatalogResource({ fetcher });
    resource.load();
    resource.load();
    expect(resource.getSnapshot().status).toBe('loading');
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('success'));
    resource.load();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('distingue error y vacío, y permite reintentar', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new CatalogLoadError('network', 'sin red'))
      .mockResolvedValueOnce(emptyCatalog());
    const resource = createCatalogResource({ fetcher });
    resource.load();
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('error'));
    expect(resource.getSnapshot().data).toBeNull();
    resource.load();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resource.retry();
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('success'));
    expect(resource.getSnapshot().data.services).toEqual([]);
    expect(resource.getSnapshot().error).toBeNull();
  });

  it('cancela la petición anterior y descarta respuestas obsoletas', async () => {
    const first = deferred();
    const second = deferred();
    const signals = [];
    const fetcher = vi.fn(({ signal }) => {
      signals.push(signal);
      return fetcher.mock.calls.length === 1 ? first.promise : second.promise;
    });
    const resource = createCatalogResource({ fetcher });
    resource.load();
    resource.retry();
    expect(signals[0].aborted).toBe(true);
    second.resolve(catalogFixture());
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('success'));
    first.resolve(emptyCatalog());
    await Promise.resolve();
    await Promise.resolve();
    expect(resource.getSnapshot().data.services).toHaveLength(3);
  });

  it('ignora el error de una petición obsoleta abortada', async () => {
    const first = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(catalogFixture());
    const resource = createCatalogResource({ fetcher });
    resource.load();
    resource.retry();
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('success'));
    first.reject(new DOMException('abort', 'AbortError'));
    await Promise.resolve();
    expect(resource.getSnapshot().status).toBe('success');
  });

  it('notifica a los suscriptores', async () => {
    const resource = createCatalogResource({ fetcher: vi.fn().mockResolvedValue(catalogFixture()) });
    const listener = vi.fn();
    const unsubscribe = resource.subscribe(listener);
    resource.load();
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('success'));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe('índice y búsqueda local', () => {
  const index = indexCatalog(catalogFixture());

  it('normaliza trim y mayúsculas', () => {
    expect(normalizeQuery('  GiTeRo ')).toBe('gitero');
    expect(normalizeQuery(null)).toBe('');
  });

  it('cachea el índice por instantánea', () => {
    const data = catalogFixture();
    expect(indexCatalog(data)).toBe(indexCatalog(data));
  });

  it('busca por nombre de SaaS y muestra sus alternativas', () => {
    const result = searchCatalog(index, '  FORJA nube ');
    expect(result.services.map((s) => s.id)).toEqual(['forja']);
    expect(index.alternativesForService('forja').map((a) => a.id)).toEqual(['gitero', 'gitlibre']);
  });

  it('busca por nombre de alternativa y conserva el orden de la API', () => {
    const result = searchCatalog(index, 'git');
    expect(result.alternatives.map((a) => a.id)).toEqual(['gitero', 'gitlibre']);
    expect(result.services).toEqual([]);
  });

  it('no busca por descripción ni contenido completo', () => {
    expect(searchCatalog(index, 'repositorios')).toMatchObject({ services: [], alternatives: [], total: 0 });
  });

  it('una búsqueda vacía o de espacios equivale a sin filtro', () => {
    expect(searchCatalog(index, '   ').filtered).toBe(false);
  });
});
