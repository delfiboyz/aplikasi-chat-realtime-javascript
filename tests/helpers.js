import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store/index.js';

export async function startServer() {
  const store = await createStore('');
  const { server, io } = createApp({ store });
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];

  return {
    baseUrl,
    store,
    async post(path, body, headers = {}) {
      const res = await fetch(baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return { res, body: res.status === 204 ? null : await res.json() };
    },
    async register(username, password = 'password123') {
      const { res, body } = await this.post('/api/auth/register', { username, password });
      const cookie = res.headers.get('set-cookie')?.split(';')[0];
      return { user: body.user, cookie };
    },
    async connectAs(cookie) {
      const socket = connect(baseUrl, { extraHeaders: cookie ? { cookie } : {}, transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return socket;
    },
    async close() {
      sockets.forEach((s) => s.disconnect());
      await io.close();
      await store.close();
    },
  };
}

export const call = (socket, event, payload) =>
  new Promise((resolve) => socket.timeout(2000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));

export const nextEvent = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
