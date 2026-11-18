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

fs.writeFileSync(path.join(dir, 'icon.png'), png(512, (x, y, size) => {
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const pad = 0.08;
  const radius = 0.18;
  const inside = nx > pad && nx < 1 - pad && ny > pad && ny < 1 - pad;
  if (!inside) return [0, 0, 0, 0];
  const left = nx < pad + radius && ny < pad + radius;
  const right = nx > 1 - pad - radius && ny < pad + radius;
  const bottomLeft = nx < pad + radius && ny > 1 - pad - radius;
  const bottomRight = nx > 1 - pad - radius && ny > 1 - pad - radius;
  const corner = (cx, cy) => {
    const dx = nx - cx;
    const dy = ny - cy;
    return dx * dx + dy * dy > radius * radius;
  };
  if (left && corner(pad + radius, pad + radius)) return [0, 0, 0, 0];
  if (right && corner(1 - pad - radius, pad + radius)) return [0, 0, 0, 0];
  if (bottomLeft && corner(pad + radius, 1 - pad - radius)) return [0, 0, 0, 0];
  if (bottomRight && corner(1 - pad - radius, 1 - pad - radius)) return [0, 0, 0, 0];
  if (bubble(x, y, size)) return [61, 255, 138, 255];
  return [22, 22, 22, 255];
}));
