const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const URL_PATTERN = /\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;

function formatInline(text, myUsername) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])[_*](?=\S)(.+?)(?<=\S)[_*](?=$|[\s).,!?])/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w@])@([a-zA-Z0-9_]{3,20})\b/g, (_, pre, name) => {
      const self = myUsername && name.toLowerCase() === myUsername.toLowerCase();
      return `${pre}<span class="mention${self ? ' mention-me' : ''}">@${name}</span>`;
    });
}

function formatText(text, myUsername) {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    html += formatInline(text.slice(last, match.index), myUsername);
    const url = escapeHtml(match[0]);
    html += `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    last = match.index + match[0].length;
  }
  return html + formatInline(text.slice(last), myUsername);
}

/**
 * Renders a small, safe subset of Markdown: code blocks, inline code, bold,
 * italic, strikethrough, links and @mentions. All user text is escaped first.
 */
export function renderMarkdown(text, myUsername) {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
        return `<pre><code>${escapeHtml(part.slice(3, -3).replace(/^\w*\n/, ''))}</code></pre>`;
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return formatText(part, myUsername);
    })
    .join('');
}

export const mentions = (text, username) =>
  new RegExp(`(^|[^\\w@])@${username}\\b`, 'i').test(text);

export function avatarColor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return `oklch(62% 0.16 ${Math.abs(hash) % 360})`;
}

const timeFormat = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fullFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeStyle: 'short' });
const relativeFormat = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });

export const formatTime = (iso) => timeFormat.format(new Date(iso));
export const formatFull = (iso) => fullFormat.format(new Date(iso));

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
export const sameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b));

export function formatDay(iso) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  if (days === 0) return 'Hari ini';
  if (days === 1) return 'Kemarin';
  return dateFormat.format(new Date(iso));
}

export function formatRelative(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return 'baru saja';
}
