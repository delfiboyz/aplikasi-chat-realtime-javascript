import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { createSocketServer } from './socket/index.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp({ store }) {
  const app = express();
  const server = createServer(app);
  const { io, announceUser } = createSocketServer(server, { store });

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'connect-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          // Would break plain-http LAN access during development
          'upgrade-insecure-requests': config.isProduction ? [] : null,
        },
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok', store: store.kind, uptime: process.uptime() }));
  app.use('/api/auth', authRouter({ store, onUserCreated: announceUser }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));

  // Express 5 forwards rejected promises from async handlers here
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid' });
    console.error('[http]', err);
    res.status(err.status ?? 500).json({ error: 'Terjadi kesalahan di server' });
  });

  return { app, server, io };
}
