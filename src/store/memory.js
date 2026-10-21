import { randomUUID } from 'node:crypto';
import { ConflictError } from './errors.js';

const clone = (value) => structuredClone(value);

/**
 * In-memory store used for demo mode (no MONGODB_URI) and tests.
 * Implements the same interface as the MongoDB store.
 */
export function createMemoryStore() {
  const users = new Map();
  const rooms = new Map();
  const messages = new Map();
  const roomMessages = new Map(); // roomId -> message ids in chronological order

  const publicUser = ({ passwordHash: _passwordHash, ...user }) => clone(user);

  return {
    kind: 'memory',

    async createUser({ username, passwordHash }) {
      const key = username.toLowerCase();
      if ([...users.values()].some((u) => u.username.toLowerCase() === key)) {
        throw new ConflictError('Username sudah dipakai');
      }
      const user = { id: randomUUID(), username, passwordHash, createdAt: new Date().toISOString(), lastSeenAt: null };
      users.set(user.id, user);
      return publicUser(user);
    },

    async findUserForLogin(username) {
      const key = username.toLowerCase();
      const user = [...users.values()].find((u) => u.username.toLowerCase() === key);
      return user ? { user: publicUser(user), passwordHash: user.passwordHash } : null;
    },

    async getUser(id) {
      const user = users.get(id);
      return user ? publicUser(user) : null;
    },

    async listUsers() {
      return [...users.values()].map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
    },

    async touchUser(id, lastSeenAt) {
      const user = users.get(id);
      if (user) user.lastSeenAt = lastSeenAt.toISOString();
    },

    async ensureDefaultChannels(names) {
      for (const name of names) {
        if (![...rooms.values()].some((r) => r.type === 'channel' && r.name === name)) {
          await this.createChannel({ name, createdBy: null });
        }
      }
    },

    async listRoomsForUser(userId) {
      return [...rooms.values()]
        .filter((r) => r.type === 'channel' || r.members.includes(userId))
        .map(clone);
    },

    async getRoom(id) {
      const room = rooms.get(id);
      return room ? clone(room) : null;
    },

    async createChannel({ name, createdBy }) {
      if ([...rooms.values()].some((r) => r.type === 'channel' && r.name === name)) {
        throw new ConflictError('Channel sudah ada');
      }
      const room = { id: randomUUID(), type: 'channel', name, members: [], createdBy, createdAt: new Date().toISOString() };
      rooms.set(room.id, room);
      roomMessages.set(room.id, []);
      return clone(room);
    },

    async getOrCreateDm(userA, userB) {
      const members = [userA, userB].sort();
      const existing = [...rooms.values()].find(
        (r) => r.type === 'dm' && r.members[0] === members[0] && r.members[1] === members[1],
      );
      if (existing) return { room: clone(existing), created: false };
      const room = { id: randomUUID(), type: 'dm', name: null, members, createdBy: userA, createdAt: new Date().toISOString() };
      rooms.set(room.id, room);
      roomMessages.set(room.id, []);
      return { room: clone(room), created: true };
    },

    async createMessage({ roomId, userId, username, text, replyTo = null }) {
      const message = {
        id: randomUUID(),
        roomId,
        userId,
        username,
        text,
        replyTo,
        reactions: {},
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      };
      messages.set(message.id, message);
      roomMessages.get(roomId).push(message.id);
      return clone(message);
    },

    async listMessages(roomId, { before, limit }) {
      const ids = roomMessages.get(roomId) ?? [];
      let end = ids.length;
      if (before) {
        const index = ids.indexOf(before);
        if (index !== -1) end = index;
      }
      return ids.slice(Math.max(0, end - limit), end).map((id) => clone(messages.get(id)));
    },

    async getMessage(id) {
      const message = messages.get(id);
      return message ? clone(message) : null;
    },

    async updateMessage(id, patch) {
      const message = messages.get(id);
      if (!message) return null;
      Object.assign(message, patch);
      return clone(message);
    },

    async toggleReaction(id, emoji, userId) {
      const message = messages.get(id);
      if (!message) return null;
      const reactors = message.reactions[emoji] ?? [];
      const next = reactors.includes(userId) ? reactors.filter((u) => u !== userId) : [...reactors, userId];
      if (next.length) message.reactions[emoji] = next;
      else delete message.reactions[emoji];
      return clone(message);
    },

    async close() {},
  };
}
