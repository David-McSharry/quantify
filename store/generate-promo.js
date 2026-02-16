#!/usr/bin/env node

/**
 * Generate Chrome Web Store promotional images for Quantify.
 * Uses only Node.js built-ins (no external dependencies).
 *
 * Outputs:
 *   store/screenshot-1280x800.png  - Main screenshot/promo image
 *   store/small-tile-440x280.png   - Small promotional tile
 *
 * These are simple branded tiles. For actual screenshots of the
 * extension in action, take a real screenshot on X/Twitter.
 */

const { deflateSync } = require('zlib');
const { writeFileSync } = require('fs');
const { join } = require('path');

const STORE_DIR = __dirname;

// --- PNG encoder (minimal, same approach as generate-icons.js) ---

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = c ^ buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function createPNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Build raw image data with filter byte
  const rowLen = width * 4 + 1;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // no filter
    rgba.copy(raw, y * rowLen + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Drawing helpers ---

function setPixel(buf, width, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= width || y < 0) return;
  const offset = (y * width + x) * 4;
  if (offset + 3 >= buf.length) return;
  if (a < 255 && buf[offset + 3] > 0) {
    // Alpha blend
    const srcA = a / 255;
    const dstA = buf[offset + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    buf[offset] = Math.round((r * srcA + buf[offset] * dstA * (1 - srcA)) / outA);
    buf[offset + 1] = Math.round((g * srcA + buf[offset + 1] * dstA * (1 - srcA)) / outA);
    buf[offset + 2] = Math.round((b * srcA + buf[offset + 2] * dstA * (1 - srcA)) / outA);
    buf[offset + 3] = Math.round(outA * 255);
  } else {
    buf[offset] = r;
    buf[offset + 1] = g;
    buf[offset + 2] = b;
    buf[offset + 3] = a;
  }
}

function fillRect(buf, width, x, y, w, h, r, g, b, a = 255) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(buf, width, x + dx, y + dy, r, g, b, a);
    }
  }
}

function fillRoundedRect(buf, width, x, y, w, h, radius, r, g, b, a = 255) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      // Check if in corner region
      let inCorner = false;
      let cx, cy;
      if (dx < radius && dy < radius) { cx = radius; cy = radius; inCorner = true; }
      else if (dx >= w - radius && dy < radius) { cx = w - radius; cy = radius; inCorner = true; }
      else if (dx < radius && dy >= h - radius) { cx = radius; cy = h - radius; inCorner = true; }
      else if (dx >= w - radius && dy >= h - radius) { cx = w - radius; cy = h - radius; inCorner = true; }

      if (inCorner) {
        const dist = Math.sqrt((dx - cx) ** 2 + (dy - cy) ** 2);
        if (dist > radius) continue;
      }
      setPixel(buf, width, x + dx, y + dy, r, g, b, a);
    }
  }
}

// Bitmap font - simple 5x7 pixel font for uppercase + digits
const FONT = {
  'Q': [
    '01110',
    '10001',
    '10001',
    '10001',
    '10101',
    '10010',
    '01101',
  ],
  'U': [
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110',
  ],
  'A': [
    '01110',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001',
  ],
  'N': [
    '10001',
    '11001',
    '10101',
    '10011',
    '10001',
    '10001',
    '10001',
  ],
  'T': [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
  ],
  'I': [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '11111',
  ],
  'F': [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '10000',
  ],
  'Y': [
    '10001',
    '10001',
    '01010',
    '00100',
    '00100',
    '00100',
    '00100',
  ],
  'P': [
    '11110',
    '10001',
    '10001',
    '11110',
    '10000',
    '10000',
    '10000',
  ],
  'R': [
    '11110',
    '10001',
    '10001',
    '11110',
    '10100',
    '10010',
    '10001',
  ],
  'E': [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '11111',
  ],
  'D': [
    '11100',
    '10010',
    '10001',
    '10001',
    '10001',
    '10010',
    '11100',
  ],
  'C': [
    '01110',
    '10001',
    '10000',
    '10000',
    '10000',
    '10001',
    '01110',
  ],
  'O': [
    '01110',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110',
  ],
  'M': [
    '10001',
    '11011',
    '10101',
    '10101',
    '10001',
    '10001',
    '10001',
  ],
  'K': [
    '10001',
    '10010',
    '10100',
    '11000',
    '10100',
    '10010',
    '10001',
  ],
  'S': [
    '01111',
    '10000',
    '10000',
    '01110',
    '00001',
    '00001',
    '11110',
  ],
  'L': [
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '11111',
  ],
  'H': [
    '10001',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001',
  ],
  'W': [
    '10001',
    '10001',
    '10001',
    '10101',
    '10101',
    '11011',
    '10001',
  ],
  'B': [
    '11110',
    '10001',
    '10001',
    '11110',
    '10001',
    '10001',
    '11110',
  ],
  'G': [
    '01110',
    '10001',
    '10000',
    '10111',
    '10001',
    '10001',
    '01110',
  ],
  'X': [
    '10001',
    '10001',
    '01010',
    '00100',
    '01010',
    '10001',
    '10001',
  ],
  ' ': [
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
  ],
  '/': [
    '00001',
    '00010',
    '00100',
    '00100',
    '01000',
    '10000',
    '10000',
  ],
  '.': [
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '01100',
    '01100',
  ],
  '4': [
    '10001',
    '10001',
    '10001',
    '11111',
    '00001',
    '00001',
    '00001',
  ],
  '%': [
    '11001',
    '11010',
    '00100',
    '00100',
    '01000',
    '01011',
    '10011',
  ],
  '-': [
    '00000',
    '00000',
    '00000',
    '11111',
    '00000',
    '00000',
    '00000',
  ],
};

