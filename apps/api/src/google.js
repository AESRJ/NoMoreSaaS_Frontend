import { OAuth2Client } from 'google-auth-library';

// Proveedor OIDC de Google (Authorization Code confidencial + PKCE S256).
// El canje del código y la verificación del ID token (firma, iss, aud, exp)
// ocurren en el servidor con google-auth-library. state y nonce los comprueba
// el llamador: verifyIdToken no los valida. Nunca se guardan ni registran
// códigos ni tokens; los mensajes de error de la biblioteca pueden incluir el
// token completo, por eso esta capa los sustituye por GoogleAuthError genérico.

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_ISSUERS = Object.freeze(['https://accounts.google.com', 'accounts.google.com']);
export const GOOGLE_SCOPES = Object.freeze(['openid', 'email', 'profile']);

/** Fallo de canje o verificación sin detalles del proveedor (ni código ni token). */
export class GoogleAuthError extends Error {
  constructor(stage) {
    super(`Fallo de Google en la etapa ${stage}.`);
    this.name = 'GoogleAuthError';
    this.stage = stage;
  }
}

/**
 * @param {{
 *   clientId: string,
 *   clientSecret: string,
 *   redirectUri: string,
 *   client?: OAuth2Client,
 * }} options
 */
export function createGoogleProvider({ clientId, clientSecret, redirectUri, client }) {
  if (!clientId || !clientSecret || !redirectUri) throw new Error('createGoogleProvider requiere clientId, clientSecret y redirectUri');
  const oauth = client ?? new OAuth2Client({ clientId, clientSecret, redirectUri, issuers: [...GOOGLE_ISSUERS] });

  return {
    /** URL de consentimiento: solo host de Google, scopes mínimos, acceso online. */
    authorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        access_type: 'online',
      }).toString();
      return url.toString();
    },

    /**
     * Canjea el código con el verifier PKCE y devuelve las claims del ID token
     * verificado. Descarta access/refresh tokens sin guardarlos.
     */
    async exchange({ code, codeVerifier }) {
      let idToken;
      try {
        const { tokens } = await oauth.getToken({ code, codeVerifier, redirect_uri: redirectUri });
        idToken = tokens && tokens.id_token;
      } catch {
        throw new GoogleAuthError('exchange');
      }
      if (typeof idToken !== 'string' || idToken === '') throw new GoogleAuthError('exchange');
      try {
        const ticket = await oauth.verifyIdToken({ idToken, audience: clientId });
        const payload = ticket.getPayload();
        if (!payload || !GOOGLE_ISSUERS.includes(payload.iss) || payload.aud !== clientId) {
          throw new Error('claims');
        }
        return {
          sub: payload.sub,
          email: payload.email,
          emailVerified: payload.email_verified === true,
          nonce: payload.nonce,
        };
      } catch {
        throw new GoogleAuthError('verify');
      }
    },
  };
}
