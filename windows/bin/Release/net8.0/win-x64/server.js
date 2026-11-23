const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const tmi = require('tmi.js');
const { WebSocketServer } = require('ws');

const hostedMode = process.argv.includes('--desktop-host');
if (hostedMode) {
  // stdout is reserved exclusively for the line-based desktop bridge protocol.
  // Redirect every normal console method to stderr so a dependency cannot corrupt RPC output.
  for (const method of ['log', 'info', 'warn', 'debug', 'dir', 'trace']) {
    console[method] = (...args) => console.error(...args);
  }
}

let fileConfig = {};
try {
  fileConfig = require('./config.json');
} catch (err) { }

let channel = '';
const portValue = Number(fileConfig.port);
const port = Number.isInteger(portValue) && portValue > 0 && portValue <= 65535 ? portValue : 3000;
const configuredMax = Number(fileConfig.maxMessages);
const maxMessages = Number.isFinite(configuredMax) && configuredMax > 0
  ? Math.min(500, Math.floor(configuredMax))
  : 50;
// Keep enough messages for the UI's configurable maximum even when config.json uses a lower default.
const historyLimit = Math.max(200, maxMessages);

const NICK_COLORS = [
  '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50',
  '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
  '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'
];

let emoteMap = new Map();
let badgeMap = new Map();
const activeAssetRequests = new Set();

function abortAssetRequests() {
  for (const controller of activeAssetRequests) controller.abort();
  activeAssetRequests.clear();
}
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
    const controller = new AbortController();
    activeAssetRequests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(res.status + ' ' + url);
      return await res.json();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timeout);
      activeAssetRequests.delete(controller);
    }
  }
  throw lastError;
}

function addBttv(list, map) {
  for (const emote of list || []) {
    if (!emote || !emote.code || !emote.id) continue;
    map.set(emote.code, 'https://cdn.betterttv.net/emote/' + emote.id + '/2x.webp');
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

function addFfzEmotes(emotes, map) {
  for (const emote of emotes || []) {
    if (!emote) continue;
    const urls = emote.urls || emote.images || {};
    let url = urls['2'] || urls['1'] || urls['4'] || urls['2x'] || urls['1x'] || '';
    if (!url) continue;
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//i.test(url)) continue;
    const name = emote.name || emote.code;
    if (name) map.set(name, url);
  }
}

function addFfzGlobal(data, map, twitchId) {
  const sets = data && data.sets && typeof data.sets === 'object' ? data.sets : {};
  const allowed = new Set((data && Array.isArray(data.default_sets) ? data.default_sets : []).map(String));
  if (twitchId && data && data.users && typeof data.users === 'object') {
    for (const [setId, users] of Object.entries(data.users)) {
      if (Array.isArray(users) && users.some((id) => String(id) === String(twitchId))) allowed.add(String(setId));
    }
  }
  for (const setId of allowed) {
    const set = sets[setId];
    if (set && Array.isArray(set.emoticons)) addFfzEmotes(set.emoticons, map);
  }
}

function addFfzRoom(data, map) {
  const sets = data && data.sets && typeof data.sets === 'object' ? data.sets : {};
  const setId = data && data.room && data.room.set != null ? String(data.room.set) : '';
  const set = setId ? sets[setId] : null;
  if (set && Array.isArray(set.emoticons)) addFfzEmotes(set.emoticons, map);
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
  abortAssetRequests();
  const id = ++loadId;
  if (!channel) return;
  const nextEmotes = new Map();
  const nextBadges = new Map();

  try {
    let twitchId = '';
    const globalBadges = new Map();
    let ffzGlobalData = null;
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
        ffzGlobalData = await getJson('https://api.frankerfacez.com/v1/set/global');
      }),
      attempt('badges global', async () => {
        addBadges(await getJson('https://api.ivr.fi/v2/twitch/badges/global'), globalBadges);
      })
    ]);

    for (const [key, value] of globalBadges) nextBadges.set(key, value);
    if (ffzGlobalData) addFfzGlobal(ffzGlobalData, nextEmotes, twitchId);

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
          addFfzRoom(await getJson('https://api.frankerfacez.com/v1/room/id/' + encodeURIComponent(twitchId)), nextEmotes);
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
    if (badge) out.push(Object.assign({ id: piece }, badge));
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
    id: safeTags.id ? String(safeTags.id) : undefined,
    login: String(login).toLowerCase(),
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
    if (socket.readyState === 1) {
      try { socket.send(data, (error) => { if (error) console.error('WebSocket send:', error.message); }); }
      catch (error) { console.error('WebSocket send:', error.message); }
    }
  }
}

