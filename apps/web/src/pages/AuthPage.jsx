import { Link, Navigate, useSearchParams } from 'react-router';
import { AuthForm } from '../components/AuthForm.jsx';
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
    lead: 'Crea una cuenta con tu correo y una contraseña. El catálogo sigue siendo público y no requiere cuenta.',
    alternate: '¿Ya tienes cuenta?',
    alternateLink: 'Entrar',
    alternatePath: '/entrar',
  },
};

/** Página compartida de /entrar y /registro; redirige a un destino interno validado. */
export function AuthPage({ mode }) {
  const copy = COPY[mode];
  useDocumentTitle(copy.title);
  const status = useAuth((state) => state.status);
  const [params] = useSearchParams();
  const target = safeRedirectTarget(params.get(REDIRECT_PARAM));

  if (status === AUTH_STATUS.authenticated) return <Navigate to={target} replace />;

  return (
    <div className="page page--narrow auth-page">
      <header className="page-header">
        <h1>{copy.title}</h1>
        <p className="hero__lead">{copy.lead}</p>
      </header>
      <div className="auth-panel">
        <AuthForm key={mode} mode={mode} />
      </div>
      <p className="auth-page__alternate">
        {copy.alternate} <Link to={authPathFor(copy.alternatePath, target)}>{copy.alternateLink}</Link>
      </p>
    </div>
  );
}
