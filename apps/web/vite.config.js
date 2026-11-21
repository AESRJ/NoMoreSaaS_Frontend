import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// La SPA consume /api mediante proxy local: no se habilita CORS en la API.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
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
