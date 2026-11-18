const http = require('http');
const path = require('path');
const express = require('express');
const tmi = require('tmi.js');
const { WebSocketServer } = require('ws');

let fileConfig = {};
try {
  fileConfig = require('./config.json');
} catch (err) {}

let channel = '';
const port = Number(fileConfig.port) || 3000;
const maxMessages = Number(fileConfig.maxMessages) || 50;

const NICK_COLORS = [
  '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50',
  '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
  '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'
];

let emoteMap = new Map();
let badgeMap = new Map();
const history = [];
let loadId = 0;
let runId = 0;

function defaultColor(name) {
  const value = String(name || '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NICK_COLORS[Math.abs(hash) % NICK_COLORS.length];
}

function tagNumber(value) {
  if (value === true) return 1;
  if (value === false || value == null || value === '') return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function tierLabel(methods) {
  if (!methods) return '';
  if (methods.prime) return 'Prime';
  if (methods.plan === '2000') return 'Tier 2';
  if (methods.plan === '3000') return 'Tier 3';
  if (methods.plan === '1000') return 'Tier 1';
  return '';
}

function giftedLabel(n) {
  const n10 = n % 10;
  const n100 = n % 100;
  let word = 'подписок';
  if (n10 === 1 && n100 !== 11) word = 'подписка';
  else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) word = 'подписки';
  return n + ' ' + word + ' в подарок';
}

function viewersLabel(n) {
  const n10 = n % 10;
  const n100 = n % 100;
  let word = 'зрителей';
  if (n10 === 1 && n100 !== 11) word = 'зритель';
  else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) word = 'зрителя';
  return n + ' ' + word;
}

function joinBits(parts) {
  return parts.filter(Boolean).join(' · ');
}

async function getJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(res.status + ' ' + url);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function addBttv(list, map) {
  for (const emote of list || []) {
    if (!emote || !emote.code || !emote.id) continue;
    map.set(emote.code, 'https://cdn.betterttv.net/emote/' + emote.id + '/2x');
  }
}

function add7tv(list, map) {
  for (const emote of list || []) {
    const host = emote && emote.data && emote.data.host;
    if (!emote || !emote.name || !host || !host.url) continue;
    const files = host.files || [];
    const file = files.find((item) => item.name === '2x.webp')
      || files.find((item) => item.name === '1x.webp');
    if (!file) continue;
    const base = host.url.startsWith('http') ? host.url : 'https:' + host.url;
    map.set(emote.name, base + '/' + file.name);
  }
}

function addFfz(data, map) {
  const lists = Array.isArray(data)
    ? [data]
    : [data && data.channelEmotes, data && data.sharedEmotes];
  for (const list of lists) {
    for (const emote of list || []) {
      const images = (emote && emote.images) || {};
      const url = images['2x'] || images['1x'] || '';
      if (!emote || !emote.code || !url) continue;
      map.set(emote.code, url);
    }
  }
}

function addBadges(list, map) {
  for (const set of list || []) {
    for (const version of set.versions || []) {
      const url = version.image_url_2x || version.image_url_1x;
      if (!url) continue;
      map.set(set.set_id + '/' + version.id, {
        url,
        title: version.title || set.set_id
      });
    }
  }
}

let ircUp = false;
let ircProblem = '';
let assetProblems = [];
let currentStatus = { level: 'wait', text: 'подключаюсь к чату' };

function publishStatus() {
  let next;
  if (ircProblem || assetProblems.length) {
    const parts = [];
    if (ircProblem) parts.push(ircProblem);
    if (assetProblems.length) parts.push('не загрузилось: ' + assetProblems.join(', '));
    next = { level: 'error', text: parts.join(' · ') };
  } else if (ircUp) {
    next = { level: 'ok', text: 'чат подключен' };
  } else {
    next = { level: 'wait', text: 'подключаюсь к чату' };
  }

  if (next.level === currentStatus.level && next.text === currentStatus.text) return;
  currentStatus = next;
  if (next.level === 'wait') return;

  emit({
    status: next.level,
    displayName: '',
    badges: [],
    flags: [],
    reply: null,
    action: false,
    parts: [{ type: 'text', text: next.text }]
  });
}

