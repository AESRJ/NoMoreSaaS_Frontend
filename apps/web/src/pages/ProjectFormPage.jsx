import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { AuthRequestError } from '../api/auth.js';
import { useProjectsClient } from '../api/projects.js';
import { ProjectNotFound, ProjectsError, ProjectsLoading, isMissing } from '../components/ProjectParts.jsx';
import { CatalogGate } from '../components/StatusViews.jsx';
import { useCatalog } from '../hooks/useCatalog.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useOwnedRequest } from '../hooks/useOwnedRequest.js';
import { isStaleWrite, useAuth } from '../store/auth.js';
import { clearProjectDraft, saveProjectDraft, takeProjectDraft } from '../store/projectDraft.js';

// Límites de data-model.md, en puntos Unicode ([...texto].length): sin maxLength HTML.
export const NAME_MIN = 3;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 1000;
export const SELECTION_MIN = 1;
export const SELECTION_MAX = 10;

const codePoints = (value) => [...value].length;
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

function validate(values, { availableIds, original }) {
  const errors = {};
  const name = codePoints(values.name.trim());
  if (name < NAME_MIN || name > NAME_MAX) {
    errors.name = `El nombre debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres (ahora tiene ${name}).`;
  }
  const description = codePoints(values.description.trim());
  if (description > DESCRIPTION_MAX) {
    errors.description = `La descripción no puede superar ${DESCRIPTION_MAX} caracteres (ahora tiene ${description}).`;
  }
  const ids = values.alternativeIds;
  const unchanged = original && sameList(ids, original);
  if (ids.length < SELECTION_MIN || ids.length > SELECTION_MAX) {
    errors.alternatives = `Selecciona entre ${SELECTION_MIN} y ${SELECTION_MAX} alternativas.`;
  } else if (!unchanged && ids.some((id) => !availableIds.has(id))) {
    // Una selección sin cambios conserva las retiradas; una nueva debe ser completa y real.
    errors.alternatives = 'Quita las alternativas no disponibles para guardar la nueva selección.';
  }
  return errors;
}

