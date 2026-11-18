const log = document.getElementById('log');
let maxMessages = 50;
let socket;
let offline = false;

function addMessage(msg) {
  log.appendChild(renderMessage(msg));
  while (log.children.length > maxMessages) {
    log.removeChild(log.firstChild);
  }
}

function clock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function statusIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'status-icon status ' + kind);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  if (kind === 'ok') {
    path.setAttribute('d', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.6-4.6 1.4 1.4-6 6z');
  } else {
    path.setAttribute('d', 'M12 2 1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z');
  }
  svg.appendChild(path);
  return svg;
}

function renderMessage(msg) {
  const root = document.createElement('div');
  root.className = 'msg' + (msg.status ? ' system ' + msg.status : '');

  if (msg.reply && msg.reply.name) {
    const reply = document.createElement('div');
    reply.className = 'reply';
    reply.textContent = '↩ ' + msg.reply.name + ': ' + (msg.reply.text || '');
    root.appendChild(reply);
  }

  const line = document.createElement('div');
  line.className = 'line';

  if (msg.time) {
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = msg.time;
    line.appendChild(time);
  }

  for (const flag of msg.flags || []) {
    const el = document.createElement('span');
    el.className = 'flag';
    el.textContent = flag;
    line.appendChild(el);
  }

  for (const badge of msg.badges || []) {
    const img = document.createElement('img');
    img.className = 'badge';
    img.src = badge.url;
    img.alt = badge.title || '';
    img.title = badge.title || '';
    line.appendChild(img);
  }

  if (msg.status) line.appendChild(statusIcon(msg.status));

  if (msg.displayName) {
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.style.color = msg.color || '#ffffff';
    nick.textContent = msg.displayName;
    line.appendChild(nick);
  }

  const text = document.createElement('span');
  text.className = 'text' + (msg.action ? ' action' : '') + (msg.status ? ' status ' + msg.status : '');
  if (msg.displayName && !msg.action) {
    text.appendChild(document.createTextNode(': '));
  } else if (msg.displayName) {
    text.appendChild(document.createTextNode(' '));
  }

  for (const part of msg.parts || []) {
    if (part.type === 'emote') {
      const img = document.createElement('img');
      img.className = 'emote';
      img.src = part.url;
      img.alt = part.name || '';
      img.title = part.name || '';
      text.appendChild(img);
    } else if (part.text) {
      text.appendChild(document.createTextNode(part.text));
    }
  }

  line.appendChild(text);
  root.appendChild(line);
  return root;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(proto + '://' + location.host);

  socket.onopen = () => {
    offline = false;
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'hello') {
      maxMessages = data.maxMessages || 50;
      log.replaceChildren();
      for (const msg of data.history || []) addMessage(msg);
      return;
    }
    if (data.type === 'clear') {
      log.replaceChildren();
      return;
    }
    if (data.type === 'message') addMessage(data.message);
  };

  socket.onclose = () => {
    if (!offline) {
      offline = true;
      addMessage({
        status: 'error',
        time: clock(),
        parts: [{ type: 'text', text: 'нет связи с сервером' }]
      });
    }
    setTimeout(connect, 2000);
  };
}

connect();
