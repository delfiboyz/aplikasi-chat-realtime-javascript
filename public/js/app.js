import { io } from '/socket.io/socket.io.esm.min.js';
import {
  avatarColor,
  formatDay,
  formatFull,
  formatRelative,
  formatTime,
  mentions,
  renderMarkdown,
  sameDay,
} from './format.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const TYPING_IDLE_MS = 3000;

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  sidebar: $('sidebar'),
  backdrop: $('backdrop'),
  menuBtn: $('menu-btn'),
  themeToggle: $('theme-toggle'),
  channelList: $('channel-list'),
  dmList: $('dm-list'),
  dmEmpty: $('dm-empty'),
  userList: $('user-list'),
  userSearch: $('user-search'),
  onlineCount: $('online-count'),
  meAvatar: $('me-avatar'),
  meName: $('me-name'),
  connectionStatus: $('connection-status'),
  notifyBtn: $('notify-btn'),
  logout: $('logout'),
  roomTitle: $('room-title'),
  roomSubtitle: $('room-subtitle'),
  offlineBanner: $('offline-banner'),
  messages: $('messages'),
  messageList: $('message-list'),
  sentinel: $('history-sentinel'),
  jumpBtn: $('jump-btn'),
  composer: $('composer'),
  context: $('composer-context'),
  contextLabel: $('context-label'),
  contextCancel: $('context-cancel'),
  typing: $('typing'),
  input: $('input'),
  newChannel: $('new-channel'),
  channelDialog: $('channel-dialog'),
  channelForm: $('channel-form'),
  channelName: $('channel-name'),
  channelError: $('channel-error'),
  confirmDialog: $('confirm-dialog'),
  reactionPicker: $('reaction-picker'),
  toast: $('toast'),
};

const state = {
  me: null,
  users: new Map(),
  rooms: new Map(),
  online: new Set(),
  currentRoomId: null,
  /** roomId -> { items: Message[], hasMore: boolean, loaded: boolean } */
  history: new Map(),
  unread: new Map(),
  /** roomId -> Map<userId, { username, timer }> */
  typing: new Map(),
  composerMode: null, // { type: 'reply' | 'edit', message }
  loadingHistory: false,
};

const socket = io({ withCredentials: true, autoConnect: false });

/** Emits an event and resolves with the server's `data`, or rejects with its error message. */
function request(event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(10_000).emit(event, payload, (err, response) => {
      if (err) return reject(new Error('Server tidak merespons'));
      if (!response?.ok) return reject(new Error(response?.error ?? 'Terjadi kesalahan'));
      resolve(response.data);
    });
  });
}

// ---------------------------------------------------------------- utilities

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3500);
}

function setAvatar(node, name) {
  node.textContent = name.slice(0, 1).toUpperCase();
  node.style.setProperty('--avatar', avatarColor(name));
}

const roomById = (id) => state.rooms.get(id);
const dmPartner = (room) => state.users.get(room.members.find((id) => id !== state.me.id));
const roomLabel = (room) => (room.type === 'channel' ? `# ${room.name}` : (dmPartner(room)?.username ?? 'Pesan langsung'));

const isNearBottom = () => el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 120;
const scrollToBottom = (behavior = 'instant') => el.messages.scrollTo({ top: el.messages.scrollHeight, behavior });

function updateDocumentTitle() {
  const total = [...state.unread.values()].reduce((sum, n) => sum + n, 0);
  const room = roomById(state.currentRoomId);
  const base = room ? `${roomLabel(room)} · Obrolan` : 'Obrolan';
  document.title = total ? `(${total}) ${base}` : base;
  navigator.setAppBadge?.(total).catch(() => {});
}

// ------------------------------------------------------------------ sidebar

