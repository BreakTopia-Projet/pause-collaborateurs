import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cible backend — utiliser 127.0.0.1 pour éviter les problèmes IPv6 sur Windows
const BACKEND = 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'favicon-204',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/favicon.ico') {
            res.statusCode = 204;
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err, _req, _res) => {
            console.warn('[vite] proxy error /api →', err.message);
          });
        },
      },
      '/socket.io': {
        target: BACKEND,
        changeOrigin: true,
        secure: false,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, _res) => {
            console.warn('[vite] proxy error /socket.io →', err.message);
          });
        },
      },
    },
  },
});