function emit(message) {
  if (!message.time) message.time = clock();
  history.push(message);
  while (history.length > historyLimit) history.shift();
  sendRaw({ type: 'message', message });
}

function clearMessages() {
  history.length = 0;
  sendRaw({ type: 'clear' });
}

function clearChat() {
  currentStatus = { level: 'wait', text: 'подключаюсь к чату' };
  clearMessages();
}

function deleteMessage(id) {
  const messageId = String(id || '');
  if (!messageId) return;
  const before = history.length;
  for (let index = history.length - 1; index >= 0; index--) {
    if (String(history[index].id || '') === messageId) history.splice(index, 1);
  }
  if (history.length !== before) sendRaw({ type: 'deleteMessage', id: messageId });
}

function deleteUserMessages(login) {
  const user = String(login || '').trim().replace(/^@/, '').toLowerCase();
  if (!user) return;
  const remaining = history.filter((message) => !message.login || message.login !== user);
  if (remaining.length === history.length) return;
  history.splice(0, history.length, ...remaining);
  sendRaw({ type: 'deleteUserMessages', login: user });
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

let appearance = {};

function setAppearance(next) {
  const clean = {};
  for (const [key, value] of Object.entries(next || {}).slice(0, 80)) {
    if (!/^[a-z0-9_]{1,24}$/i.test(key) || value == null) continue;
    clean[key] = String(value).slice(0, 500);
  }
  appearance = clean;
  sendRaw({ type: 'settings', params: appearance });
  return appearance;
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({
    type: 'hello',
    maxMessages,
    history,
    settings: appearance
  }));
});

