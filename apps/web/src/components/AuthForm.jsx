import { useEffect, useId, useRef, useState } from 'react';
import { AuthRequestError } from '../api/auth.js';
import { useAuth } from '../store/auth.js';

// Límites de data-model.md. Las longitudes se cuentan en puntos Unicode
// ([...texto].length), no en unidades UTF-16: por eso no se usa maxLength.
export const EMAIL_MIN = 3;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const EMAIL_PATTERN = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u;

export const codePointLength = (value) => [...value].length;

/** Correo trim/lowercase como en la API; null si no es válido. */
export function normalizeEmail(value) {
  const email = value.trim().toLowerCase();
  const length = codePointLength(email);
  if (length < EMAIL_MIN || length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function validate(mode, { email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Introduce tu correo.';
  else if (!normalizeEmail(email)) errors.email = 'Introduce un correo válido, por ejemplo nombre@dominio.es.';

  // La contraseña nunca se recorta ni se modifica.
  const length = codePointLength(password);
  if (length === 0) errors.password = 'Introduce tu contraseña.';
  else if (mode === 'register' && length < PASSWORD_MIN) {
    errors.password = `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres (ahora tiene ${length}).`;
  } else if (length > PASSWORD_MAX) {
    errors.password = `La contraseña no puede superar ${PASSWORD_MAX} caracteres (ahora tiene ${length}).`;
  }
  return errors;
}

const COPY = {
  login: {
    submit: 'Entrar',
    submitting: 'Entrando…',
    emailAutocomplete: 'username',
    passwordAutocomplete: 'current-password',
  },
  register: {
    submit: 'Crear cuenta',
    submitting: 'Creando cuenta…',
    emailAutocomplete: 'email',
    passwordAutocomplete: 'new-password',
  },
};

/** Formulario de acceso compartido por /entrar y /registro. */
export function AuthForm({ mode }) {
  const copy = COPY[mode];
  const action = useAuth((state) => (mode === 'register' ? state.register : state.login));
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const alertRef = useRef(null);
  const id = useId();
  const ids = {
    email: `${id}-email`,
    emailError: `${id}-email-error`,
    password: `${id}-password`,
    passwordHint: `${id}-password-hint`,
    passwordError: `${id}-password-error`,
  };

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setValues((current) => ({ ...current, [field]: value }));
      if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  function focusFirstInvalid(errors) {
    if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    const errors = validate(mode, values);
    setFormError(null);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      focusFirstInvalid(errors);
      return;
    }

    busy.current = true;
    setSubmitting(true);
    try {
      await action({ email: values.email.trim(), password: values.password });
      // Con éxito, la página redirige al cambiar el estado de sesión.
    } catch (error) {
      const known = error instanceof AuthRequestError;
      if (known && error.code === 'EMAIL_UNAVAILABLE') {
        const next = { email: error.message };
        setFieldErrors(next);
        focusFirstInvalid(next);
      } else {
        const text = known ? error.message : 'Se produjo un error inesperado. Inténtalo de nuevo.';
        setFormError((current) => ({ text, id: (current?.id ?? 0) + 1 }));
      }
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  // Cada error nuevo del servidor lleva el foco al aviso; los campos se conservan.
  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  const describedBy = (...refs) => refs.filter(Boolean).join(' ') || undefined;

  return (
    <form className="auth-form" noValidate onSubmit={handleSubmit}>
      {formError && (
        <div ref={alertRef} className="form-alert" role="alert" tabIndex={-1}>
          <p>{formError.text}</p>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor={ids.email}>
          Correo
        </label>
        <input
          ref={emailRef}
          id={ids.email}
          className="field__input"
          type="email"
          name="email"
          inputMode="email"
          autoComplete={copy.emailAutocomplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={values.email}
          onChange={update('email')}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={describedBy(fieldErrors.email && ids.emailError)}
        />
        {fieldErrors.email && (
          <p id={ids.emailError} className="field__error">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.password}>
          Contraseña
        </label>
        <input
          ref={passwordRef}
          id={ids.password}
          className="field__input"
          type="password"
          name="password"
          autoComplete={copy.passwordAutocomplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={values.password}
          onChange={update('password')}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={describedBy(mode === 'register' && ids.passwordHint, fieldErrors.password && ids.passwordError)}
        />
        {mode === 'register' && (
          <p id={ids.passwordHint} className="field__hint">
            Usa al menos {PASSWORD_MIN} caracteres.
          </p>
        )}
        {fieldErrors.password && (
          <p id={ids.passwordError} className="field__error">
            {fieldErrors.password}
          </p>
        )}
      </div>

      <button type="submit" className="button button--primary auth-form__submit" aria-disabled={submitting ? true : undefined}>
        {submitting ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
