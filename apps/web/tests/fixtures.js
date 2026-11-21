// Fixtures de pruebas de UI. No es el seed publicado.
const today = '2026-11-20';

function alternative(id, name, extra = {}) {
  return {
    id,
    name,
    description: `Descripción de ${name}.`,
    capabilities: [`Capacidad principal de ${name}`],
    limitations: [`Limitación conocida de ${name}`],
    license: { label: 'MIT', url: `https://${id}.example.org/license`, classification: 'open-source' },
    difficulty: { level: 'intermediate', explanation: `Motivo editorial para ${name}.` },
    hostingNotes: `Requisitos documentados de ${name}.`,
    officialUrl: `https://${id}.example.org/`,
    documentationUrl: `https://${id}.example.org/docs`,
    sources: [
      {
        url: `https://${id}.example.org/docs`,
        checkedAt: today,
        supports: ['name', 'description', 'capabilities', 'limitations', 'license', 'hostingNotes', 'officialUrl', 'documentationUrl'],
        kind: 'official',
        note: 'Documentación oficial.',
      },
      {
        url: `https://${id}.example.org/docs`,
        checkedAt: '2026-11-15',
        supports: ['difficulty'],
        kind: 'editorial',
        note: 'Evaluación editorial del equipo.',
      },
    ],
    ...extra,
  };
}

export function catalogFixture() {
  return {
    schemaVersion: 1,
    services: [
      { id: 'drive', name: 'Drive Nube', description: 'Archivos en la nube.' },
      { id: 'fotos', name: 'Fotos Nube', description: 'Fotos en la nube.' },
      { id: 'forja', name: 'Forja Nube', description: 'Repositorios Git alojados.' },
    ],
    alternatives: [
      alternative('archivero', 'Archivero'),
      alternative('fotero', 'Fotero'),
      alternative('gitero', 'Gitero'),
      alternative('gitlibre', 'GitLibre'),
    ],
    relations: [
      { serviceId: 'drive', alternativeId: 'archivero', coverage: 'Sincroniza y comparte archivos.' },
      { serviceId: 'forja', alternativeId: 'gitero', coverage: 'Aloja repositorios con revisión.' },
      { serviceId: 'forja', alternativeId: 'gitlibre', coverage: 'Aloja repositorios con incidencias.' },
      { serviceId: 'fotos', alternativeId: 'fotero', coverage: 'Copia fotos desde el móvil.' },
    ],
  };
}

export function emptyCatalog() {
  return { schemaVersion: 1, services: [], alternatives: [], relations: [] };
}

export { alternative };
