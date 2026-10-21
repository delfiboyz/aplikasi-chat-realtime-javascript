# 💬 Obrolan — Aplikasi Chat Realtime

Aplikasi chat realtime modern berbasis **Node.js 22+, Express 5, Socket.IO 4.8, dan MongoDB (Mongoose 9)**, dengan frontend vanilla JavaScript (ES modules, tanpa build step) yang bisa di-install sebagai **PWA**.

## ✨ Fitur

**Chat**
- Channel publik (`#umum`, `#random`, dan channel buatan pengguna)
- Pesan langsung (DM) privat antar pengguna
- Balas pesan (reply/quote), edit, dan hapus pesan sendiri
- Reaksi emoji (👍 ❤️ 😂 😮 😢 🙏 🔥 🎉)
- Format teks ala Markdown: `**tebal**`, `_miring_`, `~~coret~~`, `` `kode` ``, blok kode, link otomatis
- @mention dengan highlight
- Riwayat pesan tersimpan dengan *infinite scroll* (pagination berbasis cursor)

**Realtime**
- Indikator "sedang mengetik…"
- Status online/offline dan "terakhir dilihat"
- Badge jumlah pesan belum dibaca (juga di judul tab dan App Badge)
- Notifikasi browser untuk DM dan mention saat tab tidak aktif
- *Connection state recovery*: koneksi yang putus sebentar tersambung lagi tanpa kehilangan pesan

**UI/UX**
- Desain responsif (sidebar off-canvas di mobile)
- Tema terang / gelap / ikuti sistem
- PWA: bisa di-install, app shell di-cache oleh service worker
- Pintasan keyboard: `Enter` kirim, `Shift+Enter` baris baru, `↑` edit pesan terakhir, `Esc` batal
- CSS modern: nesting, `light-dark()`, `color-mix()`, `:has()`, `field-sizing`, Popover API, `<dialog>`

**Keamanan**
- Password di-hash dengan bcrypt
- Sesi JWT disimpan di cookie `httpOnly` + `SameSite=Strict` (bukan `localStorage`)
- Validasi semua input dengan **Zod** (HTTP dan event socket)
- Header keamanan & Content Security Policy via **Helmet**
- Rate limiting login/registrasi dan pembatasan laju event socket (anti-spam)
- Semua teks pengguna di-escape sebelum dirender (aman dari XSS)
- Hak akses DM dicek di server

## 🚀 Menjalankan

Butuh **Node.js 22.9+**.

```bash
npm install
cp .env.example .env   # lalu sesuaikan isinya
npm run dev            # mode development dengan auto-reload
# atau
npm start
```

Buka <http://localhost:3000>.

> **Mode demo:** jika `MONGODB_URI` dikosongkan, aplikasi berjalan tanpa database (data disimpan di memori dan hilang saat server restart). Cocok untuk mencoba cepat.

### Dengan Docker

```bash
export JWT_SECRET=$(openssl rand -hex 32)
docker compose up --build
```

Ini menjalankan aplikasi beserta MongoDB 8.

## ⚙️ Konfigurasi (`.env`)

| Variabel         | Default       | Keterangan                                                    |
| ---------------- | ------------- | ------------------------------------------------------------- |
| `PORT`           | `3000`        | Port HTTP                                                     |
| `MONGODB_URI`    | _(kosong)_    | URI MongoDB. Kosong = mode demo in-memory                     |
| `JWT_SECRET`     | secret dev    | **Wajib** di production. Gunakan string acak yang panjang     |
| `JWT_EXPIRES_IN` | `7d`          | Masa berlaku sesi                                             |
| `NODE_ENV`       | `development` | `production` mengaktifkan cookie `Secure` dan mewajibkan secret |

## 🧪 Skrip

```bash
npm test      # tes otomatis (node:test): auth API, alur chat Socket.IO, formatter, mapping Mongo
npm run lint  # ESLint
```

CI GitHub Actions menjalankan lint dan tes di Node 22 dan 24.

## 🗂️ Struktur proyek

```
src/
  server.js            # entry point, graceful shutdown
  app.js               # Express app + Helmet + routing
  config.js            # konfigurasi dari environment
  routes/auth.js       # register, login, logout, me
  middleware/          # requireAuth
  socket/index.js      # semua event realtime
  store/               # lapisan data: MongoDB (mongo.js) & in-memory (memory.js)
  lib/                 # JWT/cookie, validasi Zod, rate limiter
public/
  index.html, login.html
  css/style.css
  js/app.js            # client chat
  js/format.js         # Markdown aman, format waktu
  sw.js, manifest.webmanifest
tests/
```

## 📡 Event Socket.IO

Semua event client → server memakai *acknowledgement* dengan bentuk `{ ok: true, data }` atau `{ ok: false, error }`.

| Client → Server  | Payload                         |
| ---------------- | ------------------------------- |
| `bootstrap`      | –                               |
| `room:history`   | `{ roomId, before? }`           |
| `message:send`   | `{ roomId, text, replyTo? }`    |
| `message:edit`   | `{ id, text }`                  |
| `message:delete` | `{ id }`                        |
| `message:react`  | `{ id, emoji }`                 |
| `typing`         | `{ roomId, isTyping }`          |
| `room:create`    | `{ name }`                      |
| `dm:open`        | `{ userId }`                    |

Server → client: `message:new`, `message:updated`, `typing`, `presence`, `room:new`, `user:new`.
