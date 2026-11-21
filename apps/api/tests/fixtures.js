// Fixtures de prueba: no son el seed publicado.
export function validAlternative(overrides = {}) {
  return {
    id: 'alt-uno',
    name: 'Alternativa Uno',
    description: 'Descripción de prueba.',
    capabilities: ['Capacidad A'],
    limitations: ['Limitación A'],
    license: { label: 'MIT', url: 'https://example.org/license', classification: 'open-source' },
    difficulty: { level: 'intermediate', explanation: 'Motivo editorial de prueba.' },
    hostingNotes: 'Requisitos no verificados en este fixture.',
    officialUrl: 'https://example.org/',
    documentationUrl: 'https://example.org/docs',
    sources: [
      {
        url: 'https://example.org/docs',
        checkedAt: '2026-11-01',
        supports: ['name', 'description', 'capabilities', 'limitations', 'license', 'hostingNotes', 'officialUrl', 'documentationUrl'],
        kind: 'official',
        note: '',
      },
      {
        url: 'https://example.org/docs',
        checkedAt: '2026-11-01',
        supports: ['difficulty'],
        kind: 'editorial',
        note: 'Evaluación editorial de prueba.',
      },
    ],
    ...overrides,
  };
}

export function validCatalog() {
  return {
    schemaVersion: 1,
    services: [
      { id: 'zeta', name: 'Zeta', description: 'Servicio Z' },
      { id: 'alfa', name: 'Alfa', description: 'Servicio A' },
      { id: 'beta', name: 'Beta', description: 'Servicio B' },
    ],
    alternatives: [
      validAlternative({ id: 'otra', name: 'Otra' }),
      validAlternative({ id: 'alt-uno', name: 'Alternativa Uno' }),
      validAlternative({ id: 'cuarta', name: 'Cuarta' }),
      validAlternative({ id: 'beta-alt', name: 'Beta Alt' }),
    ],
    relations: [
      { serviceId: 'zeta', alternativeId: 'otra', coverage: 'Cubre Z.' },
      { serviceId: 'alfa', alternativeId: 'alt-uno', coverage: 'Cubre A.' },
      { serviceId: 'alfa', alternativeId: 'cuarta', coverage: 'Cubre A también.' },
      { serviceId: 'beta', alternativeId: 'beta-alt', coverage: 'Cubre B.' },
    ],
  };
}
