import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Raíz del monorepo, donde vive el .env local (ignorado por Git).
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER_KEYS = ['API_HOST', 'API_PORT', 'WEB_HOST', 'WEB_PORT'];

/**
 * Solo las claves de red del servidor de desarrollo, leídas del .env raíz y
 * sobrescritas por el entorno del proceso. Se usan en esta configuración
 * (Node), nunca en el bundle: no hay `define`, `envDir` sigue en apps/web y
 * `envPrefix` es el predeterminado VITE_, así que SESSION_SECRET, DATABASE_PATH
 * o APP_ORIGIN del .env jamás llegan a import.meta.env.
 */
export function readServerEnv(mode, { root = REPO_ROOT, processEnv = process.env } = {}) {
  const fileEnv = loadEnv(mode, root, '');
  return Object.fromEntries(
    SERVER_KEYS.map((key) => [key, processEnv[key] || fileEnv[key]]).filter(([, value]) => value),
  );
}

// La SPA consume /api mediante proxy local: no se habilita CORS en la API.
export default defineConfig(({ mode }) => {
  const env = readServerEnv(mode);
  const apiHost = env.API_HOST || '127.0.0.1';
  const apiPort = env.API_PORT || '3001';
  const webHost = env.WEB_HOST || '127.0.0.1';
  const webPort = Number(env.WEB_PORT || 5173);

  return {
    plugins: [react()],
    server: {
      host: webHost,
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://${apiHost}:${apiPort}`,
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: webHost,
      port: webPort,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.js'],
      include: ['tests/**/*.test.{js,jsx}'],
    },
  };
});
