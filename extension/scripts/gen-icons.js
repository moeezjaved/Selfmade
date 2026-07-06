// Generates icon16/48/128.png — a lime rounded square with a dark "S". No deps (raw PNG + zlib).
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const LIME = [223, 254, 149, 255]
const INK = [20, 38, 26, 255]

// 5x7 bitmap for 'S'
const S = [
  '01111',
  '10000',
  '10000',
  '01110',
  '00001',
  '00001',
  '11110',
]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

function png(size) {
  const px = Buffer.alloc(size * size * 4)
  const radius = Math.round(size * 0.22)
  const inCorner = (x, y) => {
    // outside rounded corner?
    const rx = Math.min(x, size - 1 - x), ry = Math.min(y, size - 1 - y)
    if (rx < radius && ry < radius) {
      const dx = radius - rx, dy = radius - ry
      return dx * dx + dy * dy > radius * radius
    }
    return false
  }
  // glyph placement
  const gw = 5, gh = 7
  const scale = Math.floor(size * 0.62 / gh)
  const glyphW = gw * scale, glyphH = gh * scale
  const ox = Math.floor((size - glyphW) / 2), oy = Math.floor((size - glyphH) / 2)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = LIME
      if (inCorner(x, y)) c = [0, 0, 0, 0]
      // glyph
      const gx = Math.floor((x - ox) / scale), gy = Math.floor((y - oy) / scale)
      if (gx >= 0 && gx < gw && gy >= 0 && gy < gh && S[gy][gx] === '1') c = INK
      const i = (y * size + x) * 4
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3]
    }
  }
  // add filter byte (0) per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const dir = path.join(__dirname, '..', 'icons')
fs.mkdirSync(dir, { recursive: true })
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(dir, `icon${s}.png`), png(s))
console.log('icons written to', dir)
