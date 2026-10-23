import { Server } from 'socket.io';
import { tokenFromCookieHeader, verifyToken } from '../lib/auth.js';
import { createTokenBucket } from '../lib/rateLimiter.js';
import { parse, schemas } from '../lib/validation.js';
import { canAccessRoom } from '../store/index.js';
import { ConflictError } from '../store/errors.js';

export const HISTORY_PAGE_SIZE = 50;

const roomKey = (roomId) => `room:${roomId}`;
const userKey = (userId) => `user:${userId}`;

class ClientError extends Error {}

export function createSocketServer(httpServer, { store }) {
  const io = new Server(httpServer, {
    // Lets clients that briefly drop (e.g. mobile network switch) resume without missing events
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
    maxHttpBufferSize: 64 * 1024,
  });

  /** userId -> number of open sockets, used for presence */
  const connections = new Map();

  io.use((socket, next) => {
    const user = verifyToken(tokenFromCookieHeader(socket.handshake.headers.cookie) ?? socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const limiter = createTokenBucket({ capacity: 10, refillPerSec: 2 });

    /**
     * Registers an event handler with validation, rate limiting and a uniform
     * `{ ok, data }` / `{ ok: false, error }` acknowledgement.
     */
    const on = (event, schema, handler, { limited = true } = {}) => {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (limited && !limiter.take()) return reply({ ok: false, error: 'Terlalu cepat, pelan-pelan dulu' });
        const { data, error } = schema ? parse(schema, payload) : { data: payload };
        if (error) return reply({ ok: false, error });
        try {
          reply({ ok: true, data: await handler(data) });
        } catch (err) {
          if (err instanceof ClientError || err instanceof ConflictError) return reply({ ok: false, error: err.message });
          console.error(`[socket] ${event} failed`, err);
          reply({ ok: false, error: 'Terjadi kesalahan di server' });
        }
      });
    };

    const accessibleRoom = async (roomId) => {
      const room = await store.getRoom(roomId);
      if (!room || !canAccessRoom(room, user.id)) throw new ClientError('Room tidak ditemukan');
      return room;
    };

    const ownMessage = async (id) => {
      const message = await store.getMessage(id);
      if (!message || message.deleted) throw new ClientError('Pesan tidak ditemukan');
      if (message.userId !== user.id) throw new ClientError('Anda hanya bisa mengubah pesan sendiri');
      return message;
    };

    const broadcastUpdate = (message) => io.to(roomKey(message.roomId)).emit('message:updated', message);

    // Register handlers before any await so no early client event is dropped
    on(
      'bootstrap',
      null,
      async () => {
        const [me, rooms, users] = await Promise.all([
          store.getUser(user.id),
          store.listRoomsForUser(user.id),
          store.listUsers(),
        ]);
        if (!me) throw new ClientError('Akun tidak ditemukan');
        socket.join(rooms.map((r) => roomKey(r.id)));
        return { me, rooms, users, online: [...connections.keys()] };
      },
      { limited: false },
    );

    on(
      'room:history',
      schemas.history,
      async ({ roomId, before }) => {
        await accessibleRoom(roomId);
        const messages = await store.listMessages(roomId, { before, limit: HISTORY_PAGE_SIZE + 1 });
        const hasMore = messages.length > HISTORY_PAGE_SIZE;
        return { messages: hasMore ? messages.slice(1) : messages, hasMore };
      },
      { limited: false },
    );

    on('message:send', schemas.sendMessage, async ({ roomId, text, replyTo }) => {
      await accessibleRoom(roomId);
      let quoted = null;
      if (replyTo) {
        const original = await store.getMessage(replyTo);
        if (original && original.roomId === roomId && !original.deleted) {
          quoted = { id: original.id, username: original.username, text: original.text.slice(0, 200) };
        }
      }
      const message = await store.createMessage({ roomId, userId: user.id, username: user.username, text, replyTo: quoted });
      io.to(roomKey(roomId)).emit('message:new', message);
      return message;
    });

    on('message:edit', schemas.editMessage, async ({ id, text }) => {
      await ownMessage(id);
      const message = await store.updateMessage(id, { text, editedAt: new Date() });
      broadcastUpdate(message);
      return message;
    });

    on('message:delete', schemas.messageId, async ({ id }) => {
      await ownMessage(id);
      const message = await store.updateMessage(id, { text: '', deleted: true, reactions: {}, replyTo: null });
      broadcastUpdate(message);
      return message;
    });

    on('message:react', schemas.react, async ({ id, emoji }) => {
      const existing = await store.getMessage(id);
      if (!existing || existing.deleted) throw new ClientError('Pesan tidak ditemukan');
      await accessibleRoom(existing.roomId);
      const message = await store.toggleReaction(id, emoji, user.id);
      broadcastUpdate(message);
      return message;
    });

    on(
      'typing',
      schemas.typing,
      async ({ roomId, isTyping }) => {
        // Only relay for rooms this socket has joined (i.e. rooms it may access)
        if (!socket.rooms.has(roomKey(roomId))) return null;
        socket.to(roomKey(roomId)).emit('typing', { roomId, userId: user.id, username: user.username, isTyping });
        return null;
      },
      { limited: false },
    );

    on('room:create', schemas.createRoom, async ({ name }) => {
      const room = await store.createChannel({ name, createdBy: user.id });
      io.socketsJoin(roomKey(room.id));
      io.emit('room:new', room);
      return room;
    });

    on('dm:open', schemas.openDm, async ({ userId }) => {
      if (userId === user.id) throw new ClientError('Tidak bisa mengirim DM ke diri sendiri');
      const other = await store.getUser(userId);
      if (!other) throw new ClientError('Pengguna tidak ditemukan');
      const { room, created } = await store.getOrCreateDm(user.id, userId);
      if (created) {
        const members = [userKey(user.id), userKey(userId)];
        io.in(members).socketsJoin(roomKey(room.id));
        io.to(members).emit('room:new', room);
      }
      return room;
    });

    socket.on('disconnect', async () => {
      const remaining = (connections.get(user.id) ?? 1) - 1;
      if (remaining > 0) return connections.set(user.id, remaining);
      connections.delete(user.id);
      const lastSeenAt = new Date();
      io.emit('presence', { userId: user.id, online: false, lastSeenAt: lastSeenAt.toISOString() });
      await store.touchUser(user.id, lastSeenAt).catch((err) => console.error('[socket] touchUser failed', err));
    });

    socket.join(userKey(user.id));
    const count = (connections.get(user.id) ?? 0) + 1;
    connections.set(user.id, count);
    if (count === 1) socket.broadcast.emit('presence', { userId: user.id, online: true, lastSeenAt: null });
  });

  return {
    io,
    /** Lets other parts of the app (e.g. registration) announce new users. */
    announceUser: (newUser) => io.emit('user:new', newUser),
  };
}