function bindIrc(client) {
  let resolveJoin;
  let rejectJoin;
  let joinSettled = false;
  const joined = new Promise((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; });
  // The promise is awaited by switchChannel; mark a handler now to avoid an early unhandled rejection.
  joined.catch(() => {});

  client.on('connected', () => {
    if (client !== irc) return;
    ircUp = false;
    ircProblem = '';
    console.log('IRC-соединение открыто, ожидаю вход в #' + channel);
    publishStatus();
  });

  client.on('roomstate', (joinedChannel) => {
    if (client !== irc) return;
    const joined = String(joinedChannel || '').replace(/^#/, '').toLowerCase();
    if (joined !== channel) return;
    ircUp = true;
    ircProblem = '';
    console.log('IRC вошёл в #' + channel);
    publishStatus();
    if (!joinSettled) { joinSettled = true; resolveJoin(); }
  });

  client.on('notice', (noticeChannel, msgid, message) => {
    if (client !== irc) return;
    const code = String(msgid || '').toLowerCase();
    if (!['no_such_channel', 'msg_channel_suspended', 'msg_room_not_found'].includes(code)) return;
    ircUp = false;
    ircProblem = String(message || 'Twitch не разрешил войти в канал');
    publishStatus();
    if (!joinSettled) { joinSettled = true; rejectJoin(new Error(ircProblem)); }
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

  // tmi.js emits Bits messages via "cheer", not "message".
  client.on('cheer', (chan, tags, message) => {
    if (client !== irc) return;
    const bits = tagNumber(tags && tags.bits);
    const flags = flagsOf(tags);
    if (bits > 0) flags.push(bits + ' битс');
    emitUser(tags, tags && tags.username, parseParts(message || '', tags && tags.emotes), {
      action: tags && tags['message-type'] === 'action',
      flags,
      reply: replyOf(tags),
      cheer: bits
    });
  });

  client.on('newchatter', (chan, username, tags, message) => {
    if (client !== irc) return;
    emitUser(tags, username, parseParts(message || '', tags && tags.emotes), {
      flags: ['новый зритель'].concat(flagsOf(tags)),
      reply: replyOf(tags)
    });
  });

  client.on('ritual', (ritualName, chan, username, tags, message) => {
    if (client !== irc) return;
    emitUser(tags, username, withMessage('событие: ' + String(ritualName || 'ритуал'), message || '', tags && tags.emotes));
  });

  // Keep the overlay consistent with moderation actions in Twitch chat.
  client.on('clearchat', () => {
    if (client === irc) clearMessages();
  });
  client.on('messagedeleted', (chan, username, deletedMessage, tags) => {
    if (client === irc) deleteMessage(tags && (tags['target-msg-id'] || tags.id));
  });
  client.on('ban', (chan, username) => {
    if (client === irc) deleteUserMessages(username);
  });
  client.on('timeout', (chan, username) => {
    if (client === irc) deleteUserMessages(username);
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

  client.on('redeem', (chan, username, rewardType, tags, message) => {
    if (client !== irc) return;
    const label = rewardType === 'highlighted-message'
      ? 'сообщение за баллы'
      : rewardType === 'skip-subs-mode-message'
        ? 'сообщение в режиме «только подписчики»'
        : 'награда за баллы';
    emitUser(tags, username, withMessage(label, message || '', tags && tags.emotes), {
      flags: ['награда'].concat(flagsOf(tags))
    });
  });

  client.on('hosted', (chan, username, viewers, autohost) => {
    if (client !== irc) return;
    const parts = [
      { type: 'text', text: 'хостит канал · ' + viewersLabel(viewers || 0) + (autohost ? ' · автохост' : '') }
    ];
    emitUser({ username, 'display-name': username, 'badges-raw': '' }, username, parts, { flags: ['хост'] });
  });

  client.on('hosting', (chan, target, viewers) => {
    if (client !== irc) return;
    emit({
      displayName: String(chan || channel).replace(/^#/, ''),
      login: String(chan || channel).replace(/^#/, '').toLowerCase(),
      color: defaultColor(chan || channel),
      badges: [], flags: ['хост'], reply: null, action: false,
      parts: [{ type: 'text', text: 'перенаправляет зрителей на ' + String(target || '').replace(/^#/, '') + ' · ' + viewersLabel(viewers || 0) }]
    });
  });

  client.on('unhost', (chan, viewers) => {
    if (client !== irc) return;
    emit({
      displayName: String(chan || channel).replace(/^#/, ''),
      login: String(chan || channel).replace(/^#/, '').toLowerCase(),
      color: defaultColor(chan || channel),
      badges: [], flags: ['хост'], reply: null, action: false,
      parts: [{ type: 'text', text: 'завершил хостинг · ' + viewersLabel(viewers || 0) }]
    });
  });

  client.on('usernotice', (msgid, chan, tags, message) => {
    if (msgid !== 'announcement') return;
    emitUser(tags, '', parseParts(message || '', tags.emotes), {
      flags: ['объявление'].concat(flagsOf(tags))
    });
  });

  return joined;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
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
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      console.log('виджет http://127.0.0.1:' + port);
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
    try { await old.disconnect(); } catch (err) { console.error('Отключение предыдущего канала:', err.message); }
  }
  if (id !== runId) return { superseded: true };

  channel = next;
  ircUp = false;
  ircProblem = '';
  assetProblems = [];
  clearChat();
  ensureRefresh();
  // Third-party emote/badge APIs may be slow or temporarily unavailable.
  // Do not keep the user waiting for them before connecting to Twitch.
  emoteMap = new Map();
  badgeMap = new Map();
  loadAssets().catch((err) => console.error('Загрузка ресурсов:', err));
  if (id !== runId) return { superseded: true };

  const client = new tmi.Client({
    options: { skipUpdatingEmotesets: true },
    connection: { reconnect: true, secure: true },
    channels: [channel]
  });
  if (id !== runId) return { superseded: true };
  irc = client;
  const joined = bindIrc(client);

  try {
    await withTimeout(client.connect(), 25000, 'Не удалось установить соединение с Twitch за 25 секунд');
    await withTimeout(joined, 20000, 'Twitch не подтвердил вход в канал за 20 секунд');
  } catch (err) {
    if (id !== runId) return { superseded: true };
    ircProblem = 'чат не подключился: ' + (err.message || 'неизвестная ошибка');
    console.error(ircProblem);
    if (irc === client) irc = null;
    client.removeAllListeners();
    try { await client.disconnect(); } catch { }
    publishStatus();
    const error = new Error(ircProblem);
    error.url = server.listening ? 'http://127.0.0.1:' + port : '';
    throw error;
  }

  if (id !== runId) return { superseded: true };
  return { url: 'http://127.0.0.1:' + port, channel };
}

function startChannel(name) {
  const next = normalizeChannel(name);
  const id = ++runId;
  return switchChannel(next, id);
}

async function stopChannel() {
  runId += 1;
  loadId += 1;
  abortAssetRequests();
  const old = irc;
  irc = null;
  ircUp = false;
  ircProblem = '';
  if (old) {
    old.removeAllListeners();
    try { await old.disconnect(); } catch (err) { console.error('Отключение IRC:', err.message); }
  }
  clearChat();
}

async function shutdownServer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  for (const socket of wss.clients) {
    try { socket.terminate(); } catch { }
  }
  if (server.listening) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

function hostSettingsPath() {
  return process.env.TWITCHCHAT_SETTINGS_PATH || path.join(__dirname, 'settings.json');
}

function readHostSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(hostSettingsPath(), 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeHostSettings(patch) {
  const file = hostSettingsPath();
  const current = readHostSettings();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temp, file);
  return next;
}

async function handleHostCommand(message) {
  const args = message.args || {};
  switch (message.method) {
    case 'getChannel':
      return String(readHostSettings().channel || '');
    case 'getAppearance':
      return appearance;
    case 'setAppearance': {
      const clean = setAppearance(args.params || {});
      writeHostSettings({ appearance: clean });
      return clean;
    }
    case 'start': {
      try {
        const result = await startChannel(args.channel || '');
        if (result.superseded) return { ok: true, superseded: true };
        return { ok: true, url: result.url, channel: result.channel };
      } catch (error) {
        return {
          ok: false,
          url: error.url || '',
          error: error.code === 'EADDRINUSE' ? 'Порт ' + port + ' уже занят' : (error.message || 'Не удалось подключиться')
        };
      }
    }
    case 'stop':
      await stopChannel();
      return { ok: true };
    case 'shutdown':
      await stopChannel();
      await shutdownServer();
      return { ok: true };
    default:
      throw new Error('Неизвестная команда: ' + String(message.method || ''));
  }
}

function runDesktopHost() {
  const stored = readHostSettings();
  setAppearance(stored.appearance || {});
  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');
  let buffer = '';
  let queue = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let request;
        try {
          request = JSON.parse(line);
          const result = await handleHostCommand(request);
          process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
        } catch (error) {
          process.stdout.write(JSON.stringify({ id: request && request.id, error: error.message || String(error) }) + '\n');
        }
      }).catch((error) => console.error('Desktop host queue:', error));
    }
  });
  process.stdin.on('end', () => {
    queue.then(() => process.exit(0), () => process.exit(1));
  });
}

if (require.main === module) {
  if (hostedMode) {
    runDesktopHost();
  } else {
    const boot = fileConfig.channel ? startChannel(fileConfig.channel) : ensureListening();
    boot.catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
  }
}

module.exports = { startChannel, stopChannel, shutdownServer, port, normalizeChannel, setAppearance };
