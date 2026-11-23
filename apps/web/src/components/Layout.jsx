import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AuthRequestError } from '../api/auth.js';
import { AUTH_STATUS, useAuth } from '../store/auth.js';
import { clearProjectDraft, retainProjectDraftFor } from '../store/projectDraft.js';
import { authPathFor } from './RequireAuth.jsx';

/** Acceso para visitante; Mis proyectos, correo y Salir para la sesión autenticada. */
function AccountArea({ onSignedOut }) {
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const reloadSession = useAuth((state) => state.reloadSession);
  const { pathname, search, hash } = useLocation();
  const [logoutError, setLogoutError] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const here = `${pathname}${search}${hash}`;

  async function handleLogout() {
    if (leaving) return;
    setLeaving(true);
    setLogoutError(null);
    try {
      await logout();
      onSignedOut();
    } catch (error) {
      setLogoutError(error instanceof AuthRequestError ? error.message : 'No se pudo cerrar la sesión. Inténtalo de nuevo.');
    } finally {
      setLeaving(false);
    }
  }

  if (status === AUTH_STATUS.authenticated && user) {
    return (
      <div className="account">
        <ul className="nav-list">
          <li>
            <NavLink to="/proyectos">Mis proyectos</NavLink>
          </li>
        </ul>
        <span className="account__email" title={user.email}>
          <span className="sr-only">Sesión iniciada como </span>
          {user.email}
        </span>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={handleLogout}
          aria-disabled={leaving ? true : undefined}
        >
          {leaving ? 'Saliendo…' : 'Salir'}
        </button>
        {logoutError && (
          <p className="account__error" role="alert">
            {logoutError}
          </p>
        )}
      </div>
    );
  }

  if (status === AUTH_STATUS.anonymous) {
    // Conserva la página actual como destino tras entrar (solo rutas internas).
    const onAuthPage = pathname === '/entrar' || pathname === '/registro';
    const target = onAuthPage ? undefined : here;
    return (
      <ul className="account nav-list">
        <li>
          <NavLink to={authPathFor('/entrar', target)}>Entrar</NavLink>
        </li>
        <li>
          <NavLink className="account__cta" to={authPathFor('/registro', target)}>
            Crear cuenta
          </NavLink>
        </li>
      </ul>
    );
  }

  if (status === AUTH_STATUS.error) {
    return (
      <div className="account">
        <span className="account__status">Sesión no disponible</span>
        <button type="button" className="button button--ghost button--small" onClick={reloadSession}>
          Reintentar
        </button>
      </div>
    );
  }

  // Desconocido/cargando: hueco reservado, sin mostrar identidad aún.
  return <div className="account account--pending" aria-hidden="true" />;
}

export function Layout() {
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  // Última ruta enfocada: la carga inicial (también con el doble efecto de
  // StrictMode) no mueve el foco ni desplaza la página.
  const focusedPath = useRef(pathname);
  const navigate = useNavigate();
  const ensureSession = useAuth((state) => state.ensureSession);
  const announcement = useAuth((state) => state.announcement);

  // Una sola petición de sesión compartida por toda la SPA.
  useEffect(() => {
    ensureSession();
  }, [ensureSession]);

  // Al autenticarse una cuenta, el borrador en memoria de otra se descarta
  // aunque no se visite ningún formulario.
  const userId = useAuth((state) => state.user?.id ?? null);
  useEffect(() => {
    if (userId) retainProjectDraftFor(userId);
  }, [userId]);

  // Tras salir: vuelve al catálogo público y lleva el foco al contenido.
  function handleSignedOut() {
    clearProjectDraft();
    navigate('/');
    mainRef.current?.focus({ preventScroll: false });
  }

  // Al cambiar de ruta, lleva el foco al contenido para lectores de pantalla.
  useEffect(() => {
    if (focusedPath.current === pathname) return;
    focusedPath.current = pathname;
    mainRef.current?.focus({ preventScroll: false });
  }, [pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand" to="/">
            <span className="brand__mark" aria-hidden="true">
              N
            </span>
            NoMoreSaaS
          </Link>
          <div className="site-header__end">
            <nav aria-label="Principal">
              <ul className="nav-list">
                <li>
                  <NavLink to="/" end>
                    Catálogo
                  </NavLink>
                </li>
              </ul>
            </nav>
            <AccountArea onSignedOut={handleSignedOut} />
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement ? <span key={announcement.id}>{announcement.text}</span> : null}
        </p>
      </header>
      <main id="contenido" ref={mainRef} tabIndex={-1} className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>
          Datos curados a partir de documentación oficial, con fecha de revisión por fuente. Las valoraciones de dificultad son evaluaciones
          editoriales. NoMoreSaaS no instala ni despliega servicios.
        </p>
      </footer>
    </div>
  );
}
