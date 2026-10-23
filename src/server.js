import { config } from './config.js';
import { createApp } from './app.js';
import { createStore } from './store/index.js';

const store = await createStore(config.mongoUri);
if (store.kind === 'memory') {
  console.warn('⚠️  MONGODB_URI tidak diisi: berjalan dalam mode demo, data disimpan di memori.');
}
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET tidak diisi: memakai secret development yang tidak aman.');
}

const { server, io } = createApp({ store });

server.listen(config.port, () => {
  console.log(`🚀 Server berjalan di http://localhost:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} diterima, mematikan server...`);
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  await io.close(); // also closes the HTTP server
  await store.close();
  clearTimeout(force);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