function renderRoomItem(room) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'room-item';
  button.dataset.roomId = room.id;
  if (room.id === state.currentRoomId) button.setAttribute('aria-current', 'page');

  if (room.type === 'dm') {
    const partner = dmPartner(room);
    const avatar = document.createElement('span');
    avatar.className = 'avatar small';
    avatar.classList.toggle('online', !!partner && state.online.has(partner.id));
    setAvatar(avatar, partner?.username ?? '?');
    button.append(avatar);
  } else {
    const hash = document.createElement('span');
    hash.className = 'hash';
    hash.textContent = '#';
    button.append(hash);
  }

  const name = document.createElement('span');
  name.className = 'room-name';
  name.textContent = room.type === 'channel' ? room.name : roomLabel(room);
  button.append(name);

  const unread = state.unread.get(room.id);
  if (unread) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = unread > 99 ? '99+' : String(unread);
    button.append(badge);
  }
  li.append(button);
  return li;
}

function renderRooms() {
  const rooms = [...state.rooms.values()];
  const channels = rooms.filter((r) => r.type === 'channel').sort((a, b) => a.name.localeCompare(b.name));
  const dms = rooms
    .filter((r) => r.type === 'dm')
    .sort((a, b) => roomLabel(a).localeCompare(roomLabel(b)));
  el.channelList.replaceChildren(...channels.map(renderRoomItem));
  el.dmList.replaceChildren(...dms.map(renderRoomItem));
  el.dmEmpty.hidden = dms.length > 0;
  updateDocumentTitle();
}

function renderUsers() {
  const query = el.userSearch.value.trim().toLowerCase();
  const users = [...state.users.values()]
    .filter((u) => u.id !== state.me.id && u.username.toLowerCase().includes(query))
    .sort((a, b) => Number(state.online.has(b.id)) - Number(state.online.has(a.id)) || a.username.localeCompare(b.username));

  el.userList.replaceChildren(
    ...users.map((user) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'user-item';
      button.dataset.userId = user.id;
      const online = state.online.has(user.id);
      button.title = online ? 'Online · klik untuk DM' : `Terakhir dilihat ${user.lastSeenAt ? formatRelative(user.lastSeenAt) : '—'}`;

      const avatar = document.createElement('span');
      avatar.className = 'avatar small';
      avatar.classList.toggle('online', online);
      setAvatar(avatar, user.username);
      const name = document.createElement('span');
      name.textContent = user.username;
      button.append(avatar, name);
      li.append(button);
      return li;
    }),
  );
  const onlineOthers = [...state.online].filter((id) => id !== state.me.id).length;
  el.onlineCount.textContent = `${onlineOthers} online`;
}

function renderHeader() {
  const room = roomById(state.currentRoomId);
  if (!room) return;
  el.roomTitle.textContent = roomLabel(room);
  if (room.type === 'dm') {
    const partner = dmPartner(room);
    el.roomSubtitle.textContent = !partner
      ? ''
      : state.online.has(partner.id)
        ? 'Online'
        : partner.lastSeenAt
          ? `Terakhir dilihat ${formatRelative(partner.lastSeenAt)}`
          : 'Offline';
  } else {
    el.roomSubtitle.textContent = `${state.online.size} pengguna online`;
  }
  el.input.placeholder = `Kirim pesan ke ${roomLabel(room)}`;
  updateDocumentTitle();
}

function openSidebar(open) {
  el.app.classList.toggle('sidebar-open', open);
}

// ----------------------------------------------------------------- messages

function isGrouped(message, previous) {
  return (
    !!previous &&
    !previous.deleted &&
    previous.userId === message.userId &&
    sameDay(previous.createdAt, message.createdAt) &&
    new Date(message.createdAt) - new Date(previous.createdAt) < GROUP_WINDOW_MS
  );
}

function daySeparator(iso) {
  const li = document.createElement('li');
  li.className = 'day-separator';
  li.dataset.day = iso;
  li.innerHTML = '<span></span>';
  li.firstChild.textContent = formatDay(iso);
  return li;
}

function actionButton(action, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn small';
  button.dataset.action = action;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = icon;
  return button;
}

