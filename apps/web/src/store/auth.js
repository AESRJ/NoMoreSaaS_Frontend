import { createContext, createElement, useContext } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { AuthRequestError, defaultAuthClient } from '../api/auth.js';

// Estado de sesión solo en memoria (sin middleware persist ni almacenamiento web).
// El token CSRF vive en el cierre del store, no en el estado observable, y nunca
// se guarda la contraseña. Estados: unknown → loading → authenticated | anonymous | error.

export const AUTH_STATUS = Object.freeze({
  unknown: 'unknown',
  loading: 'loading',
  authenticated: 'authenticated',
  anonymous: 'anonymous',
  error: 'error',
});

const CSRF_RENEWED_MESSAGE =
  'La protección de la sesión había caducado y ya se ha renovado. Revisa los datos y vuelve a enviar el formulario.';
const CSRF_NOT_RENEWED_MESSAGE =
  'La protección de la sesión caducó y no se pudo renovar. Tus datos siguen en el formulario: comprueba la conexión y vuelve a enviarlo; antes de enviar se intentará renovar.';
const WRITE_RENEWED_MESSAGE =
  'La protección de la sesión había caducado y ya se ha renovado. No se ha guardado ningún cambio: revisa y vuelve a intentarlo.';
const WRITE_NOT_RENEWED_MESSAGE =
  'La protección de la sesión caducó y no se pudo renovar. No se ha guardado ningún cambio: comprueba la conexión y vuelve a intentarlo.';

/** Escritura de una cuenta que ya no es la actual: no se envía o su resultado se descarta. */
export const staleWriteError = () =>
  new AuthRequestError('stale', 'La sesión ha cambiado de cuenta; no se ha enviado ni guardado nada de la cuenta anterior.');

export const isStaleWrite = (error) => error instanceof AuthRequestError && error.kind === 'stale';

/**
 * @param {{ client?: typeof defaultAuthClient }} [options]
 */
