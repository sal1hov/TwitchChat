const log = document.getElementById('log');
const urlParams = new URLSearchParams(location.search);
const isDemo = urlParams.has('demo');

let maxMessages = 50;
let socket;
let offline = false;
let store = []; // последние сообщения, чтобы пересобирать чат при смене настроек
let nextId = 1;

/* ---------- Настройки ---------- */

const DEFAULTS = {};
for (const tab of (window.CHAT_SCHEMA || { tabs: [] }).tabs) {
  for (const field of tab.fields) DEFAULTS[field.key] = field.def;
}

let cfg = { ...DEFAULTS };

function num(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Принимает цвет с # и без (старые сохранённые настройки хранили без #)
function hex(value, fallback) {
  const v = String(value || '').replace('#', '');
  return /^[0-9a-f]{6}$/i.test(v) ? v : String(fallback).replace('#', '');
}

function rgba(value, fallback, alpha) {
  const h = hex(value, fallback);
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  return 'rgba(' + rgb + ', ' + alpha + ')';
}

function on(key) {
  return String(cfg[key]) === '1';
}

function list(key) {
  return String(cfg[key] || '')
    .toLowerCase()
    .split(',')
    .map((item) => item.trim().replace(/^@/, ''))
    .filter(Boolean);
}

function applySettings(next) {
  cfg = { ...cfg, ...next };
  const root = document.documentElement.style;

  root.setProperty('--bg', rgba(cfg.bg, DEFAULTS.bg, num(cfg.op, 65, 0, 100) / 100));
  root.setProperty('--text', '#' + hex(cfg.color, DEFAULTS.color));
  const family = String(cfg.font || DEFAULTS.font).replace(/["\\]/g, '');
  root.setProperty('--font', '"' + family + '", Arial, Helvetica, sans-serif');
  root.setProperty('--fs', num(cfg.size, 41, 16, 120) + 'px');
  root.setProperty('--gap', num(cfg.gap, 8, 0, 80) + 'px');
  root.setProperty('--msgbg', rgba(cfg.msgbg, DEFAULTS.msgbg, num(cfg.msgop, 0, 0, 100) / 100));
  root.setProperty('--msgr', num(cfg.msgr, 0, 0, 60) + 'px');
  root.setProperty('--msgpad', num(cfg.pad, 0, 0, 60) + 'px');
  root.setProperty('--bw', num(cfg.bw, 0, 0, 20) + 'px');
  root.setProperty('--bc', '#' + hex(cfg.bc, DEFAULTS.bc));
  root.setProperty('--br', num(cfg.br, 0, 0, 100) + 'px');
  root.setProperty('--em', String(num(cfg.emsize, 100, 30, 300) / 100));
  root.setProperty('--hl', rgba(cfg.hl_color, DEFAULTS.hl_color, num(cfg.hl_op, 35, 0, 100) / 100));

  const cls = document.body.classList;
  cls.toggle('no-outline', !on('outline'));
  cls.toggle('no-time', !on('time'));
  cls.toggle('no-badges', !on('badges'));
  cls.toggle('no-nick', !on('nick'));
  cls.toggle('no-reply', !on('reply'));
  cls.toggle('no-flags', !on('flags'));
  cls.toggle('no-sys', !on('sys'));
  cls.toggle('nick-normal', !on('nickbold'));
  cls.toggle('anim', on('anim'));
  cls.toggle('top', cfg.dir === 'top');
  cls.toggle('right', cfg.align === 'right');

  rebuild();
}

/* ---------- Фильтры, подсветка, смайлы ---------- */

function plainText(msg) {
  return (msg.parts || [])
    .map((part) => (part.type === 'emote' ? (part.name || '') : (part.text || '')))
    .join('')
    .trim();
}

function isHidden(msg) {
  if (msg.status) return false;
  const name = String(msg.displayName || '').toLowerCase();
  if (name && list('hidebots').includes(name)) return true;
  const text = plainText(msg).toLowerCase();
  if (on('hidecmd') && text.startsWith('!')) return true;
  return list('hidewords').some((word) => text.includes(word));
}

function isHighlighted(msg) {
  if (!on('hl_on') || msg.status) return false;

  const name = String(msg.displayName || '').toLowerCase();
  if (name && list('hl_users').includes(name)) return true;

  const badges = (msg.badges || []).map((b) => String(b.id || b.title || '').toLowerCase());
  const has = (re) => badges.some((b) => re.test(b));
  if (on('hl_mod') && has(/moderator|модератор/)) return true;
  if (on('hl_vip') && has(/vip/)) return true;
  if (on('hl_sub') && has(/subscriber|founder|подписчик/)) return true;
  if (on('hl_first') && (msg.flags || []).includes('первый')) return true;

  const text = plainText(msg).toLowerCase();
  return list('hl_words').some((word) => text.includes(word));
}

// Откуда смайл: по метке из сообщения или по адресу картинки
function providerOf(part) {
  if (part.provider) return part.provider;
  const url = String(part.url || '');
  if (/betterttv/i.test(url)) return 'bttv';
  if (/7tv/i.test(url)) return '7tv';
  if (/frankerfacez|ffz/i.test(url)) return 'ffz';
  return 'twitch';
}

function emoteOn(part) {
  return on('em_' + providerOf(part));
}

/* ---------- Сообщения ---------- */

function trimLog() {
  const limit = Math.round(num(cfg.max, 0, 0, 200)) || maxMessages;
  while (log.children.length > limit) {
    log.removeChild(log.firstChild);
  }
}

function buildEl(entry) {
  if (isHidden(entry.msg)) return null;
  const el = renderMessage(entry.msg);
  el.dataset.id = String(entry.id);
  el.dataset.at = String(entry.at);
  if (isHighlighted(entry.msg)) el.classList.add('hl');
  return el;
}

// Пересборка нужна, чтобы настройки действовали и на уже показанные сообщения
function rebuild() {
  log.replaceChildren();
  for (const entry of store) {
    const el = buildEl(entry);
    if (el) log.appendChild(el);
  }
  trimLog();
}

function addMessage(msg, quiet) {
  const entry = { id: nextId++, msg, at: Date.now() };
  store.push(entry);
  if (store.length > 300) store.shift();

  const el = buildEl(entry);
  if (!el) return;
  if (!quiet) el.classList.add('enter');
  log.appendChild(el);
  trimLog();
}

// Автоисчезновение сообщений
setInterval(() => {
  const seconds = num(cfg.fade, 0, 0, 600);
  if (!seconds || isDemo) return;
  const cutoff = Date.now() - seconds * 1000;
  store = store.filter((entry) => entry.at >= cutoff);
  for (const el of Array.from(log.children)) {
    if (Number(el.dataset.at) >= cutoff || el.dataset.gone) continue;
    el.dataset.gone = '1';
    el.style.transition = 'opacity 0.4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }
}, 500);

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

  if (msg.displayName) {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = msg.action ? ' ' : ': ';
    text.appendChild(sep);
  }

  // Ограничение длины считаем только по тексту, смайлы не считаются
  const limit = Math.round(num(cfg.maxlen, 0, 0, 500));
  let used = 0;
  let cut = false;

  function appendText(value) {
    if (cut || !value) return;
    let piece = value;
    if (limit && used + piece.length > limit) {
      piece = piece.slice(0, Math.max(0, limit - used)) + '…';
      cut = true;
    }
    used += piece.length;
    text.appendChild(document.createTextNode(piece));
  }

  for (const part of msg.parts || []) {
    if (part.type === 'emote') {
      if (cut) continue;
      if (!emoteOn(part)) {
        appendText(part.name || '');
        continue;
      }
      const img = document.createElement('img');
      img.className = 'emote';
      img.src = part.url;
      img.alt = part.name || '';
      img.title = part.name || '';
      text.appendChild(img);
    } else {
      appendText(part.text);
    }
  }

  line.appendChild(text);
  root.appendChild(line);
  return root;
}

/* ---------- Подключение к серверу ---------- */

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
      store = [];
      if (data.settings) applySettings(data.settings);
      log.replaceChildren();
      for (const msg of data.history || []) addMessage(msg, true);
      return;
    }
    if (data.type === 'settings') {
      applySettings(data.params || {});
      return;
    }
    if (data.type === 'clear') {
      store = [];
      log.replaceChildren();
      return;
    }
    if (data.type === 'deleteMessage') {
      const id = String(data.id || '');
      if (!id) return;
      store = store.filter((entry) => String(entry.msg.id || '') !== id);
      rebuild();
      return;
    }
    if (data.type === 'deleteUserMessages') {
      const login = String(data.login || '').toLowerCase();
      if (!login) return;
      store = store.filter((entry) => String(entry.msg.login || '').toLowerCase() !== login);
      rebuild();
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

/* ---------- Демо-режим для предпросмотра (?demo=1) ---------- */

function face(color) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
    '<circle cx="14" cy="14" r="13" fill="' + color + '"/>' +
    '<circle cx="9.5" cy="11" r="2"/><circle cx="18.5" cy="11" r="2"/>' +
    '<path d="M8 17q6 6 12 0" stroke="#000" stroke-width="2" fill="none"/></svg>'
  );
}

function badgeIcon(color) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
    '<rect width="18" height="18" rx="3" fill="' + color + '"/></svg>'
  );
}