function renderMessage(message, grouped) {
  const li = document.createElement('li');
  li.className = 'message';
  li.dataset.id = message.id;
  li.classList.toggle('grouped', grouped);
  li.classList.toggle('own', message.userId === state.me.id);
  li.classList.toggle('deleted', message.deleted);
  li.classList.toggle('mentioned', !message.deleted && message.userId !== state.me.id && mentions(message.text, state.me.username));

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  setAvatar(avatar, message.username);

  const body = document.createElement('div');
  body.className = 'message-body';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const author = document.createElement('span');
  author.className = 'author';
  author.textContent = message.username;
  const time = document.createElement('time');
  time.dateTime = message.createdAt;
  time.title = formatFull(message.createdAt);
  time.textContent = formatTime(message.createdAt);
  meta.append(author, time);
  body.append(meta);

  if (message.deleted) {
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = 'Pesan ini telah dihapus';
    body.append(text);
    li.append(avatar, body);
    return li;
  }

  if (message.replyTo) {
    const quote = document.createElement('button');
    quote.type = 'button';
    quote.className = 'reply-quote';
    quote.dataset.action = 'jump';
    quote.dataset.target = message.replyTo.id;
    const who = document.createElement('strong');
    who.textContent = `↪ ${message.replyTo.username}`;
    const what = document.createElement('span');
    what.textContent = message.replyTo.text;
    quote.append(who, what);
    body.append(quote);
  }

  const text = document.createElement('div');
  text.className = 'text';
  text.innerHTML = renderMarkdown(message.text, state.me.username);
  if (message.editedAt) {
    const edited = document.createElement('span');
    edited.className = 'edited';
    edited.title = formatFull(message.editedAt);
    edited.textContent = '(diedit)';
    text.append(' ', edited);
  }
  body.append(text);

  const entries = Object.entries(message.reactions ?? {});
  if (entries.length) {
    const reactions = document.createElement('div');
    reactions.className = 'reactions';
    for (const [emoji, users] of entries) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'reaction';
      chip.dataset.action = 'toggle-reaction';
      chip.dataset.emoji = emoji;
      chip.classList.toggle('mine', users.includes(state.me.id));
      chip.title = users.map((id) => state.users.get(id)?.username ?? '?').join(', ');
      chip.textContent = `${emoji} ${users.length}`;
      reactions.append(chip);
    }
    body.append(reactions);
  }

  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.append(actionButton('react', 'Beri reaksi', '☺'), actionButton('reply', 'Balas', '↩'));
  if (message.userId === state.me.id) {
    actions.append(actionButton('edit', 'Edit', '✎'), actionButton('delete', 'Hapus', '🗑'));
  }

  li.append(avatar, body, actions);
  return li;
}

function renderHistory() {
  const history = state.history.get(state.currentRoomId);
  const nodes = [];
  let previous = null;
  for (const message of history?.items ?? []) {
    if (!previous || !sameDay(previous.createdAt, message.createdAt)) nodes.push(daySeparator(message.createdAt));
    nodes.push(renderMessage(message, isGrouped(message, previous)));
    previous = message;
  }
  if (history?.loaded && !history.hasMore) {
    const intro = document.createElement('li');
    intro.className = 'room-intro';
    const room = roomById(state.currentRoomId);
    intro.textContent =
      room?.type === 'dm'
        ? `Ini adalah awal percakapan Anda dengan ${roomLabel(room)}.`
        : `Selamat datang di ${roomLabel(room)}! Ini adalah awal channel.`;
    nodes.unshift(intro);
  }
  el.messageList.replaceChildren(...nodes);
}

function appendMessage(message) {
  const items = state.history.get(message.roomId).items;
  const previous = items.at(-2);
  if (!previous || !sameDay(previous.createdAt, message.createdAt)) {
    el.messageList.append(daySeparator(message.createdAt));
  }
  el.messageList.append(renderMessage(message, isGrouped(message, previous)));
}