async function loadAssets() {
  const id = ++loadId;
  if (!channel) return;
  const nextEmotes = new Map();
  const nextBadges = new Map();

  try {
    let twitchId = '';
    const globalBadges = new Map();
    const failed = [];

    async function attempt(label, fn) {
      try {
        await fn();
      } catch (err) {
        failed.push(label);
        console.log(label + ': ' + err.message);
      }
    }

    await Promise.all([
      attempt('twitch user', async () => {
        const users = await getJson('https://api.ivr.fi/v2/twitch/user?login=' + encodeURIComponent(channel));
        if (!users[0] || !users[0].id) throw new Error('канал не найден');
        twitchId = users[0].id;
      }),
      attempt('bttv global', async () => {
        addBttv(await getJson('https://api.betterttv.net/3/cached/emotes/global'), nextEmotes);
      }),
      attempt('7tv global', async () => {
        const data = await getJson('https://7tv.io/v3/emote-sets/global');
        add7tv(data.emotes, nextEmotes);
      }),
      attempt('ffz global', async () => {
        addFfz(await getJson('https://api.betterttv.net/3/cached/frankerfacez/emotes/global'), nextEmotes);
      }),
      attempt('badges global', async () => {
        addBadges(await getJson('https://api.ivr.fi/v2/twitch/badges/global'), globalBadges);
      })
    ]);

    for (const [key, value] of globalBadges) nextBadges.set(key, value);

    if (twitchId) {
      const channelBadges = new Map();
      await Promise.all([
        attempt('bttv channel', async () => {
          const data = await getJson('https://api.betterttv.net/3/cached/users/twitch/' + twitchId);
          addBttv(data.channelEmotes, nextEmotes);
          addBttv(data.sharedEmotes, nextEmotes);
        }),
        attempt('7tv channel', async () => {
          const data = await getJson('https://7tv.io/v3/users/twitch/' + twitchId);
          add7tv(data.emote_set && data.emote_set.emotes, nextEmotes);
        }),
        attempt('ffz channel', async () => {
          addFfz(await getJson('https://api.betterttv.net/3/cached/frankerfacez/users/twitch/' + twitchId), nextEmotes);
        }),
        attempt('badges channel', async () => {
          addBadges(await getJson('https://api.ivr.fi/v2/twitch/badges/channel?id=' + twitchId), channelBadges);
        })
      ]);
      for (const [key, value] of channelBadges) nextBadges.set(key, value);
    }

    if (id !== loadId) return;
    emoteMap = nextEmotes;
    badgeMap = nextBadges;
    assetProblems = failed;
    console.log('эмоуты ' + emoteMap.size + ', бейджи ' + badgeMap.size);
  } finally {
    if (id === loadId) publishStatus();
  }
}

function parseThirdParty(text) {
  const parts = [];
  for (const token of text.split(/(\s+)/)) {
    if (!token) continue;
    const url = emoteMap.get(token);
    if (url) parts.push({ type: 'emote', name: token, url });
    else parts.push({ type: 'text', text: token });
  }
  return parts;
}

function parseParts(message, twitchEmotes) {
  const text = message || '';
  const ranges = [];

  if (twitchEmotes && typeof twitchEmotes === 'object') {
    for (const [id, positions] of Object.entries(twitchEmotes)) {
      const list = Array.isArray(positions) ? positions : [];
      for (const pos of list) {
        const [start, end] = String(pos).split('-').map(Number);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        ranges.push({ start, end: end + 1, id });
      }
    }
  }

  ranges.sort((a, b) => a.start - b.start);

  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.end > text.length || range.start >= range.end) continue;
    if (range.start > cursor) parts.push(...parseThirdParty(text.slice(cursor, range.start)));
    parts.push({
      type: 'emote',
      name: text.slice(range.start, range.end),
      url: 'https://static-cdn.jtvnw.net/emoticons/v2/' + range.id + '/default/dark/2.0'
    });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(...parseThirdParty(text.slice(cursor)));
  return parts;
}

function badgesOf(tags) {
  const raw = tags && tags['badges-raw'];
  if (!raw || typeof raw !== 'string') return [];
  const out = [];
  for (const piece of raw.split(',')) {
    const badge = badgeMap.get(piece);
    if (badge) out.push(badge);
  }
  return out;
}

