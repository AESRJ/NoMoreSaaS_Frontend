import { useEffect, useRef, useState } from 'react';
import { AuthRequestError } from '../api/auth.js';
import { GOOGLE_STATUS, useAuth } from '../store/auth.js';

// «Continuar con Google» en /entrar y /registro. Solo aparece si la API
// confirma que Google está configurado; nunca se finge la activación. El
// flujo es de servidor: aquí no hay SDK de Google ni tokens en el navegador.

/** Marca «G» oficial de Google (colores de marca, decorativa). */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Botón y separador sobre el formulario local; nada si Google no está disponible. */
export function GoogleSignIn() {
  const status = useAuth((state) => state.googleLogin);
  const loadProviders = useAuth((state) => state.loadProviders);
  const startGoogleLogin = useAuth((state) => state.startGoogleLogin);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const alertRef = useRef(null);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  if (status !== GOOGLE_STATUS.enabled) return null;

  async function handleClick() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setLeaving(true);
    try {
      await startGoogleLogin();
      // Con éxito el navegador ya está saliendo hacia Google; el botón lo indica.
    } catch (err) {
      setLeaving(false);
      const text = err instanceof AuthRequestError ? err.message : 'No se pudo abrir Google. Inténtalo de nuevo.';
      setError((current) => ({ text, id: (current?.id ?? 0) + 1 }));
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="google-signin">
      {error && (
        <div ref={alertRef} className="form-alert" role="alert" tabIndex={-1}>
          <p>{error.text}</p>
        </div>
      )}
      <button type="button" className="button button--google" onClick={handleClick} aria-disabled={leaving ? true : undefined}>
        <GoogleMark />
        {leaving ? 'Abriendo Google…' : 'Continuar con Google'}
      </button>
      <p className="google-signin__divider">
        <span>o con tu correo</span>
      </p>
    </div>
  );
}

/** Aviso discreto cuando Google no está configurado o no se pudo comprobar. */
export function GoogleStatusNote() {
  const status = useAuth((state) => state.googleLogin);
  const loadProviders = useAuth((state) => state.loadProviders);
  if (status === GOOGLE_STATUS.disabled) {
    return <p className="google-note">El acceso con Google no está disponible en este servidor; entra con tu correo y contraseña.</p>;
  }
  if (status === GOOGLE_STATUS.error) {
    return (
      <p className="google-note">
        No se pudo comprobar si el acceso con Google está disponible; puedes entrar con tu correo y contraseña.{' '}
        <button type="button" className="link-button" onClick={loadProviders}>
          Volver a comprobar
        </button>
      </p>
    );
  }
  return null;
}
