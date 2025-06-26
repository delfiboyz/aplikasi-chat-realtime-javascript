// 8. public/js/chat.js
const socket = io({ auth: { token: localStorage.getItem('token') } });

socket.on('connect_error', (err) => {
  alert('Authentication failed, please login again');
  window.location = '/login.html';
});

socket.on('chatMessage', ({ userId, msg }) => {
  const item = document.createElement('li');
  item.textContent = `${userId}: ${msg}`;
  document.getElementById('messages').appendChild(item);
});

document.getElementById('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('msg');
  socket.emit('chatMessage', input.value);
  input.value = '';
});