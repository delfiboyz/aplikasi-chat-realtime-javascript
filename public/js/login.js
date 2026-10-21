const form = document.getElementById('auth-form');
const submit = document.getElementById('submit');
const errorBox = document.getElementById('form-error');
const hint = document.getElementById('form-hint');
const subtitle = document.getElementById('auth-subtitle');
const password = document.getElementById('password');
const tabs = { login: document.getElementById('tab-login'), register: document.getElementById('tab-register') };

let mode = 'login';

function setMode(next) {
  mode = next;
  const isRegister = mode === 'register';
  tabs.login.setAttribute('aria-selected', String(!isRegister));
  tabs.register.setAttribute('aria-selected', String(isRegister));
  submit.textContent = isRegister ? 'Buat akun' : 'Masuk';
  subtitle.textContent = isRegister ? 'Buat akun baru, gratis dan cepat.' : 'Masuk untuk mulai mengobrol secara realtime.';
  password.autocomplete = isRegister ? 'new-password' : 'current-password';
  hint.hidden = !isRegister;
  errorBox.hidden = true;
  history.replaceState(null, '', isRegister ? '#daftar' : location.pathname);
}

tabs.login.addEventListener('click', () => setMode('login'));
tabs.register.addEventListener('click', () => setMode('register'));
if (location.hash === '#daftar') setMode('register');

// Already signed in? Go straight to the chat.
fetch('/api/auth/me').then((res) => {
  if (res.ok) location.replace('/');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  if (mode === 'register' && !form.checkValidity()) {
    hint.hidden = false;
    form.reportValidity();
    return;
  }
  submit.disabled = true;
  try {
    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Gagal, coba lagi');
    location.replace('/');
  } catch (err) {
    errorBox.textContent = err.message === 'Failed to fetch' ? 'Tidak dapat terhubung ke server' : err.message;
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