function replaceMessage(message) {
  const node = el.messageList.querySelector(`[data-id="${CSS.escape(message.id)}"]`);
  if (node) node.replaceWith(renderMessage(message, node.classList.contains('grouped')));
}

async function loadHistory(roomId) {
  const history = state.history.get(roomId);
  if (state.loadingHistory || (history.loaded && !history.hasMore)) return;
  state.loadingHistory = true;
  el.messages.classList.add('loading');
  try {
    const before = history.items[0]?.id;
    const { messages, hasMore } = await request('room:history', { roomId, before });
    const known = new Set(history.items.map((m) => m.id));
    history.items = [...messages.filter((m) => !known.has(m.id)), ...history.items];
    history.hasMore = hasMore;
    const firstLoad = !history.loaded;
    history.loaded = true;
    if (roomId !== state.currentRoomId) return;
    // Keep the viewport anchored while older messages are inserted above it
    const offset = el.messages.scrollHeight - el.messages.scrollTop;
    renderHistory();
    if (firstLoad) scrollToBottom();
    else el.messages.scrollTop = el.messages.scrollHeight - offset;
  } catch (err) {
    toast(err.message);
  } finally {
    state.loadingHistory = false;
    el.messages.classList.remove('loading');
  }
  // Keep loading while the sentinel is still visible (e.g. very tall screens)
  if (roomId === state.currentRoomId && state.history.get(roomId).hasMore && sentinelVisible) loadHistory(roomId);
}

function ensureHistory(roomId) {
  if (!state.history.has(roomId)) state.history.set(roomId, { items: [], hasMore: true, loaded: false });
  return state.history.get(roomId);
}

