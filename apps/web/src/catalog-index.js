// Índices derivados de la instantánea del catálogo y búsqueda local por nombre.

const cache = new WeakMap();

export function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : '';
}

export function indexCatalog(data) {
  const cached = cache.get(data);
  if (cached) return cached;

  const servicesById = new Map(data.services.map((s) => [s.id, s]));
  const alternativesById = new Map(data.alternatives.map((a) => [a.id, a]));
  const alternativeOrder = new Map(data.alternatives.map((a, i) => [a.id, i]));
  const serviceOrder = new Map(data.services.map((s, i) => [s.id, i]));
  const relationsByService = new Map();
  const relationsByAlternative = new Map();
  for (const relation of data.relations) {
    if (!servicesById.has(relation.serviceId) || !alternativesById.has(relation.alternativeId)) continue;
    if (!relationsByService.has(relation.serviceId)) relationsByService.set(relation.serviceId, []);
    if (!relationsByAlternative.has(relation.alternativeId)) relationsByAlternative.set(relation.alternativeId, []);
    relationsByService.get(relation.serviceId).push(relation);
    relationsByAlternative.get(relation.alternativeId).push(relation);
  }
  relationsByService.forEach((list) => list.sort((a, b) => alternativeOrder.get(a.alternativeId) - alternativeOrder.get(b.alternativeId)));
  relationsByAlternative.forEach((list) => list.sort((a, b) => serviceOrder.get(a.serviceId) - serviceOrder.get(b.serviceId)));

  const index = {
    data,
    isEmpty: data.services.length === 0 && data.alternatives.length === 0,
    service: (id) => servicesById.get(id) ?? null,
    alternative: (id) => alternativesById.get(id) ?? null,
    relationsForService: (id) => relationsByService.get(id) ?? [],
    relationsForAlternative: (id) => relationsByAlternative.get(id) ?? [],
    alternativesForService: (id) => (relationsByService.get(id) ?? []).map((r) => alternativesById.get(r.alternativeId)),
    servicesForAlternative: (id) => (relationsByAlternative.get(id) ?? []).map((r) => servicesById.get(r.serviceId)),
  };
  cache.set(data, index);
  return index;
}

/**
 * Busca por Service.name o Alternative.name (subcadena, sin distinguir
 * mayúsculas, ignorando espacios externos). Conserva el orden de la API.
 */
export function searchCatalog(index, query) {
  const needle = normalizeQuery(query);
  if (!needle) {
    return { filtered: false, services: index.data.services, alternatives: index.data.alternatives, total: index.data.services.length + index.data.alternatives.length };
  }
  const matches = (item) => normalizeQuery(item.name).includes(needle);
  const services = index.data.services.filter(matches);
  const alternatives = index.data.alternatives.filter(matches);
  return { filtered: true, services, alternatives, total: services.length + alternatives.length };
}

/**
 * Servicios a mostrar para un resultado de searchCatalog: los que coinciden por
 * nombre y los que tienen una alternativa que coincide. No cambia la
 * coincidencia; solo la agrupa por servicio, en el orden del catálogo.
 */
export function servicesForResult(index, result) {
  if (!result.filtered) return result.services;
  const ids = new Set(result.services.map((service) => service.id));
  for (const alternative of result.alternatives) {
    for (const service of index.servicesForAlternative(alternative.id)) ids.add(service.id);
  }
  return index.data.services.filter((service) => ids.has(service.id));
}
