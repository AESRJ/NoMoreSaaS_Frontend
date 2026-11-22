import { createContext, createElement, useContext } from 'react';
import { AuthRequestError, send } from './auth.js';

// Cliente de proyectos privados. Sin caché: cada vista pide sus datos para la
// identidad actual y descarta respuestas de otra identidad (ver useProjectRequest).

const INVALID = 'El servidor devolvió una respuesta inesperada. Inténtalo de nuevo.';

function toProject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    !Array.isArray(value.alternativeIds) ||
    !Array.isArray(value.alternatives) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new AuthRequestError('invalid', INVALID);
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    alternativeIds: value.alternativeIds.filter((id) => typeof id === 'string'),
    alternatives: value.alternatives
      .filter((alt) => alt && typeof alt.id === 'string')
      .map((alt) => ({ id: alt.id, name: typeof alt.name === 'string' ? alt.name : null, available: alt.available === true })),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

const projectPath = (id) => `/api/projects/${encodeURIComponent(id)}`;

export async function listProjects({ signal } = {}) {
  const data = await send('/api/projects', { signal });
  if (!data || !Array.isArray(data.projects)) throw new AuthRequestError('invalid', INVALID);
  return data.projects.map(toProject);
}

export async function getProject(id, { signal } = {}) {
  const data = await send(projectPath(id), { signal });
  return toProject(data && data.project);
}

export async function createProject(fields, { csrfToken }) {
  const data = await send('/api/projects', { method: 'POST', body: fields, csrfToken });
  return toProject(data && data.project);
}

export async function updateProject(id, fields, { csrfToken }) {
  const data = await send(projectPath(id), { method: 'PATCH', body: fields, csrfToken });
  return toProject(data && data.project);
}

export async function deleteProject(id, { csrfToken }) {
  await send(projectPath(id), { method: 'DELETE', body: {}, csrfToken });
}

export const defaultProjectsClient = Object.freeze({ listProjects, getProject, createProject, updateProject, deleteProject });

const ProjectsClientContext = createContext(defaultProjectsClient);

/** Permite inyectar un cliente simulado en pruebas. */
export function ProjectsProvider({ client = defaultProjectsClient, children }) {
  return createElement(ProjectsClientContext.Provider, { value: client }, children);
}

export function useProjectsClient() {
  return useContext(ProjectsClientContext);
}