function drawText(buf, width, text, startX, startY, scale, r, g, b, a = 255) {
  let cursorX = startX;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) { cursorX += 4 * scale; continue; }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          fillRect(buf, width, cursorX + col * scale, startY + row * scale, scale, scale, r, g, b, a);
        }
      }
    }
    cursorX += 6 * scale;
  }
  return cursorX;
}

function measureText(text, scale) {
  return text.length * 6 * scale - scale;
}

// --- Chart drawing (trending up) ---

function drawChart(buf, width, x, y, w, h, lineR, lineG, lineB) {
  // Simple upward trending line with some variation
  const points = [
    0.7, 0.65, 0.72, 0.6, 0.55, 0.58, 0.45, 0.42, 0.48,
    0.35, 0.3, 0.32, 0.25, 0.22, 0.28, 0.18, 0.15, 0.2, 0.12,
  ];

  for (let i = 0; i < points.length - 1; i++) {
    const x1 = x + (i / (points.length - 1)) * w;
    const y1 = y + points[i] * h;
    const x2 = x + ((i + 1) / (points.length - 1)) * w;
    const y2 = y + points[i + 1] * h;

    // Draw thick line between points
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = Math.round(x1 + (x2 - x1) * t);
      const py = Math.round(y1 + (y2 - y1) * t);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setPixel(buf, width, px + dx, py + dy, lineR, lineG, lineB);
        }
      }
    }
  }
}

// --- Generate main screenshot (1280x800) ---

function generateScreenshot() {
  const W = 1280, H = 800;
  const buf = Buffer.alloc(W * H * 4);

  // Background: dark blue-gray
  fillRect(buf, W, 0, 0, W, H, 17, 24, 39);

  // Accent gradient band at top
  for (let y = 0; y < 6; y++) {
    fillRect(buf, W, 0, y, W, 1, 59, 130, 246);
  }

  // Main card
  fillRoundedRect(buf, W, 120, 100, 1040, 600, 16, 30, 41, 59);

  // "Q" logo mark
  fillRoundedRect(buf, W, 180, 160, 80, 80, 12, 59, 130, 246);
  drawText(buf, W, 'Q', 200, 175, 7, 255, 255, 255);

  // Title
  drawText(buf, W, 'QUANTIFY', 290, 175, 7, 255, 255, 255);

  // Subtitle
  drawText(buf, W, 'PREDICTION MARKETS FOR WHAT', 290, 240, 3, 160, 174, 192);
  drawText(buf, W, 'YOU ARE READING', 290, 268, 3, 160, 174, 192);

  // Divider
  fillRect(buf, W, 180, 310, 920, 1, 55, 65, 81);

  // Market examples
  const markets = [
    { title: 'COVID LAB LEAK', platform: 'MANIFOLD', pct: '44%' },
    { title: 'FED RATE CUT', platform: 'POLYMARKET', pct: '67%' },
    { title: 'BITCOIN HITS 200K', platform: 'KALSHI', pct: '23%' },
  ];

  let my = 340;
  for (const m of markets) {
    // Probability pill
    fillRoundedRect(buf, W, 200, my, 90, 40, 8, 59, 130, 246);
    const pctW = measureText(m.pct, 3);
    drawText(buf, W, m.pct, 200 + 45 - Math.round(pctW / 2), my + 10, 3, 255, 255, 255);

    // Market title
    drawText(buf, W, m.title, 310, my + 4, 4, 230, 237, 243);

    // Platform label
    drawText(buf, W, m.platform, 310, my + 32, 2, 107, 114, 128);

    my += 70;
  }

  // Chart in bottom-right area
  drawChart(buf, W, 700, 360, 400, 200, 59, 130, 246);

  // Footer text
  drawText(buf, W, 'BYOK  .  MANIFOLD  .  POLYMARKET  .  KALSHI  .  METACULUS', 240, 630, 2, 107, 114, 128);

  return createPNG(W, H, buf);
}

// --- Generate small tile (440x280) ---

function generateSmallTile() {
  const W = 440, H = 280;
  const buf = Buffer.alloc(W * H * 4);

  // Background
  fillRect(buf, W, 0, 0, W, H, 17, 24, 39);

  // Accent line
  fillRect(buf, W, 0, 0, W, 4, 59, 130, 246);

  // "Q" logo
  fillRoundedRect(buf, W, 40, 50, 56, 56, 10, 59, 130, 246);
  drawText(buf, W, 'Q', 52, 60, 5, 255, 255, 255);

  // Title
  drawText(buf, W, 'QUANTIFY', 115, 60, 5, 255, 255, 255);

  // Subtitle
  drawText(buf, W, 'PREDICTION MARKETS', 115, 98, 2, 160, 174, 192);

  // Mini chart
  drawChart(buf, W, 40, 140, 360, 90, 59, 130, 246);

  // Footer
  drawText(buf, W, 'CHROME EXTENSION', 130, 248, 2, 107, 114, 128);

  return createPNG(W, H, buf);
}

// --- Main ---

const screenshot = generateScreenshot();
writeFileSync(join(STORE_DIR, 'screenshot-1280x800.png'), screenshot);
console.log('Generated store/screenshot-1280x800.png');

const tile = generateSmallTile();
writeFileSync(join(STORE_DIR, 'small-tile-440x280.png'), tile);
console.log('Generated store/small-tile-440x280.png');

console.log('\nDone! You will also want to take a real screenshot of the extension in action on X/Twitter.');
console.log('Recommended: navigate to a tweet, click Q, wait for results, then screenshot the result.');