/** Selección ordenada: lista de elegidas (con retiradas) y casillas del catálogo. */
function AlternativePicker({ index, ids, onChange, retiredIds, error, errorId }) {
  const alternatives = useMemo(
    () => [...index.data.alternatives].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [index],
  );
  const full = ids.length >= SELECTION_MAX;
  const nameOf = (id) => index.alternative(id)?.name;

  function toggle(id, checked) {
    onChange(checked ? [...ids, id] : ids.filter((current) => current !== id));
  }

  return (
    <fieldset className="field picker" aria-describedby={error ? errorId : undefined}>
      <legend className="field__label">
        Alternativas ({ids.length} de {SELECTION_MAX})
      </legend>
      <p className="field__hint">Elige entre {SELECTION_MIN} y {SELECTION_MAX}; se guardan en el orden en que las añades.</p>
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
      {ids.length > 0 && (
        <ol className="picker__selected" aria-label="Alternativas seleccionadas">
          {ids.map((id) => {
            const retired = retiredIds.has(id);
            const label = retired ? `No disponible (${id})` : nameOf(id) ?? id;
            return (
              <li key={id} className="picker__item">
                {retired ? (
                  <span className="retired">
                    <span className="tag tag--retired">No disponible</span> <code className="retired__id">{id}</code>
                  </span>
                ) : (
                  <span>{label}</span>
                )}
                <button
                  type="button"
                  className="button button--ghost button--small"
                  aria-label={`Quitar ${label}`}
                  onClick={() => toggle(id, false)}
                >
                  Quitar
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <ul className="picker__options">
        {alternatives.map((alternative) => {
          const checked = ids.includes(alternative.id);
          return (
            <li key={alternative.id}>
              <label className="picker__option">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={(event) => toggle(alternative.id, event.target.checked)}
                />
                <span>{alternative.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {full && <p className="field__hint">Has llegado al máximo de {SELECTION_MAX}. Quita alguna para elegir otra.</p>}
    </fieldset>
  );
}

function ProjectForm({ project }) {
  const isEdit = Boolean(project);
  const client = useProjectsClient();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const userId = useAuth((state) => state.user?.id);
  const withCsrf = useAuth((state) => state.withCsrf);
  const expireSession = useAuth((state) => state.expireSession);
  const original = project ? project.alternativeIds : null;

  // Si la sesión caducó en un envío anterior de esta misma cuenta, se recuperan sus valores.
  const [restored] = useState(() => takeProjectDraft(userId, pathname));
  const [values, setValues] = useState(
    () =>
      restored ?? {
        name: project?.name ?? '',
        description: project?.description ?? '',
        alternativeIds: project ? [...project.alternativeIds] : [],
      },
  );
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const alertRef = useRef(null);
  const nameRef = useRef(null);
  const descriptionRef = useRef(null);
  const pickerRef = useRef(null);
  const id = useId();
  const ids = {
    name: `${id}-name`,
    nameHint: `${id}-name-hint`,
    nameError: `${id}-name-error`,
    description: `${id}-description`,
    descriptionHint: `${id}-description-hint`,
    descriptionError: `${id}-description-error`,
    alternativesError: `${id}-alternatives-error`,
  };

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  const availableIds = useMemo(
    () => new Set(catalog.index ? catalog.index.data.alternatives.map((alternative) => alternative.id) : []),
    [catalog.index],
  );
  const retiredIds = useMemo(
    () => new Set(catalog.index ? values.alternativeIds.filter((alt) => !availableIds.has(alt)) : []),
    [catalog.index, values.alternativeIds, availableIds],
  );

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    if (fieldErrors[field === 'alternativeIds' ? 'alternatives' : field]) {
      setFieldErrors((current) => ({ ...current, [field === 'alternativeIds' ? 'alternatives' : field]: undefined }));
    }
  }

  function focusFirstInvalid(errors) {
    if (errors.name) nameRef.current?.focus();
    else if (errors.description) descriptionRef.current?.focus();
    else if (errors.alternatives) pickerRef.current?.querySelector('input:not(:disabled), button')?.focus();
  }

  function payload() {
    const body = { name: values.name.trim(), description: values.description.trim() };
    // Al editar, una selección sin cambios no se envía: el servidor conserva las retiradas.
    if (!isEdit || !sameList(values.alternativeIds, original)) body.alternativeIds = [...values.alternativeIds];
    return body;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    const errors = validate(values, { availableIds, original });
    setFormError(null);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      focusFirstInvalid(errors);
      return;
    }

    busy.current = true;
    setSaving(true);
    // Si la sesión caduca durante el envío, el guard redirige a /entrar; el borrador
    // en memoria permite recuperar los valores al volver. No hay reintento automático.
    saveProjectDraft({ userId, path: pathname, values });
    try {
      const saved = await withCsrf((csrfToken) =>
        isEdit ? client.updateProject(project.id, payload(), { csrfToken }) : client.createProject(payload(), { csrfToken }),
      );
      clearProjectDraft(userId);
      navigate(`/proyectos/${saved.id}`, { state: { notice: isEdit ? 'Cambios guardados.' : 'Proyecto creado.' } });
      return;
    } catch (error) {
      // La cuenta cambió: nada se envió con la nueva o el resultado ya no es suyo.
      // Este formulario se desmonta (key por usuario); no se navega ni se toca el borrador.
      if (isStaleWrite(error)) return;
      const known = error instanceof AuthRequestError;
      if (known && error.status === 401) {
        expireSession();
        return;
      }
      let message;
      if (known && error.status === 404) message = 'Este proyecto ya no existe o no pertenece a tu cuenta. No se ha guardado nada.';
      else if (known && error.status === 403) message = error.message;
      else if (known) message = `${error.message} Tus datos siguen en el formulario.`;
      else message = 'No se pudo guardar el proyecto. Tus datos siguen en el formulario; inténtalo de nuevo.';
      setFormError((current) => ({ text: message, id: (current?.id ?? 0) + 1 }));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const cancelTo = isEdit ? `/proyectos/${project.id}` : '/proyectos';
  const nameLength = codePoints(values.name.trim());
  const descriptionLength = codePoints(values.description.trim());
  const describedBy = (...refs) => refs.filter(Boolean).join(' ') || undefined;

  return (
    <form className="auth-form project-form" noValidate onSubmit={handleSubmit}>
      {restored && (
        <p className="page-notice" role="status">
          Hemos recuperado los datos que no llegaron a guardarse. Revísalos y pulsa Guardar.
        </p>
      )}
      {formError && (
        <div ref={alertRef} className="form-alert" role="alert" tabIndex={-1}>
          <p>{formError.text}</p>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor={ids.name}>
          Nombre
        </label>
        <input
          ref={nameRef}
          id={ids.name}
          className="field__input"
          type="text"
          name="name"
          autoComplete="off"
          required
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={describedBy(ids.nameHint, fieldErrors.name && ids.nameError)}
        />
        <p id={ids.nameHint} className="field__hint">
          Entre {NAME_MIN} y {NAME_MAX} caracteres ({nameLength} de {NAME_MAX}).
        </p>
        {fieldErrors.name && (
          <p id={ids.nameError} className="field__error">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.description}>
          Descripción <span className="field__optional">(opcional)</span>
        </label>
        <textarea
          ref={descriptionRef}
          id={ids.description}
          className="field__input field__textarea"
          name="description"
          rows={4}
          value={values.description}
          onChange={(event) => update('description', event.target.value)}
          aria-invalid={fieldErrors.description ? true : undefined}
          aria-describedby={describedBy(ids.descriptionHint, fieldErrors.description && ids.descriptionError)}
        />
        <p id={ids.descriptionHint} className="field__hint">
          Hasta {DESCRIPTION_MAX} caracteres ({descriptionLength} de {DESCRIPTION_MAX}).
        </p>
        {fieldErrors.description && (
          <p id={ids.descriptionError} className="field__error">
            {fieldErrors.description}
          </p>
        )}
      </div>

      <div ref={pickerRef}>
        <CatalogGate catalog={catalog}>
          {(index) => (
            <AlternativePicker
              index={index}
              ids={values.alternativeIds}
              onChange={(next) => update('alternativeIds', next)}
              retiredIds={retiredIds}
              error={fieldErrors.alternatives}
              errorId={ids.alternativesError}
            />
          )}
        </CatalogGate>
      </div>

      <div className="project-form__actions">
        <button
          type="submit"
          className="button button--primary"
          aria-disabled={saving ? true : undefined}
          disabled={!catalog.index}
        >
          {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear proyecto'}
        </button>
        <Link className="button button--ghost" to={cancelTo} onClick={() => clearProjectDraft(userId)}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function EditProject({ id }) {
  const client = useProjectsClient();
  const userId = useAuth((state) => state.user?.id);
  const request = useOwnedRequest((signal) => client.getProject(id, { signal }), `project:${id}`);
  useDocumentTitle(request.status === 'success' ? `Editar ${request.data.name}` : 'Editar proyecto');
  if (request.status === 'loading') return <ProjectsLoading label="Cargando el proyecto…" />;
  if (request.status === 'error') {
    if (isMissing(request.error)) return <ProjectNotFound />;
    return <ProjectsError title="No se pudo cargar el proyecto" error={request.error} onRetry={request.retry} />;
  }
  return (
    <div className="page page--narrow project-form-page">
      <nav className="breadcrumb" aria-label="Ruta">
        <Link to={`/proyectos/${id}`}>{request.data.name}</Link>
      </nav>
      <header className="page-header">
        <h1>Editar proyecto</h1>
      </header>
      <div className="auth-panel">
        <ProjectForm key={`${userId}|${request.data.id}`} project={request.data} />
      </div>
    </div>
  );
}

function NewProject() {
  useDocumentTitle('Nuevo proyecto');
  // Formulario vinculado a su cuenta: si cambia la identidad se monta uno nuevo y vacío.
  const userId = useAuth((state) => state.user?.id);
  return (
    <div className="page page--narrow project-form-page">
      <nav className="breadcrumb" aria-label="Ruta">
        <Link to="/proyectos">Mis proyectos</Link>
      </nav>
      <header className="page-header">
        <h1>Nuevo proyecto</h1>
        <p className="hero__lead">Guarda una selección de alternativas del catálogo con un nombre y una descripción.</p>
      </header>
      <div className="auth-panel">
        <ProjectForm key={userId} />
      </div>
    </div>
  );
}

/** /proyectos/nuevo y /proyectos/:id/editar. */
export function ProjectFormPage() {
  const { id } = useParams();
  return id ? <EditProject key={id} id={id} /> : <NewProject />;
}
