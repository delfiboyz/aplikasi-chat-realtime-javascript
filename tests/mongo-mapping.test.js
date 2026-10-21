import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { defineModels, toMessage, toRoom } from '../src/store/mongo.js';

// Runs without a database: only exercises schemas and document -> API mapping.
const { Room, Message } = defineModels(mongoose.createConnection());

describe('MongoDB store mapping', () => {
  it('maps messages (hydrated and lean) to the API shape', () => {
    const doc = new Message({
      roomId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      username: 'budi',
      text: 'halo',
      replyTo: { id: 'abc', username: 'ani', text: 'hai' },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    doc.reactions.set('👍', ['u1']);
    assert.equal(doc.validateSync(), undefined);

    for (const source of [doc, doc.toObject()]) {
      const message = toMessage(source);
      assert.equal(message.id, String(doc._id));
      assert.equal(typeof message.roomId, 'string');
      assert.deepEqual(message.replyTo, { id: 'abc', username: 'ani', text: 'hai' });
      assert.deepEqual(message.reactions, { '👍': ['u1'] });
      assert.equal(message.deleted, false);
      assert.equal(message.editedAt, null);
    }
  });

  it('maps rooms with string member ids', () => {
    const [a, b] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const room = toRoom(new Room({ type: 'dm', members: [a, b], dmKey: `${a}:${b}` }));
    assert.deepEqual(room.members, [String(a), String(b)]);
    assert.equal(room.type, 'dm');
  });
});
