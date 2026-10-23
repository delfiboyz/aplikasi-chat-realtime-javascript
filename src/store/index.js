import { createMemoryStore } from './memory.js';

export const DEFAULT_CHANNELS = ['umum', 'random'];

export async function createStore(mongoUri) {
  let store;
  if (mongoUri) {
    const { createMongoStore } = await import('./mongo.js');
    store = await createMongoStore(mongoUri);
  } else {
    store = createMemoryStore();
  }
  await store.ensureDefaultChannels(DEFAULT_CHANNELS);
  return store;
}

/** Channels are open to every user; DMs only to their two members. */
export const canAccessRoom = (room, userId) => room.type === 'channel' || room.members.includes(userId);
