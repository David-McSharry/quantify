#!/usr/bin/env node

/**
 * Generate simple PNG icons for the Quantify extension.
 * Uses only Node.js built-ins (no external dependencies).
 *
 * Creates a simple "chart trending up" icon in blue on transparent background.
 */

const { deflateSync } = require('zlib');
const { writeFileSync } = require('fs');
const path = require('path');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createPng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT - raw pixel data with filter byte per row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];     // R
      rawData[dstIdx + 1] = pixels[srcIdx + 1]; // G
      rawData[dstIdx + 2] = pixels[srcIdx + 2]; // B
      rawData[dstIdx + 3] = pixels[srcIdx + 3]; // A
    }
  }
  const compressed = deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);

  // IEND
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Colors
  const blue = [0, 102, 204, 255];   // #0066CC
  const teal = [0, 180, 180, 255];   // accent

  function setPixel(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    pixels[idx] = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
    pixels[idx + 3] = color[3];
  }

  function fillRect(x1, y1, x2, y2, color) {
    for (let y = Math.max(0, Math.floor(y1)); y <= Math.min(size - 1, Math.floor(y2)); y++) {
      for (let x = Math.max(0, Math.floor(x1)); x <= Math.min(size - 1, Math.floor(x2)); x++) {
        setPixel(x, y, color);
      }
    }
  }

  function drawLine(x1, y1, x2, y2, thickness, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(Math.ceil(len * 2), 1);
    const halfT = thickness / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      fillRect(cx - halfT, cy - halfT, cx + halfT, cy + halfT, color);
    }
  }

  function drawCircle(cx, cy, r, color) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist <= r) {
          setPixel(x, y, color);
        }
      }
    }
  }

  const s = size / 16; // scale factor
  const pad = 2 * s;

  // Draw a chart with upward trend line and bars
  // Background rounded rect (subtle)
  const bgColor = [0, 102, 204, 30];
  fillRect(pad, pad, size - pad, size - pad, bgColor);

  // Bar chart bars (bottom-aligned)
  const barWidth = 1.5 * s;
  const barGap = 1 * s;
  const baseY = size - 3 * s;
  const barX = 3 * s;

  const barHeights = [3, 5, 4, 7, 6, 9]; // relative heights
  const maxH = 9;

  for (let i = 0; i < barHeights.length; i++) {
    const h = (barHeights[i] / maxH) * (size - 7 * s);
    const x = barX + i * (barWidth + barGap);
    const barColor = i < 3 ? [0, 102, 204, 120] : [0, 102, 204, 180];
    fillRect(x, baseY - h, x + barWidth, baseY, barColor);
  }

  // Trend line going up
  const lineThickness = Math.max(1, 1.2 * s);
  const points = [
    [3.5 * s, baseY - (3 / maxH) * (size - 7 * s)],
    [5.5 * s, baseY - (5 / maxH) * (size - 7 * s)],
    [7.5 * s, baseY - (4 / maxH) * (size - 7 * s)],
    [9.5 * s, baseY - (7 / maxH) * (size - 7 * s)],
    [11 * s, baseY - (6 / maxH) * (size - 7 * s)],
    [12.5 * s, baseY - (9 / maxH) * (size - 7 * s)],
  ];

  for (let i = 0; i < points.length - 1; i++) {
    drawLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], lineThickness, blue);
  }

  // Dot at the peak
  const peakR = Math.max(1, 1.5 * s);
  const peak = points[points.length - 1];
  drawCircle(peak[0], peak[1], peakR, teal);

  return pixels;
}

// Generate icons
const iconsDir = path.join(__dirname, '..', 'icons');

for (const size of [16, 48, 128]) {
  const pixels = drawIcon(size);
  const png = createPng(size, size, pixels);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  writeFileSync(filePath, png);
  console.log(`Created ${filePath} (${png.length} bytes)`);
}

console.log('Done.');