export function createAuthStore({ client = defaultAuthClient } = {}) {
  let csrfToken = null;
  let generation = 0; // invalida respuestas de sesión obsoletas
  let controller = null;
  let pending = null; // promesa compartida de GET /api/auth/session
  let announcementId = 0;
  const privateResetListeners = new Set();

  return createStore((set, get) => {
    function announce(text) {
      set({ announcement: { id: ++announcementId, text } });
    }

    /** Limpia cachés privadas registradas (p. ej. proyectos) al cambiar o perder identidad. */
    function resetPrivateData() {
      privateResetListeners.forEach((listener) => {
        try {
          listener();
        } catch {
          // Un consumidor defectuoso no debe impedir limpiar los demás.
        }
      });
    }

    function applySession(session) {
      const previous = get().user;
      if (!session.user || !previous || previous.id !== session.user.id) {
        if (previous) resetPrivateData();
      }
      csrfToken = session.csrfToken;
      set({
        status: session.user ? AUTH_STATUS.authenticated : AUTH_STATUS.anonymous,
        user: session.user,
        error: null,
      });
    }

    function clearIdentity() {
      csrfToken = null;
      const hadUser = get().user !== null;
      set({ status: AUTH_STATUS.anonymous, user: null, error: null });
      if (hadUser) resetPrivateData();
    }

    /** Cancela la carga en curso; su respuesta, si llega, se descarta por generación. */
    function invalidatePending() {
      generation += 1;
      if (controller) controller.abort();
      controller = null;
      pending = null;
    }

    /**
     * GET de sesión. `silent` no muestra estado de carga (renovación de token
     * tras logout); un fallo silencioso no cambia el estado visible.
     */
    function loadSession({ silent = false } = {}) {
      invalidatePending();
      const current = generation;
      const own = new AbortController();
      controller = own;
      if (!silent) set({ status: AUTH_STATUS.loading, error: null });

      let request;
      try {
        request = Promise.resolve(client.fetchSession({ signal: own.signal }));
      } catch (error) {
        request = Promise.reject(error);
      }
      // Resuelve true solo si esta carga se aplicó (no obsoleta y sin error).
      const promise = request.then(
        (session) => {
          if (current !== generation) return false;
          controller = null;
          pending = null;
          applySession(session);
          return true;
        },
        (error) => {
          if (current !== generation) return false;
          controller = null;
          pending = null;
          if (silent) return false;
          const normalized =
            error instanceof AuthRequestError ? error : new AuthRequestError('network', 'No se pudo comprobar la sesión.');
          csrfToken = null;
          // Perder la identidad, también por error de carga, limpia los datos privados.
          const hadUser = get().user !== null;
          set({ status: AUTH_STATUS.error, user: null, error: normalized });
          if (hadUser) resetPrivateData();
          return false;
        },
      );
      pending = promise;
      return promise;
    }

    /** Token CSRF actual; si falta, lo obtiene (lectura, nunca una escritura). */
    async function currentCsrfToken() {
      if (csrfToken) return csrfToken;
      if (pending) await pending;
      if (!csrfToken) await loadSession();
      if (!csrfToken) {
        throw get().error || new AuthRequestError('network', 'No se pudo preparar la sesión. Inténtalo de nuevo.');
      }
      return csrfToken;
    }

    /** Registro o login. Ante 403 renueva el token pero no reenvía la escritura. */
    async function submitCredentials(action, { email, password }, message) {
      const token = await currentCsrfToken();
      invalidatePending();
      const current = generation;
      let session;
      try {
        session = await client[action]({ email, password, csrfToken: token });
      } catch (error) {
        if (error instanceof AuthRequestError && error.status === 403 && error.code !== 'FORBIDDEN_ORIGIN') {
          // Se espera a la renovación para informar con verdad; nunca se reenvía la escritura.
          csrfToken = null;
          const renewed = await loadSession({ silent: true });
          const message = renewed && csrfToken ? CSRF_RENEWED_MESSAGE : CSRF_NOT_RENEWED_MESSAGE;
          throw new AuthRequestError('http', message, { status: 403, code: error.code });
        }
        throw error;
      }
      if (current !== generation) return null;
      applySession(session);
      set({ sessionExpired: false });
      announce(message(session.user));
      return session.user;
    }

    /**
     * Escritura privada con el CSRF actual. Nunca reintenta: ante 403 espera la
     * renovación del token y lanza un mensaje veraz; el 401 se propaga para que
     * la vista conserve sus valores antes de llamar a expireSession().
     */
    async function withCsrf(write) {
      // La escritura pertenece a la cuenta que la inicia. Si al obtener el token,
      // al responder o al renovar la sesión resulta ser otra, no se envía nada
      // (o se descarta el resultado) con un error `stale` que la vista ignora.
      const ownerId = get().user?.id ?? null;
      const assertSameOwner = () => {
        if (!ownerId || get().user?.id !== ownerId) throw staleWriteError();
      };
      assertSameOwner();
      const token = await currentCsrfToken();
      assertSameOwner();
      let result;
      try {
        result = await write(token);
      } catch (error) {
        assertSameOwner();
        if (error instanceof AuthRequestError && error.status === 403 && error.code !== 'FORBIDDEN_ORIGIN') {
          csrfToken = null;
          const renewed = await loadSession({ silent: true });
          assertSameOwner();
          const message = renewed && csrfToken ? WRITE_RENEWED_MESSAGE : WRITE_NOT_RENEWED_MESSAGE;
          throw new AuthRequestError('http', message, { status: 403, code: error.code });
        }
        throw error;
      }
      assertSameOwner();
      return result;
    }

    return {
      status: AUTH_STATUS.unknown,
      user: null,
      error: null,
      announcement: null,
      sessionExpired: false, // aviso visible en /entrar tras un 401 de datos privados

      withCsrf,

      /** Inicia la carga solo una vez; todas las llamadas comparten la misma petición. */
      ensureSession() {
        const { status } = get();
        if (status === AUTH_STATUS.unknown) return loadSession();
        if (pending) return pending;
        return Promise.resolve();
      },

      /** Reintento explícito: cancela la petición anterior. */
      reloadSession() {
        return loadSession();
      },

      register(credentials) {
        return submitCredentials('register', credentials, (user) => `Cuenta creada. Has entrado como ${user.email}.`);
      },

      login(credentials) {
        return submitCredentials('login', credentials, (user) => `Has entrado como ${user.email}.`);
      },

      /** Cierra sesión; con éxito o 401 limpia identidad y cachés privadas. */
      async logout() {
        const token = csrfToken;
        invalidatePending();
        if (token) {
          try {
            await client.logout({ csrfToken: token });
          } catch (error) {
            if (!(error instanceof AuthRequestError) || error.status !== 401) {
              if (error instanceof AuthRequestError && error.status === 403) loadSession({ silent: true });
              throw error;
            }
          }
        }
        clearIdentity();
        set({ sessionExpired: false });
        announce('Has cerrado sesión.');
        loadSession({ silent: true });
      },

      /** Para clientes privados que reciben 401: la sesión ya no es válida. */
      expireSession() {
        invalidatePending();
        clearIdentity();
        set({ sessionExpired: true });
        announce('Tu sesión ha caducado. Vuelve a entrar para continuar.');
        loadSession({ silent: true });
      },

      /** Registra un limpiador de datos privados; devuelve la función para darlo de baja. */
      onPrivateReset(listener) {
        privateResetListeners.add(listener);
        return () => privateResetListeners.delete(listener);
      },
    };
  });
}

export const defaultAuthStore = createAuthStore();

const AuthStoreContext = createContext(defaultAuthStore);

/** Permite inyectar un store con cliente simulado en pruebas. */
export function AuthProvider({ store = defaultAuthStore, children }) {
  return createElement(AuthStoreContext.Provider, { value: store }, children);
}

export function useAuthStore() {
  return useContext(AuthStoreContext);
}

/** Selector sobre el store de sesión del contexto. */
export function useAuth(selector) {
  return useStore(useAuthStore(), selector);
}