function person(tags, fallbackName) {
  const safeTags = tags || {};
  const login = safeTags.login || safeTags.username || fallbackName || '';
  const displayName = safeTags['display-name'] || fallbackName || login;
  const color = typeof safeTags.color === 'string' && safeTags.color
    ? safeTags.color
    : defaultColor(login || displayName);
  return {
    displayName,
    color,
    badges: badgesOf(safeTags)
  };
}

function flagsOf(tags) {
  const flags = [];
  if (tags && tags['first-msg']) flags.push('первый');
  if (tags && tags['msg-id'] === 'highlighted-message') flags.push('хайлайт');
  return flags;
}

function replyOf(tags) {
  const name = tags && tags['reply-parent-display-name'];
  if (!name || typeof name !== 'string') return null;
  let text = tags['reply-parent-msg-body'] || '';
  if (typeof text !== 'string') text = '';
  if (text.length > 80) text = text.slice(0, 80) + '…';
  return { name, text };
}

function withMessage(prefix, message, emotes) {
  const parts = [{ type: 'text', text: prefix }];
  if (message) {
    parts.push({ type: 'text', text: ' — ' });
    parts.push(...parseParts(message, emotes));
  }
  return parts;
}

function clock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function sendRaw(payload) {
  const data = JSON.stringify(payload);
  for (const socket of wss.clients) {
    if (socket.readyState === 1) socket.send(data);
  }
}

function emit(message) {
  if (!message.time) message.time = clock();
  history.push(message);
  while (history.length > maxMessages) history.shift();
  sendRaw({ type: 'message', message });
}

function clearChat() {
  history.length = 0;
  currentStatus = { level: 'wait', text: 'подключаюсь к чату' };
  sendRaw({ type: 'clear' });
}

function emitUser(tags, fallbackName, parts, extra) {
  emit(Object.assign({
    action: false,
    flags: [],
    reply: null,
    parts
  }, person(tags, fallbackName), extra || {}));
}

const app = express();
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
}));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({
    type: 'hello',
    maxMessages,
    history
  }));
});

function bindIrc(client) {
client.on('connected', () => {
  if (client !== irc) return;
  ircUp = true;
  ircProblem = '';
  console.log('irc подключен, канал #' + channel);
  publishStatus();
});

client.on('disconnected', (reason) => {
  if (client !== irc) return;
  ircUp = false;
  ircProblem = reason ? 'чат отвалился: ' + reason : 'чат отвалился';
  console.log(ircProblem);
  publishStatus();
});

client.on('reconnect', () => {
  if (client !== irc) return;
  ircUp = false;
  ircProblem = 'переподключаюсь к чату';
  publishStatus();
});

client.on('message', (chan, tags, message, self) => {
  if (client !== irc || self || tags['message-type'] === 'whisper') return;
  emitUser(tags, tags.username, parseParts(message, tags.emotes), {
    action: tags['message-type'] === 'action',
    flags: flagsOf(tags),
    reply: replyOf(tags)
  });
});

client.on('subscription', (chan, username, methods, message, tags) => {
  emitUser(tags, username, withMessage(joinBits(['подписка', tierLabel(methods)]), message, tags.emotes));
});

client.on('resub', (chan, username, streakMonths, message, tags, methods) => {
  const months = tagNumber(tags['msg-param-cumulative-months']);
  const label = joinBits([months ? months + ' мес.' : '', tierLabel(methods)]) || 'ресуб';
  emitUser(tags, username, withMessage(label, message, tags.emotes));
});

client.on('subgift', (chan, username, streakMonths, recipient, methods, tags) => {
  emitUser(tags, username, [{
    type: 'text',
    text: joinBits(['подарок', recipient, tierLabel(methods)])
  }]);
});

client.on('anonsubgift', (chan, streakMonths, recipient, methods, tags) => {
  emitUser(tags, 'Аноним', [{
    type: 'text',
    text: joinBits(['подарок', recipient, tierLabel(methods)])
  }], { displayName: 'Аноним', badges: [] });
});

client.on('submysterygift', (chan, username, giftSubCount, methods, tags) => {
  emitUser(tags, username, [{
    type: 'text',
    text: joinBits([giftedLabel(giftSubCount || 0), tierLabel(methods)])
  }]);
});

client.on('anonsubmysterygift', (chan, giftSubCount, methods, tags) => {
  emitUser(tags, 'Аноним', [{
    type: 'text',
    text: joinBits([giftedLabel(giftSubCount || 0), tierLabel(methods)])
  }], { displayName: 'Аноним', badges: [] });
});

client.on('giftpaidupgrade', (chan, username, sender, tags) => {
  emitUser(tags, username, [{
    type: 'text',
    text: sender ? 'подарок от ' + sender + ' продлён' : 'подарок продлён'
  }]);
});

client.on('anongiftpaidupgrade', (chan, username, tags) => {
  emitUser(tags, username, [{ type: 'text', text: 'анонимный подарок продлён' }]);
});

client.on('primepaidupgrade', (chan, username, methods, tags) => {
  emitUser(tags, username, [{
    type: 'text',
    text: 'Prime → ' + (tierLabel(methods) || 'платная')
  }]);
});

client.on('raided', (chan, username, viewers, tags) => {
  const user = person(tags, username);
  emit(Object.assign(user, {
    displayName: username || user.displayName,
    action: false,
    flags: ['рейд'],
    reply: null,
    parts: [{ type: 'text', text: viewersLabel(viewers || 0) }]
  }));
});

client.on('usernotice', (msgid, chan, tags, message) => {
  if (msgid !== 'announcement') return;
  emitUser(tags, '', parseParts(message || '', tags.emotes), {
    flags: ['объявление'].concat(flagsOf(tags))
  });
});
}

