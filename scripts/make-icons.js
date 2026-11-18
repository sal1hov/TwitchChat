const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const offset = row + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smooth(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function roundedRect(px, py, x, y, w, h, r) {
  const cx = clamp(px, x + r, x + w - r);
  const cy = clamp(py, y + r, y + h - r);
  return r - Math.hypot(px - cx, py - cy);
}

function twitchGradient(x, y, size) {
  const t = (x + y) / (2 * (size - 1));
  const stops = t < 0.55 ? [[169, 112, 255], [145, 70, 255]] : [[145, 70, 255], [92, 22, 197]];
  const u = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
  return stops[0].map((channel, index) => Math.round(lerp(channel, stops[1][index], u)));
}

function appIcon(px, py, size) {
  const plate = smooth(roundedRect(px, py, 0, 0, size, size, size * 0.22) + 0.8);
  if (plate <= 0) return [0, 0, 0, 0];
  const [r, g, b] = twitchGradient(px, py, size);
  const right = size * 0.78;
  const lines = [
    [size * 0.30, size * 0.56],
    [size * 0.46, size * 0.42],
    [size * 0.62, size * 0.34]
  ];
  const height = size * 0.075;
  let white = 0;
  for (const [y, w] of lines) {
    white = Math.max(white, smooth(roundedRect(px, py, right - w, y, w, height, height / 2) + 0.8));
  }
  return [
    Math.round(lerp(r, 255, white)),
    Math.round(lerp(g, 255, white)),
    Math.round(lerp(b, 255, white)),
    Math.round(255 * plate)
  ];
}

function bubble(x, y, size) {
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const dx = nx - 0.46;
  const dy = ny - 0.42;
  const circle = dx * dx + dy * dy < 0.16;
  const tail = nx > 0.28 && nx < 0.5 && ny > 0.52 && ny < 0.78 && (ny - 0.52) < (0.5 - nx) * 1.6;
  return circle || tail;
}

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(path.join(dir, 'trayTemplate.png'), png(32, (x, y, size) => {
  return bubble(x, y, size) ? [0, 0, 0, 255] : [0, 0, 0, 0];
}));

fs.writeFileSync(path.join(dir, 'tray.png'), png(32, (x, y, size) => {
  return bubble(x, y, size) ? [61, 255, 138, 255] : [0, 0, 0, 0];
}));

fs.writeFileSync(path.join(dir, 'icon.png'), png(1024, (x, y, size) => {
  return appIcon(x + 0.5, y + 0.5, size);
}));