async function switchRoom(roomId) {
  if (!roomById(roomId)) return;
  if (state.currentRoomId && state.currentRoomId !== roomId) sendTyping(false);
  state.currentRoomId = roomId;
  state.unread.delete(roomId);
  setComposerMode(null);
  try {
    localStorage.setItem('lastRoom', roomId);
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', `#${roomId}`);
  renderRooms();
  renderHeader();
  renderTyping();
  openSidebar(false);
  el.jumpBtn.hidden = true;

  const roomHistory = ensureHistory(roomId);
  renderHistory();
  if (roomHistory.loaded) scrollToBottom();
  else await loadHistory(roomId);
  if (matchMedia('(pointer: fine)').matches) el.input.focus();
}

// ------------------------------------------------------------------ typing

function renderTyping() {
  const typers = [...(state.typing.get(state.currentRoomId)?.values() ?? [])].map((t) => t.username);
  if (!typers.length) {
    el.typing.textContent = '';
    return;
  }
  const names = typers.length > 3 ? `${typers.length} orang` : typers.join(', ');
  el.typing.textContent = `${names} sedang mengetik…`;
}

function setRemoteTyping({ roomId, userId, username, isTyping }) {
  if (!state.typing.has(roomId)) state.typing.set(roomId, new Map());
  const room = state.typing.get(roomId);
  clearTimeout(room.get(userId)?.timer);
  if (isTyping) {
    // Auto-expire in case the "stopped typing" event never arrives
    room.set(userId, { username, timer: setTimeout(() => setRemoteTyping({ roomId, userId, isTyping: false }), 6000) });
  } else {
    room.delete(userId);
  }
  if (roomId === state.currentRoomId) renderTyping();
}

let typingSent = false;
let typingTimer;
function sendTyping(isTyping) {
  clearTimeout(typingTimer);
  if (!state.currentRoomId || typingSent === isTyping) return;
  typingSent = isTyping;
  socket.emit('typing', { roomId: state.currentRoomId, isTyping });
}

// ---------------------------------------------------------------- composer

function setComposerMode(mode) {
  state.composerMode = mode;
  el.context.hidden = !mode;
  el.composer.classList.toggle('editing', mode?.type === 'edit');
  if (!mode) {
    el.contextLabel.textContent = '';
    return;
  }
  if (mode.type === 'reply') {
    el.contextLabel.textContent = `Membalas ${mode.message.username}: ${mode.message.text.slice(0, 80)}`;
  } else {
    el.contextLabel.textContent = 'Mengedit pesan · Esc untuk batal';
    el.input.value = mode.message.text;
  }
  autoResize();
  el.input.focus();
}

function autoResize() {
  // Fallback for browsers without CSS `field-sizing: content`
  if (CSS.supports('field-sizing', 'content')) return;
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`;
}

async function submitComposer() {
  const text = el.input.value.trim();
  if (!text || !state.currentRoomId) return;
  const mode = state.composerMode;
  sendTyping(false);
  el.input.value = '';
  autoResize();
  setComposerMode(null);
  try {
    if (mode?.type === 'edit') {
      if (text !== mode.message.text) await request('message:edit', { id: mode.message.id, text });
    } else {
      await request('message:send', { roomId: state.currentRoomId, text, replyTo: mode?.message.id });
      scrollToBottom('smooth');
    }
  } catch (err) {
    el.input.value = text; // don't lose what the user typed
    if (mode) setComposerMode(mode);
    autoResize();
    toast(err.message);
  }
}

el.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  submitComposer();
});

el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitComposer();
  } else if (event.key === 'Escape' && state.composerMode) {
    if (state.composerMode.type === 'edit') el.input.value = '';
    setComposerMode(null);
  } else if (event.key === 'ArrowUp' && !el.input.value) {
    const mine = state.history.get(state.currentRoomId)?.items.findLast((m) => m.userId === state.me.id && !m.deleted);
    if (mine) {
      event.preventDefault();
      setComposerMode({ type: 'edit', message: mine });
    }
  }
});

el.input.addEventListener('input', () => {
  autoResize();
  if (state.composerMode?.type === 'edit') return;
  if (el.input.value.trim()) {
    sendTyping(true);
    typingTimer = setTimeout(() => sendTyping(false), TYPING_IDLE_MS);
  } else {
    sendTyping(false);
  }
});

el.contextCancel.addEventListener('click', () => {
  if (state.composerMode?.type === 'edit') el.input.value = '';
  setComposerMode(null);
});

// --------------------------------------------------------- message actions

const findMessage = (id) => state.history.get(state.currentRoomId)?.items.find((m) => m.id === id);
let pickerTarget = null;

el.reactionPicker.replaceChildren(
  ...REACTIONS.map((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = emoji;
    button.dataset.emoji = emoji;
    button.setAttribute('aria-label', `Reaksi ${emoji}`);
    return button;
  }),
);

el.reactionPicker.addEventListener('click', (event) => {
  const emoji = event.target.closest('[data-emoji]')?.dataset.emoji;
  if (!emoji || !pickerTarget) return;
  el.reactionPicker.hidePopover();
  request('message:react', { id: pickerTarget, emoji }).catch((err) => toast(err.message));
});

function showReactionPicker(anchor, messageId) {
  pickerTarget = messageId;
  const rect = anchor.getBoundingClientRect();
  el.reactionPicker.showPopover();
  const width = el.reactionPicker.offsetWidth;
  el.reactionPicker.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
  el.reactionPicker.style.top = `${Math.max(8, rect.top - el.reactionPicker.offsetHeight - 6)}px`;
}

function confirmDelete() {
  return new Promise((resolve) => {
    el.confirmDialog.returnValue = '';
    el.confirmDialog.showModal();
    el.confirmDialog.addEventListener('close', () => resolve(el.confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

function highlight(messageId) {
  const node = el.messageList.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
  if (!node) return toast('Pesan asli ada di riwayat yang lebih lama');
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.remove('flash');
  requestAnimationFrame(() => node.classList.add('flash'));
}

el.messageList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  const id = button?.closest('.message')?.dataset.id;
  if (!button || !id) return;
  const message = findMessage(id);
  if (!message) return;

  switch (button.dataset.action) {
    case 'react':
      showReactionPicker(button, id);
      break;
    case 'toggle-reaction':
      request('message:react', { id, emoji: button.dataset.emoji }).catch((err) => toast(err.message));
      break;
    case 'reply':
      setComposerMode({ type: 'reply', message });
      break;
    case 'edit':
      setComposerMode({ type: 'edit', message });
      break;
    case 'delete':
      if (await confirmDelete()) request('message:delete', { id }).catch((err) => toast(err.message));
      break;
    case 'jump':
      highlight(button.dataset.target);
      break;
  }
});

// --------------------------------------------------------------- scrolling

let sentinelVisible = false;
new IntersectionObserver(
  ([entry]) => {
    sentinelVisible = entry.isIntersecting;
    if (sentinelVisible && state.currentRoomId && state.history.get(state.currentRoomId)?.loaded) {
      loadHistory(state.currentRoomId);
    }
  },
  { root: el.messages, rootMargin: '300px 0px 0px 0px' },
).observe(el.sentinel);

el.messages.addEventListener('scroll', () => {
  if (isNearBottom()) el.jumpBtn.hidden = true;
});
el.jumpBtn.addEventListener('click', () => {
  scrollToBottom('smooth');
  el.jumpBtn.hidden = true;
});

// ----------------------------------------------------------- notifications

function updateNotifyButton() {
  el.notifyBtn.hidden = !('Notification' in window) || Notification.permission !== 'default';
}

el.notifyBtn.addEventListener('click', async () => {
  await Notification.requestPermission();
  updateNotifyButton();
});

function notify(message) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const room = roomById(message.roomId);
  const notification = new Notification(room.type === 'dm' ? message.username : `${message.username} di ${roomLabel(room)}`, {
    body: message.text.slice(0, 160),
    tag: message.roomId,
    icon: '/icon.svg',
  });
  notification.onclick = () => {
    window.focus();
    switchRoom(message.roomId);
    notification.close();
  };
}

// ---------------------------------------------------------------- sidebar UI

el.channelList.addEventListener('click', (event) => {
  const id = event.target.closest('[data-room-id]')?.dataset.roomId;
  if (id) switchRoom(id);
});
el.dmList.addEventListener('click', (event) => {
  const id = event.target.closest('[data-room-id]')?.dataset.roomId;
  if (id) switchRoom(id);
});
el.userList.addEventListener('click', async (event) => {
  const userId = event.target.closest('[data-user-id]')?.dataset.userId;
  if (!userId) return;
  try {
    const room = await request('dm:open', { userId });
    if (!state.rooms.has(room.id)) state.rooms.set(room.id, room);
    switchRoom(room.id);
  } catch (err) {
    toast(err.message);
  }
});
el.userSearch.addEventListener('input', renderUsers);

el.menuBtn.addEventListener('click', () => openSidebar(true));
el.backdrop.addEventListener('click', () => openSidebar(false));

el.newChannel.addEventListener('click', () => {
  el.channelForm.reset();
  el.channelError.hidden = true;
  el.channelDialog.showModal();
});

el.channelForm.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'create') return;
  event.preventDefault();
  try {
    const room = await request('room:create', { name: el.channelName.value });
    state.rooms.set(room.id, room);
    el.channelDialog.close();
    switchRoom(room.id);
  } catch (err) {
    el.channelError.textContent = err.message;
    el.channelError.hidden = false;
  }
});

const THEMES = ['system', 'light', 'dark'];
el.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme ?? 'system';
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* ignore */
  }
  toast(`Tema: ${{ system: 'ikuti sistem', light: 'terang', dark: 'gelap' }[next]}`);
});

el.logout.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  socket.disconnect();
  location.replace('/login.html');
});

// ------------------------------------------------------------ socket events

function setConnectionStatus(text, online) {
  el.connectionStatus.textContent = text;
  el.connectionStatus.classList.toggle('online', online);
  el.offlineBanner.hidden = online || !state.me;
}

socket.on('connect', async () => {
  setConnectionStatus('Online', true);
  try {
    const data = await request('bootstrap');
    state.me = data.me;
    state.users = new Map(data.users.map((u) => [u.id, u]));
    state.rooms = new Map(data.rooms.map((r) => [r.id, r]));
    state.online = new Set(data.online);
    state.online.add(data.me.id);
    el.meName.textContent = data.me.username;
    setAvatar(el.meAvatar, data.me.username);
    el.app.removeAttribute('data-loading');

    // After a reconnect, refetch the latest page so nothing missed is lost
    for (const [roomId, roomHistory] of state.history) {
      if (!state.rooms.has(roomId)) state.history.delete(roomId);
      else if (!socket.recovered) Object.assign(roomHistory, { items: [], hasMore: true, loaded: false });
    }

    renderUsers();
    let lastRoom = null;
    try {
      lastRoom = localStorage.getItem('lastRoom');
    } catch {
      /* ignore */
    }
    const target = [location.hash.slice(1), state.currentRoomId, lastRoom].find((id) => id && state.rooms.has(id));
    const fallback = [...state.rooms.values()].find((r) => r.type === 'channel');
    state.currentRoomId = null;
    await switchRoom(target ?? fallback.id);
  } catch (err) {
    toast(err.message);
    if (err.message === 'Akun tidak ditemukan') el.logout.click();
  }
});

socket.on('disconnect', () => setConnectionStatus('Terputus', false));

socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') {
    location.replace('/login.html');
    return;
  }
  setConnectionStatus('Menyambungkan ulang…', false);
});

socket.on('message:new', (message) => {
  const roomHistory = ensureHistory(message.roomId);
  if (roomHistory.items.some((m) => m.id === message.id)) return;
  roomHistory.items.push(message);
  setRemoteTyping({ roomId: message.roomId, userId: message.userId, isTyping: false });

  const own = message.userId === state.me.id;
  const viewing = message.roomId === state.currentRoomId && document.visibilityState === 'visible';

  if (message.roomId === state.currentRoomId && roomHistory.loaded) {
    const stick = own || isNearBottom();
    appendMessage(message);
    if (stick) scrollToBottom('smooth');
    else el.jumpBtn.hidden = false;
  }

  if (!own && !viewing) {
    state.unread.set(message.roomId, (state.unread.get(message.roomId) ?? 0) + 1);
    renderRooms();
    const room = roomById(message.roomId);
    if (document.visibilityState === 'hidden' && (room?.type === 'dm' || mentions(message.text, state.me.username))) {
      notify(message);
    }
  }
});

socket.on('message:updated', (message) => {
  const items = state.history.get(message.roomId)?.items;
  const index = items?.findIndex((m) => m.id === message.id) ?? -1;
  if (index === -1) return;
  items[index] = message;
  if (message.roomId === state.currentRoomId) replaceMessage(message);
  if (state.composerMode?.message.id === message.id && message.deleted) setComposerMode(null);
});

socket.on('typing', setRemoteTyping);

socket.on('presence', ({ userId, online, lastSeenAt }) => {
  if (online) state.online.add(userId);
  else state.online.delete(userId);
  const user = state.users.get(userId);
  if (user && lastSeenAt) user.lastSeenAt = lastSeenAt;
  renderUsers();
  renderRooms();
  renderHeader();
});

socket.on('user:new', (user) => {
  state.users.set(user.id, user);
  renderUsers();
});

socket.on('room:new', (room) => {
  state.rooms.set(room.id, room);
  renderRooms();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.currentRoomId) {
    state.unread.delete(state.currentRoomId);
    renderRooms();
  }
});

// Refresh relative "last seen" labels
setInterval(() => {
  if (!state.me) return;
  renderHeader();
}, 60_000);

// ------------------------------------------------------------------- start

updateNotifyButton();
socket.connect();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
