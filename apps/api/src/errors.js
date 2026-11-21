// Errores públicos de la API: código estable y mensaje en español, sin stack.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const invalidId = () => new ApiError(400, 'INVALID_ID', 'El identificador no tiene un formato válido.');
export const notFound = (message = 'El recurso solicitado no existe.') => new ApiError(404, 'NOT_FOUND', message);

export function sendError(res, status, code, message) {
  res.status(status).type('application/json').json({ error: { code, message } });
}

export function notFoundHandler(_req, res) {
  sendError(res, 404, 'NOT_FOUND', 'El recurso solicitado no existe.');
}

/** Manejador central: nunca expone detalles internos al cliente. */
export function createErrorHandler(logger = console) {
  // Express identifica el manejador de errores por sus cuatro argumentos.
  return function errorHandler(err, _req, res, _next) {
    if (err instanceof ApiError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    // Express marca con 400 los parámetros con codificación porcentual inválida;
    // el único parámetro de la API es el ID, así que se responde INVALID_ID.
    if (err && err.status === 400) {
      const { status, code, message } = invalidId();
      sendError(res, status, code, message);
      return;
    }
    logger.error('[api] error interno:', err && err.message ? err.message : err);
    sendError(res, 500, 'INTERNAL_ERROR', 'Se produjo un error interno. Inténtalo de nuevo más tarde.');
  };
}
