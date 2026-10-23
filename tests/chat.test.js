import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { call, nextEvent, startServer } from './helpers.js';

describe('realtime chat over Socket.IO', () => {
  let app, alice, bob, aliceUser, bobUser, general;

  before(async () => {
    app = await startServer();
    const a = await app.register('alice');
    const b = await app.register('bob');
    aliceUser = a.user;
    bobUser = b.user;
    alice = await app.connectAs(a.cookie);
    bob = await app.connectAs(b.cookie);
    const boot = await call(alice, 'bootstrap');
    await call(bob, 'bootstrap');
    general = boot.data.rooms.find((r) => r.name === 'umum');
  });
  after(() => app.close());

  it('rejects unauthenticated sockets', async () => {
    await assert.rejects(app.connectAs(null), /unauthorized/);
  });

  it('bootstraps with default channels, users and presence', async () => {
    const { ok, data } = await call(alice, 'bootstrap');
    assert.ok(ok);
    assert.equal(data.me.username, 'alice');
    assert.deepEqual(data.rooms.map((r) => r.name).sort(), ['random', 'umum']);
    assert.equal(data.users.length, 2);
    assert.ok(data.online.includes(bobUser.id));
  });

  it('broadcasts new messages to the room', async () => {
    const received = nextEvent(bob, 'message:new');
    const { ok, data } = await call(alice, 'message:send', { roomId: general.id, text: '  Halo semua!  ' });
    assert.ok(ok);
    assert.equal(data.text, 'Halo semua!');
    const message = await received;
    assert.equal(message.id, data.id);
    assert.equal(message.username, 'alice');
  });

  it('validates messages', async () => {
    assert.equal((await call(alice, 'message:send', { roomId: general.id, text: '   ' })).ok, false);
    assert.equal((await call(alice, 'message:send', { roomId: general.id, text: 'x'.repeat(4001) })).ok, false);
    assert.equal((await call(alice, 'message:send', { roomId: 'missing', text: 'hi' })).error, 'Room tidak ditemukan');
  });

  it('supports replies, edits, reactions and deletes', async () => {
    const original = (await call(alice, 'message:send', { roomId: general.id, text: 'Pertanyaan?' })).data;
    const reply = (await call(bob, 'message:send', { roomId: general.id, text: 'Jawaban', replyTo: original.id })).data;
    assert.deepEqual(reply.replyTo, { id: original.id, username: 'alice', text: 'Pertanyaan?' });

    assert.equal((await call(bob, 'message:edit', { id: original.id, text: 'hack' })).ok, false);
    const updated = nextEvent(bob, 'message:updated');
    const edited = (await call(alice, 'message:edit', { id: original.id, text: 'Pertanyaan diedit' })).data;
    assert.equal(edited.text, 'Pertanyaan diedit');
    assert.ok(edited.editedAt);
    assert.equal((await updated).id, original.id);

    let reacted = (await call(bob, 'message:react', { id: original.id, emoji: '👍' })).data;
    assert.deepEqual(reacted.reactions, { '👍': [bobUser.id] });
    reacted = (await call(bob, 'message:react', { id: original.id, emoji: '👍' })).data;
    assert.deepEqual(reacted.reactions, {});
    assert.equal((await call(bob, 'message:react', { id: original.id, emoji: '💩' })).ok, false);

    assert.equal((await call(bob, 'message:delete', { id: original.id })).ok, false);
    const deleted = (await call(alice, 'message:delete', { id: original.id })).data;
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.text, '');
  });

  it('paginates history', async () => {
    const room = (await call(alice, 'room:create', { name: 'sejarah' })).data;
    for (let i = 0; i < 55; i++) {
      await app.store.createMessage({ roomId: room.id, userId: aliceUser.id, username: 'alice', text: `m${i}` });
    }
    const first = (await call(alice, 'room:history', { roomId: room.id })).data;
    assert.equal(first.messages.length, 50);
    assert.equal(first.hasMore, true);
    assert.equal(first.messages.at(-1).text, 'm54');
    const second = (await call(alice, 'room:history', { roomId: room.id, before: first.messages[0].id })).data;
    assert.deepEqual(
      second.messages.map((m) => m.text),
      ['m0', 'm1', 'm2', 'm3', 'm4'],
    );
    assert.equal(second.hasMore, false);
  });

  it('creates channels that everyone joins', async () => {
    const announced = nextEvent(bob, 'room:new');
    const { data: room } = await call(alice, 'room:create', { name: 'Proyek-Baru' });
    assert.equal(room.name, 'proyek-baru');
    assert.equal((await announced).id, room.id);
    const received = nextEvent(bob, 'message:new');
    await call(alice, 'message:send', { roomId: room.id, text: 'channel baru' });
    assert.equal((await received).roomId, room.id);
    assert.equal((await call(bob, 'room:create', { name: 'proyek-baru' })).error, 'Channel sudah ada');
  });

  it('opens private DMs that only members can read', async () => {
    // Fresh users so earlier tests don't eat into the per-socket rate limit
    const [erin, frank, carol] = await Promise.all(['erin', 'frank', 'carol'].map((name) => app.register(name)));
    const [erinSocket, frankSocket, carolSocket] = await Promise.all(
      [erin, frank, carol].map((account) => app.connectAs(account.cookie)),
    );
    await Promise.all([erinSocket, frankSocket, carolSocket].map((socket) => call(socket, 'bootstrap')));

    const frankNotified = nextEvent(frankSocket, 'room:new');
    const opened = await call(erinSocket, 'dm:open', { userId: frank.user.id });
    assert.ok(opened.ok, opened.error);
    const dm = opened.data;
    assert.equal(dm.type, 'dm');
    assert.equal((await frankNotified).id, dm.id);
    assert.equal((await call(frankSocket, 'dm:open', { userId: erin.user.id })).data.id, dm.id, 'DM is reused');

    let carolSaw = false;
    carolSocket.on('message:new', () => (carolSaw = true));
    const received = nextEvent(frankSocket, 'message:new');
    await call(erinSocket, 'message:send', { roomId: dm.id, text: 'rahasia' });
    assert.equal((await received).text, 'rahasia');
    assert.equal(carolSaw, false);
    assert.equal((await call(carolSocket, 'room:history', { roomId: dm.id })).ok, false);
    assert.equal((await call(carolSocket, 'message:send', { roomId: dm.id, text: 'intip' })).ok, false);
    assert.equal((await call(erinSocket, 'dm:open', { userId: erin.user.id })).ok, false);
  });

  it('relays typing indicators to others in the room', async () => {
    const typing = nextEvent(bob, 'typing');
    alice.emit('typing', { roomId: general.id, isTyping: true });
    assert.deepEqual(await typing, { roomId: general.id, userId: aliceUser.id, username: 'alice', isTyping: true });
  });

  it('tracks presence across connections', async () => {
    const dave = await app.register('dave');
    const online = nextEvent(alice, 'presence');
    const daveSocket = await app.connectAs(dave.cookie);
    assert.deepEqual(await online, { userId: dave.user.id, online: true, lastSeenAt: null });
    const offline = nextEvent(alice, 'presence');
    daveSocket.disconnect();
    const event = await offline;
    assert.equal(event.online, false);
    assert.ok(event.lastSeenAt);
  });

  it('rate limits message floods', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => call(bob, 'message:send', { roomId: general.id, text: `spam ${i}` })),
    );
    assert.ok(results.some((r) => r.ok === false && /pelan/.test(r.error)));
  });
});
