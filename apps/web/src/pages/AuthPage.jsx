import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { AuthForm } from '../components/AuthForm.jsx';
import { GoogleSignIn, GoogleStatusNote } from '../components/GoogleSignIn.jsx';
import { REDIRECT_PARAM, authPathFor, safeRedirectTarget } from '../components/RequireAuth.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { AUTH_STATUS, useAuth } from '../store/auth.js';

const COPY = {
  login: {
    title: 'Entrar',
    lead: 'Entra con el correo y la contraseña de tu cuenta de NoMoreSaaS.',
    alternate: '¿Aún no tienes cuenta?',
    alternateLink: 'Crear cuenta',
    alternatePath: '/registro',
  },
  register: {
    title: 'Crear cuenta',
    lead: 'Guarda tus proyectos con un correo y una contraseña. El catálogo es público y no necesita cuenta.',
    alternate: '¿Ya tienes cuenta?',
    alternateLink: 'Entrar',
    alternatePath: '/entrar',
  },
};

// Motivos fijos con los que el callback de Google vuelve a /entrar. Cualquier
// otro valor (incluidas claves heredadas como toString) se ignora.
export const LOGIN_REASONS = Object.freeze({
  google_cancelled: {
    tone: 'info',
    text: 'Cancelaste el acceso con Google. No se ha iniciado sesión; puedes volver a intentarlo o entrar con tu correo.',
  },
  google_failed: {
    tone: 'error',
    text: 'No se pudo completar el acceso con Google. No se ha iniciado sesión; vuelve a intentarlo o entra con tu correo.',
  },
  google_conflict: {
    tone: 'error',
    text: 'Ya existe una cuenta de NoMoreSaaS con el correo de esa cuenta de Google. Entra con tu correo y contraseña y vincula Google desde «Mi cuenta».',
  },
});

/** Lee ?reason= una vez y lo quita de la URL, conservando el resto (p. ej. ?siguiente). */
function useLoginReason() {
  const [params, setParams] = useSearchParams();
  const [reason] = useState(() => {
    const key = params.get('reason');
    return key !== null && Object.hasOwn(LOGIN_REASONS, key) ? LOGIN_REASONS[key] : null;
  });
  useEffect(() => {
    if (!params.has('reason')) return;
    const next = new URLSearchParams(params);
    next.delete('reason');
    setParams(next, { replace: true });
  }, [params, setParams]);
  return reason;
}

function LoginReasonNotice({ reason }) {
  if (!reason) return null;
  if (reason.tone === 'error') {
    return (
      <div className="form-alert auth-page__notice" role="alert">
        <p>{reason.text}</p>
      </div>
    );
  }
  return (
    <p className="page-notice page-notice--info" role="status">
      {reason.text}
    </p>
  );
}

/** Página compartida de /entrar y /registro; redirige a un destino interno validado. */
export function AuthPage({ mode }) {
  const copy = COPY[mode];
  useDocumentTitle(copy.title);
  const status = useAuth((state) => state.status);
  const sessionExpired = useAuth((state) => state.sessionExpired);
  const [params] = useSearchParams();
  const target = safeRedirectTarget(params.get(REDIRECT_PARAM));
  const reason = useLoginReason();

  if (status === AUTH_STATUS.authenticated) return <Navigate to={target} replace />;

  return (
    <div className="page page--narrow auth-page">
      <header className="page-header">
        <h1>{copy.title}</h1>
        <p className="hero__lead">{copy.lead}</p>
      </header>
      <LoginReasonNotice reason={reason} />
      {sessionExpired && (
        <p className="page-notice" role="status">
          Tu sesión ha caducado. Vuelve a entrar para continuar; los datos de un formulario sin guardar se recuperarán si entras con
          la misma cuenta.
        </p>
      )}
      <div className="auth-panel">
        <GoogleSignIn />
        <AuthForm key={mode} mode={mode} />
      </div>
      <p className="auth-page__alternate">
        {copy.alternate} <Link to={authPathFor(copy.alternatePath, target)}>{copy.alternateLink}</Link>
      </p>
      <GoogleStatusNote />
    </div>
  );
}