function demo() {
  const t = clock();
  const mod = { url: badgeIcon('#00ad03'), title: 'Moderator', id: 'moderator/1' };
  const sub = { url: badgeIcon('#8b6cff'), title: 'Subscriber', id: 'subscriber/1' };
  const say = (value) => ({ type: 'text', text: value });
  const emote = (name, color, provider) => ({ type: 'emote', name, url: face(color), provider });

  addMessage({ status: 'ok', time: t, parts: [say('чат подключился')] }, true);
  addMessage({
    time: t, displayName: 'Мария', color: '#b57cff', badges: [mod],
    parts: [say('Привет всем! '), emote('Kappa', '#ffd000', 'twitch')]
  }, true);
  addMessage({
    time: t, displayName: 'Alex', color: '#3dff8a', badges: [sub],
    reply: { name: 'Мария', text: 'Привет всем!' },
    parts: [
      say('Классный дизайн '), emote('bttvWow', '#4da6ff', 'bttv'),
      say(' '), emote('7tvLUL', '#ff69b4', '7tv'),
      say(' '), emote('ffzOK', '#3dff8a', 'ffz')
    ]
  }, true);
  addMessage({
    time: t, displayName: 'Nightbot', color: '#4da6ff',
    parts: [say('Не забудьте подписаться на канал!')]
  }, true);
  addMessage({
    time: t, displayName: 'Viewer77', color: '#ff7f50',
    parts: [say('!команда')]
  }, true);
  addMessage({
    time: t, displayName: 'Новичок', color: '#ffd000', flags: ['первый'],
    parts: [say('Это моё первое сообщение здесь')]
  }, true);
  addMessage({
    time: t, displayName: 'Moder', color: '#4da6ff', action: true, badges: [mod],
    parts: [say('машет рукой')]
  }, true);
}

/* ---------- Запуск ---------- */

// 1) Настройки из ссылки (для ручной проверки): /?bg=1a1a2e&op=80
applySettings(Object.fromEntries(urlParams));

// 2) Живое обновление от родительского окна (предпросмотр в приложении)
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (data && data.type === 'settings' && data.params) applySettings(data.params);
});

if (isDemo) demo();
else connect();