let irc = null;
let listening = null;
let refreshTimer = null;
function normalizeChannel(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Введи канал');

  let login = raw;
  if (looksLikeUrl(raw)) {
    const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const host = withoutScheme.split(/[/?#]/)[0].replace(/^www\./i, '').toLowerCase();
    if (host !== 'twitch.tv' && !host.endsWith('.twitch.tv')) {
      throw new Error('Это не ссылка Twitch');
    }
    login = withoutScheme.slice(withoutScheme.indexOf('/') + 1);
    if (!withoutScheme.includes('/')) login = '';
  }

  login = login.split(/[/?#]/)[0].replace(/^#/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(login)) throw new Error('Неверный логин канала');
  return login;
}

function looksLikeUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#]|$)/i.test(value);
}

function ensureListening() {
  if (server.listening) return Promise.resolve();
  if (listening) return listening;
  listening = new Promise((resolve, reject) => {
    const onError = (err) => {
      listening = null;
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      console.log('виджет http://localhost:' + port);
      resolve();
    });
  });
  return listening;
}

function ensureRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (!channel) return;
    loadAssets().catch((err) => console.error(err));
  }, 10 * 60 * 1000);
}

async function switchChannel(next, id) {
  await ensureListening();
  if (id !== runId) return { superseded: true };

  if (irc) {
    const old = irc;
    irc = null;
    old.removeAllListeners();
    old.disconnect().catch(() => {});
  }
  if (id !== runId) return { superseded: true };

  channel = next;
  ircUp = false;
  ircProblem = '';
  assetProblems = [];
  clearChat();
  ensureRefresh();
  await loadAssets();
  if (id !== runId) return { superseded: true };

  const client = new tmi.Client({
    options: { skipUpdatingEmotesets: true },
    connection: { reconnect: true, secure: true },
    channels: [channel]
  });
  if (id !== runId) return { superseded: true };
  irc = client;
  bindIrc(client);

  try {
    await client.connect();
  } catch (err) {
    if (id !== runId) return { superseded: true };
    ircProblem = 'чат не подключился: ' + err.message;
    console.error(ircProblem);
    publishStatus();
    const error = new Error(ircProblem);
    error.url = 'http://localhost:' + port;
    throw error;
  }

  if (id !== runId) return { superseded: true };
  return { url: 'http://localhost:' + port, channel };
}

function startChannel(name) {
  const next = normalizeChannel(name);
  const id = ++runId;
  return switchChannel(next, id);
}

async function stopChannel() {
  runId += 1;
  const old = irc;
  irc = null;
  ircUp = false;
  ircProblem = '';
  if (!old) return;
  old.removeAllListeners();
  try { await old.disconnect(); } catch (err) {}
}

if (require.main === module) {
  const boot = fileConfig.channel ? startChannel(fileConfig.channel) : ensureListening();
  boot.catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { startChannel, stopChannel, port, normalizeChannel };
