import mongoose from 'mongoose';
import { ConflictError } from './errors.js';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

const userSchema = new Schema(
  {
    username: { type: String, required: true, trim: true },
    usernameLower: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const roomSchema = new Schema(
  {
    type: { type: String, enum: ['channel', 'dm'], required: true },
    name: { type: String, default: null },
    members: [{ type: ObjectId, ref: 'User' }],
    // "<userA>:<userB>" (sorted) so every pair has exactly one DM room
    dmKey: { type: String, default: undefined },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
roomSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { type: 'channel' } });
roomSchema.index({ dmKey: 1 }, { unique: true, sparse: true });
roomSchema.index({ members: 1 });

const messageSchema = new Schema(
  {
    roomId: { type: ObjectId, ref: 'Room', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    text: { type: String, default: '' },
    replyTo: {
      type: new Schema({ id: String, username: String, text: String }, { _id: false }),
      default: null,
    },
    reactions: { type: Map, of: [String], default: () => new Map() },
    editedAt: { type: Date, default: null },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
messageSchema.index({ roomId: 1, createdAt: -1, _id: -1 });

const iso = (date) => (date ? new Date(date).toISOString() : null);

export function defineModels(connection) {
  return {
    User: connection.model('User', userSchema),
    Room: connection.model('Room', roomSchema),
    Message: connection.model('Message', messageSchema),
  };
}

export const toUser = (doc) => ({
  id: String(doc._id),
  username: doc.username,
  createdAt: iso(doc.createdAt),
  lastSeenAt: iso(doc.lastSeenAt),
});

export const toRoom = (doc) => ({
  id: String(doc._id),
  type: doc.type,
  name: doc.name,
  members: (doc.members ?? []).map(String),
  createdBy: doc.createdBy ? String(doc.createdBy) : null,
  createdAt: iso(doc.createdAt),
});

export const toMessage = (doc) => ({
  id: String(doc._id),
  roomId: String(doc.roomId),
  userId: String(doc.userId),
  username: doc.username,
  text: doc.text,
  replyTo: doc.replyTo ? { id: doc.replyTo.id, username: doc.replyTo.username, text: doc.replyTo.text } : null,
  reactions: Object.fromEntries(doc.reactions instanceof Map ? doc.reactions : Object.entries(doc.reactions ?? {})),
  createdAt: iso(doc.createdAt),
  editedAt: iso(doc.editedAt),
  deleted: doc.deleted,
});

const isValidId = (id) => mongoose.isValidObjectId(id);

function rethrowDuplicate(err, message) {
  if (err?.code === 11000) throw new ConflictError(message);
  throw err;
}

export async function createMongoStore(uri) {
  const connection = await mongoose.createConnection(uri).asPromise();
  const { User, Room, Message } = defineModels(connection);
  await Promise.all([User.init(), Room.init(), Message.init()]);

  return {
    kind: 'mongo',

    async createUser({ username, passwordHash }) {
      try {
        const doc = await User.create({ username, usernameLower: username.toLowerCase(), passwordHash });
        return toUser(doc);
      } catch (err) {
        rethrowDuplicate(err, 'Username sudah dipakai');
      }
    },

    async findUserForLogin(username) {
      const doc = await User.findOne({ usernameLower: username.toLowerCase() }).lean();
      return doc ? { user: toUser(doc), passwordHash: doc.passwordHash } : null;
    },

    async getUser(id) {
      if (!isValidId(id)) return null;
      const doc = await User.findById(id).lean();
      return doc ? toUser(doc) : null;
    },

    async listUsers() {
      const docs = await User.find().sort({ usernameLower: 1 }).lean();
      return docs.map(toUser);
    },

    async touchUser(id, lastSeenAt) {
      if (isValidId(id)) await User.updateOne({ _id: id }, { lastSeenAt });
    },

    async ensureDefaultChannels(names) {
      await Promise.all(
        names.map((name) =>
          Room.updateOne({ type: 'channel', name }, { $setOnInsert: { type: 'channel', name } }, { upsert: true }),
        ),
      );
    },

    async listRoomsForUser(userId) {
      const docs = await Room.find({ $or: [{ type: 'channel' }, { members: userId }] })
        .sort({ createdAt: 1 })
        .lean();
      return docs.map(toRoom);
    },

    async getRoom(id) {
      if (!isValidId(id)) return null;
      const doc = await Room.findById(id).lean();
      return doc ? toRoom(doc) : null;
    },

    async createChannel({ name, createdBy }) {
      try {
        return toRoom(await Room.create({ type: 'channel', name, createdBy }));
      } catch (err) {
        rethrowDuplicate(err, 'Channel sudah ada');
      }
    },

    async getOrCreateDm(userA, userB) {
      const members = [userA, userB].sort();
      const dmKey = members.join(':');
      const result = await Room.findOneAndUpdate(
        { dmKey },
        { $setOnInsert: { type: 'dm', members, dmKey, createdBy: userA } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true, lean: true },
      );
      return { room: toRoom(result.value), created: !result.lastErrorObject?.updatedExisting };
    },

    async createMessage({ roomId, userId, username, text, replyTo = null }) {
      return toMessage(await Message.create({ roomId, userId, username, text, replyTo }));
    },

    async listMessages(roomId, { before, limit }) {
      if (!isValidId(roomId)) return [];
      const filter = { roomId };
      if (before && isValidId(before)) {
        const cursor = await Message.findById(before, { createdAt: 1 }).lean();
        if (cursor) {
          filter.$or = [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
          ];
        }
      }
      const docs = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
      return docs.reverse().map(toMessage);
    },

    async getMessage(id) {
      if (!isValidId(id)) return null;
      const doc = await Message.findById(id).lean();
      return doc ? toMessage(doc) : null;
    },

    async updateMessage(id, patch) {
      if (!isValidId(id)) return null;
      const doc = await Message.findByIdAndUpdate(id, patch, { returnDocument: 'after' }).lean();
      return doc ? toMessage(doc) : null;
    },

    async toggleReaction(id, emoji, userId) {
      if (!isValidId(id)) return null;
      const doc = await Message.findById(id);
      if (!doc) return null;
      const reactors = doc.reactions.get(emoji) ?? [];
      const next = reactors.includes(userId) ? reactors.filter((u) => u !== userId) : [...reactors, userId];
      if (next.length) doc.reactions.set(emoji, next);
      else doc.reactions.delete(emoji);
      await doc.save();
      return toMessage(doc);
    },

    async close() {
      await connection.close();
    },
  };
}
