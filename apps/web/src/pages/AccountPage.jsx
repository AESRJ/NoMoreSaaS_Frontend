import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAccountClient } from '../api/account.js';
import { AuthRequestError } from '../api/auth.js';
import { PASSWORD_MAX, codePointLength } from '../components/AuthForm.jsx';
import { ProjectsError, ProjectsLoading } from '../components/ProjectParts.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useOwnedRequest } from '../hooks/useOwnedRequest.js';
import { isStaleWrite, useAuth } from '../store/auth.js';

// Motivos fijos que el callback de Google puede añadir a /cuenta. Cualquier
// otro valor se ignora: nada del proveedor se muestra.
export const ACCOUNT_REASONS = Object.freeze({
  google_linked: {
    tone: 'success',
    text: 'Tu cuenta de Google ha quedado vinculada. Ya puedes entrar con Google o con tu contraseña.',
  },
  google_cancelled: {
    tone: 'info',
    text: 'Cancelaste la vinculación en Google. No se ha cambiado nada en tu cuenta.',
  },
  google_failed: {
    tone: 'error',
    text: 'No se pudo completar la vinculación con Google. No se ha cambiado nada; vuelve a intentarlo.',
  },
  google_conflict: {
    tone: 'error',
    text: 'Esa cuenta de Google ya está vinculada a otra cuenta de NoMoreSaaS. No se ha vinculado ni cambiado nada.',
  },
});

/** Lee ?reason= una sola vez y limpia la URL sin añadir historial. */
function useReason() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  // Solo claves propias: toString, __proto__ u otras heredadas no son motivos.
  const [reason] = useState(() => {
    const key = new URLSearchParams(search).get('reason');
    return key !== null && Object.hasOwn(ACCOUNT_REASONS, key) ? ACCOUNT_REASONS[key] : null;
  });
  useEffect(() => {
    if (new URLSearchParams(search).has('reason')) navigate(pathname, { replace: true });
  }, [pathname, search, navigate]);
  return reason;
}

function ReasonNotice({ reason }) {
  if (!reason) return null;
  if (reason.tone === 'error') {
    return (
      <div className="form-alert account-page__notice" role="alert">
        <p>{reason.text}</p>
      </div>
    );
  }
  return (
    <p className={`page-notice${reason.tone === 'info' ? ' page-notice--info' : ''}`} role="status">
      {reason.text}
    </p>
  );
}

/** Mismas reglas que el login: sin recortar ni modificar la contraseña. */
function passwordLengthError(value) {
  const length = codePointLength(value);
  if (length === 0) return 'Introduce tu contraseña actual.';
  if (length > PASSWORD_MAX) return `La contraseña no puede superar ${PASSWORD_MAX} caracteres (ahora tiene ${length}).`;
  return null;
}

/** Formulario de reautenticación: la contraseña solo se envía al servidor, nunca se guarda. */
function LinkGoogleForm({ onAlreadyLinked }) {
  const client = useAccountClient();
  const withCsrf = useAuth((state) => state.withCsrf);
  const expireSession = useAuth((state) => state.expireSession);
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const passwordRef = useRef(null);
  const alertRef = useRef(null);
  const id = useId();
  const ids = { password: `${id}-password`, hint: `${id}-hint`, error: `${id}-error` };

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    setFormError(null);
    const lengthError = passwordLengthError(password);
    if (lengthError) {
      setFieldError(lengthError);
      passwordRef.current?.focus();
      return;
    }
    setFieldError(null);
    busy.current = true;
    setSubmitting(true);
    let leaving = false;
    try {
      const url = await withCsrf((csrfToken) => client.startGoogleLink({ password, csrfToken }));
      leaving = true;
      setPassword('');
      client.navigate(url);
    } catch (error) {
      if (isStaleWrite(error)) return;
      const known = error instanceof AuthRequestError;
      if (known && error.status === 401) {
        expireSession();
        return;
      }
      if (known && error.code === 'INVALID_PASSWORD') {
        setFieldError(error.message);
        passwordRef.current?.focus();
      } else if (known && error.code === 'GOOGLE_ALREADY_LINKED') {
        onAlreadyLinked();
      } else {
        const text = known ? error.message : 'Se produjo un error inesperado. Inténtalo de nuevo.';
        setFormError((current) => ({ text, id: (current?.id ?? 0) + 1 }));
      }
    } finally {
      busy.current = false;
      // Mientras se abre Google el botón sigue indicando la navegación en curso.
      if (!leaving) setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={handleSubmit}>
      {formError && (
        <div ref={alertRef} className="form-alert" role="alert" tabIndex={-1}>
          <p>{formError.text}</p>
        </div>
      )}
      <div className="field">
        <label className="field__label" htmlFor={ids.password}>
          Contraseña actual
        </label>
        <input
          ref={passwordRef}
          id={ids.password}
          className="field__input"
          type="password"
          name="password"
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (fieldError) setFieldError(null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={[ids.hint, fieldError && ids.error].filter(Boolean).join(' ')}
        />
        <p id={ids.hint} className="field__hint">
          La pedimos para confirmar que eres tú antes de vincular Google.
        </p>
        {fieldError && (
          <p id={ids.error} className="field__error">
            {fieldError}
          </p>
        )}
      </div>
      <button type="submit" className="button button--primary auth-form__submit" aria-disabled={submitting ? true : undefined}>
        {submitting ? 'Abriendo Google…' : 'Vincular con Google'}
      </button>
    </form>
  );
}

function GoogleSection({ account, onAlreadyLinked }) {
  const { google, hasPassword } = account;
  let body;
  if (google.linked) {
    body = (
      <p className="account-status">
        <span className="badge badge--official">Vinculada</span>
        Puedes entrar con tu cuenta de Google.
      </p>
    );
  } else if (!google.enabled) {
    body = (
      <p className="account-status">
        <span className="badge">No disponible</span>
        El acceso con Google no está configurado en este servidor. Sigues entrando con tu correo y contraseña.
      </p>
    );
  } else if (!hasPassword) {
    body = <p className="account-status">Esta cuenta no tiene contraseña local con la que confirmar la vinculación.</p>;
  } else {
    body = (
      <>
        <p className="account-status">
          <span className="badge">Sin vincular</span>
          Vincula tu cuenta de Google para entrar sin contraseña. Tus proyectos siguen siendo los mismos.
        </p>
        <LinkGoogleForm onAlreadyLinked={onAlreadyLinked} />
      </>
    );
  }
  return (
    <section className="auth-panel account-section" aria-labelledby="cuenta-google">
      <h2 id="cuenta-google" className="account-section__title">
        Acceso con Google
      </h2>
      {body}
    </section>
  );
}

export function AccountPage() {
  useDocumentTitle('Mi cuenta');
  const client = useAccountClient();
  const user = useAuth((state) => state.user);
  const reason = useReason();
  const account = useOwnedRequest((signal) => client.fetchAccount({ signal }), 'account');

  return (
    <div className="page page--narrow auth-page account-page">
      <header className="page-header">
        <h1>Mi cuenta</h1>
        <p className="hero__lead">
          Has entrado como <strong className="account-page__email">{user?.email}</strong>.
        </p>
      </header>
      <ReasonNotice reason={reason} />
      {account.status === 'loading' && <ProjectsLoading label="Cargando tu cuenta…" />}
      {account.status === 'error' && (
        <ProjectsError title="No se pudo cargar tu cuenta" error={account.error} onRetry={account.retry} />
      )}
      {account.status === 'success' && <GoogleSection account={account.data} onAlreadyLinked={account.retry} />}
    </div>
  );
}
