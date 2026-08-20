'use strict';

// Zero-dependency PDF 1.4 writer for WMIT client documents: A4 pages,
// base-14 fonts with WinAnsiEncoding, flowing text layout with automatic
// pagination and page footers, FlateDecode image XObjects embedded from
// decoded PNGs (Node's built-in zlib only), and a byte-exact xref table
// computed from real Buffer lengths. ASCII-only source; non-ASCII output
// text is produced through the WinAnsi encoder at runtime.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// Geometry mirrored 1:1 from the browser preview paper (.client-doc-paper):
// 794px-wide A4 at 96dpi with 48px side padding and 44px top padding,
// converted px * 0.75 -> pt.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 33, right: 36, bottom: 36, left: 36 };

// Shared presentation tokens mirrored from app/public/styles.css so the
// PDF body matches the on-screen client-document sheet.
const HAIRLINE = [0.863, 0.89, 0.918];
const MUTED_INK = [0.388, 0.44, 0.514];
const BODY_INK = [0.09, 0.137, 0.204];
const BOX_WASH = [0.961, 0.973, 0.984];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// WinAnsi advance widths (units per 1000) for bytes 32..255, from the
// base-14 AFM metrics. Oblique shares the Helvetica table; Courier is
// fixed-pitch at 600.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 556,
  556, 222, 333, 333, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 556, 611, 556,
  222, 222, 333, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 500, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 333, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278,
  278, 722, 722, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 556,
  556, 278, 333, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 556, 611, 556,
  278, 278, 500, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 556, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 333, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 1000, 722, 667, 667, 667, 667, 278, 278, 278,
  278, 722, 722, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556
];

const FONTS = [
  { key: 'F1', base: 'Helvetica', widths: HELVETICA_WIDTHS },
  { key: 'F2', base: 'Helvetica-Bold', widths: HELVETICA_BOLD_WIDTHS },
  { key: 'F3', base: 'Helvetica-Oblique', widths: HELVETICA_WIDTHS },
  { key: 'F4', base: 'Courier', widths: null }
];

// Unicode code points that WinAnsi stores in the 0x80-0x9F range (CP1252).
const WINANSI_SPECIALS = [
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f]
];
const WINANSI_SPECIAL_MAP = new Map(WINANSI_SPECIALS);

// Byte value -> Unicode code point for the WinAnsi (CP1252) encoding used
// by every embedded font: identity for the ASCII and Latin-1 ranges, the
// 0x80-0x9F specials from the table above.
const WINANSI_BYTE_TO_UNICODE = (() => {
  const map = new Array(256).fill(0);
  for (let byte = 0x20; byte <= 0x7e; byte += 1) map[byte] = byte;
  for (let byte = 0xa0; byte <= 0xff; byte += 1) map[byte] = byte;
  WINANSI_SPECIALS.forEach(([code, byte]) => { map[byte] = code; });
  return map;
})();

// Minimal SFNT reader: header, cmap (3,1) format 4 lookup, hmtx advances.
// Only what the PDF embedder needs — widths and vertical metrics.
function parseTtf(ttf) {
  const tag = ttf.readUInt32BE(0);
  if (tag !== 0x00010000 && tag !== 0x74727565) throw new Error('Not a TrueType font.');
  const tableCount = ttf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < tableCount; i += 1) {
    const at = 12 + i * 16;
    tables[ttf.slice(at, at + 4).toString('latin1')] = ttf.readUInt32BE(at + 8);
  }
  if (!tables.head || !tables.hhea || !tables.hmtx || !tables.cmap) throw new Error('Font is missing a required table.');
  const head = ttf.slice(tables.head);
  const unitsPerEm = head.readUInt16BE(18);
  const bbox = [
    head.readInt16BE(36) * 1000 / unitsPerEm,
    head.readInt16BE(38) * 1000 / unitsPerEm,
    head.readInt16BE(40) * 1000 / unitsPerEm,
    head.readInt16BE(42) * 1000 / unitsPerEm
  ];
  const hhea = ttf.slice(tables.hhea);
  const numberOfHMetrics = hhea.readUInt16BE(34);
  const ascent = hhea.readInt16BE(4) * 1000 / unitsPerEm;
  const descent = hhea.readInt16BE(6) * 1000 / unitsPerEm;

  const cmap = ttf.slice(tables.cmap);
  const subtableCount = cmap.readUInt16BE(2);
  let subtableAt = -1;
  for (let i = 0; i < subtableCount; i += 1) {
    const at = 4 + i * 8;
    if (cmap.readUInt16BE(at) === 3 && cmap.readUInt16BE(at + 2) === 1) { subtableAt = cmap.readUInt32BE(at + 4); break; }
  }
  if (subtableAt < 0) throw new Error('Font has no (3,1) cmap subtable.');
  const fmt = cmap.readUInt16BE(subtableAt);
  if (fmt !== 4) throw new Error('Unsupported cmap subtable format ' + fmt + '.');
  const segCount = cmap.readUInt16BE(subtableAt + 6) / 2;
  const endAt = subtableAt + 14;
  const startAt = endAt + segCount * 2 + 2;
  const deltaAt = startAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;
  const glyphFor = (code) => {
    for (let i = 0; i < segCount; i += 1) {
      const end = cmap.readUInt16BE(endAt + i * 2);
      if (code > end) continue;
      const start = cmap.readUInt16BE(startAt + i * 2);
      if (code < start) return 0;
      const delta = cmap.readUInt16BE(deltaAt + i * 2);
      const rangeOffset = cmap.readUInt16BE(rangeAt + i * 2);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const gid = cmap.readUInt16BE(rangeAt + i * 2 + rangeOffset + (code - start) * 2);
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  };
  const advanceFor = (gid) => {
    if (gid >= numberOfHMetrics) gid = numberOfHMetrics - 1;
    return ttf.readUInt16BE(tables.hmtx + gid * 4) * 1000 / unitsPerEm;
  };
  const widths = new Array(256);
  for (let byte = 0; byte < 256; byte += 1) {
    const gid = glyphFor(WINANSI_BYTE_TO_UNICODE[byte]);
    widths[byte] = Math.round(gid ? advanceFor(gid) : 500);
  }
  return { ttf, widths, ascent, descent, bbox };
}

// IBM Plex Sans faces embedded so the PDF text renders in exactly the same
// typeface as the browser preview (styles.css @font-face). Unavailable or
// unsupported fonts fall back to the base-14 Helvetica metrics silently.
const FONT_FILES = {
  regular: path.resolve(__dirname, 'fonts/IBMPlexSans-Regular.ttf'),
  bold: path.resolve(__dirname, 'fonts/IBMPlexSans-Bold.ttf')
};
let embeddedFaces = null;
let facesUnavailable = false;

function loadEmbeddedFaces() {
  if (embeddedFaces || facesUnavailable) return embeddedFaces;
  try {
    embeddedFaces = {
      regular: parseTtf(fs.readFileSync(FONT_FILES.regular)),
      bold: parseTtf(fs.readFileSync(FONT_FILES.bold))
    };
  } catch (error) {
    facesUnavailable = true;
    console.warn('[pdf-writer] embedded fonts unavailable, falling back to Helvetica: ' + String(error && error.message));
  }
  return embeddedFaces;
}

function encodeWinAnsi(text) {
  const bytes = [];
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    const special = WINANSI_SPECIAL_MAP.get(code);
    if (special !== undefined) bytes.push(special);
    else if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else if (code >= 0xa0 && code <= 0xff) bytes.push(code);
    else if (code === 9 || code === 10 || code === 13) bytes.push(0x20);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function escapePdfBytes(bytes) {
  const out = [];
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  return Buffer.from(out);
}

function glyphWidth(fontKey, byte) {
  if (fontKey === 'F4') return 600;
  const table = fontKey === 'F2' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  const index = byte - 32;
  return index >= 0 && index < table.length ? table[index] : 500;
}

function textWidth(text, fontKey, size) {
  let units = 0;
  for (const byte of encodeWinAnsi(text)) units += glyphWidth(fontKey, byte);
  return units * size / 1000;
}

function fmt(number) {
  return String(Number(Number(number).toFixed(2)));
}

function wrapText(text, fontKey, size, maxWidth) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  for (let word of words) {
    while (textWidth(word, fontKey, size) > maxWidth && word.length > 1) {
      let cut = 1;
      while (cut + 1 < word.length && textWidth(word.slice(0, cut + 1), fontKey, size) <= maxWidth) cut += 1;
      if (current) { lines.push(current); current = ''; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = current ? current + ' ' + word : word;
    if (current && textWidth(candidate, fontKey, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// Decodes 8-bit non-interlaced RGB (color type 2) and RGBA (color type 6)
// PNGs. Returns raw device pixels plus a separated alpha plane; the caller
// (pdfImageFromPng) compresses them for embedding. Unsupported variants
// throw with an explicit message so callers can fall back to text branding.
function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG image.');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const idat = [];
  let at = 8;
  while (at + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.slice(at + 4, at + 8).toString('latin1');
    if (at + 12 + length > buffer.length) throw new Error('Truncated PNG chunk: ' + type + '.');
    const data = buffer.slice(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (!width || !height) throw new Error('PNG is missing its IHDR chunk.');
  if (bitDepth !== 8) throw new Error('Unsupported PNG bit depth ' + bitDepth + ' (only 8-bit is supported).');
  if (colorType !== 2 && colorType !== 6) throw new Error('Unsupported PNG color type ' + colorType + ' (only RGB and RGBA are supported).');
  if (interlace !== 0) throw new Error('Interlaced PNG images are not supported.');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error('PNG pixel data length mismatch.');

  const recon = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = y * stride;
    const prior = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[src + x];
      const left = x >= channels ? recon[row + x - channels] : 0;
      const up = y > 0 ? recon[prior + x] : 0;
      const upLeft = y > 0 && x >= channels ? recon[prior + x - channels] : 0;
      let value;
      if (filter === 0) value = byte;
      else if (filter === 1) value = byte + left;
      else if (filter === 2) value = byte + up;
      else if (filter === 3) value = byte + ((left + up) >> 1);
      else if (filter === 4) {
        const predictor = left + up - upLeft;
        const pa = Math.abs(predictor - left);
        const pb = Math.abs(predictor - up);
        const pc = Math.abs(predictor - upLeft);
        value = byte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else {
        throw new Error('Unknown PNG filter ' + filter + ' on row ' + y + '.');
      }
      recon[row + x] = value & 0xff;
    }
    src += stride;
  }

  const count = width * height;
  const rgb = Buffer.alloc(count * 3);
  let alpha = channels === 4 ? Buffer.alloc(count) : null;
  let transparent = false;
  for (let i = 0, p = 0; i < count; i += 1, p += channels) {
    rgb[i * 3] = recon[p];
    rgb[i * 3 + 1] = recon[p + 1];
    rgb[i * 3 + 2] = recon[p + 2];
    if (alpha) {
      alpha[i] = recon[p + 3];
      if (recon[p + 3] !== 0xff) transparent = true;
    }
  }
  if (alpha && !transparent) alpha = null;
  return { width, height, rgb, alpha };
}

// Produces the cached payload for doc.image(): device-RGB pixels and an
// optional grayscale soft mask, both FlateDecode-compressed once here
// instead of on every PDF build.
function pdfImageFromPng(buffer) {
  const decoded = decodePng(buffer);
  return {
    width: decoded.width,
    height: decoded.height,
    rgb: zlib.deflateSync(decoded.rgb, { level: 9 }),
    smask: decoded.alpha ? zlib.deflateSync(decoded.alpha, { level: 9 }) : null
  };
}

function createPdfDocument(options) {
  const opts = options || {};
  const generatedAt = (() => {
    const parsed = opts.generatedAt ? new Date(opts.generatedAt) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  })();
  const faces = loadEmbeddedFaces();
  const contentWidth = PAGE.width - MARGIN.left - MARGIN.right;
  const pages = [];
  const pageImages = [];
  const images = [];
  const imageKeys = new Map();
  let cursor = 0;

  // CSS synthetic oblique uses a 14-degree slant; tan(14deg) ~ 0.2493.
  const SKEW = faces ? 0.2493 : 0;
  const faceFor = (fontKey) => (fontKey === 'F2' ? faces.bold : faces.regular);
  const widthOf = (fontKey, byte) => faces ? faceFor(fontKey).widths[byte] : glyphWidth(fontKey, byte);
  const textWidthD = (text, fontKey, size, spacing) => {
    let units = 0;
    const bytes = encodeWinAnsi(text);
    for (const byte of bytes) units += widthOf(fontKey, byte);
    let width = units * size / 1000;
    if (spacing) width += spacing * bytes.length;
    return width;
  };
  const wrapTextD = (text, fontKey, size, maxWidth, spacing) => {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let current = '';
    for (let word of words) {
      while (textWidthD(word, fontKey, size, spacing) > maxWidth && word.length > 1) {
        let cut = 1;
        while (cut + 1 < word.length && textWidthD(word.slice(0, cut + 1), fontKey, size, spacing) <= maxWidth) cut += 1;
        if (current) { lines.push(current); current = ''; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = current ? current + ' ' + word : word;
      if (current && textWidthD(candidate, fontKey, size, spacing) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  };

  const startPage = () => {
    pages.push([]);
    pageImages.push(new Set());
    cursor = PAGE.height - MARGIN.top;
  };
  startPage();

  const ensure = (height) => {
    if (cursor - height < MARGIN.bottom) startPage();
  };

  const textOp = (x, yTop, text, fontKey, size, color, spacing) => {
    const c = color || [0, 0, 0];
    const tc = (spacing ? fmt(spacing) : '0') + ' Tc\n';
    const skew = fontKey === 'F3' && faces ? '1 0 ' + fmt(SKEW) + ' 1 ' : '1 0 0 1 ';
    const head = Buffer.from(fmt(c[0]) + ' ' + fmt(c[1]) + ' ' + fmt(c[2]) + ' rg\nBT\n/' + fontKey + ' ' + fmt(size) + ' Tf\n' + tc + skew + fmt(x) + ' ' + fmt(yTop) + ' Tm\n(', 'latin1');
    const tail = Buffer.from(') Tj\nET\n0 Tc\n', 'latin1');
    pages[pages.length - 1].push(Buffer.concat([head, escapePdfBytes(encodeWinAnsi(text)), tail]));
  };

  const doc = {
    heading(text, settings) {
      const o = settings || {};
      const size = o.size || 14;
      const leading = size * 1.3;
      const spaceBefore = o.spaceBefore === undefined ? 8 : o.spaceBefore;
      const lines = wrapText(text, 'F2', size, contentWidth);
      ensure(spaceBefore + lines.length * leading + leading);
      cursor -= spaceBefore;
      lines.forEach((line) => {
        textOp(MARGIN.left, cursor, line, 'F2', size);
        cursor -= leading;
      });
      cursor -= o.spaceAfter === undefined ? 4 : o.spaceAfter;
      return doc;
    },

    paragraph(text, settings) {
      const o = settings || {};
      const fontKey = o.bold ? 'F2' : o.italic ? 'F3' : 'F1';
      const size = o.size || 10.5;
      const leading = size * 1.4476;
      const indent = o.indent || 0;
      const color = o.color || BODY_INK;
      const spacing = o.letterSpacing || 0;
      const lines = wrapTextD(text, fontKey, size, contentWidth - indent, spacing);
      if (lines.length > 1) ensure(2 * leading);
      lines.forEach((line) => {
        ensure(leading);
        const x = o.align === 'right'
          ? PAGE.width - MARGIN.right - textWidthD(line, fontKey, size, spacing)
          : MARGIN.left + indent;
        textOp(x, cursor - size, line, fontKey, size, color, spacing);
        cursor -= leading;
      });
      cursor -= o.spaceAfter === undefined ? 5 : o.spaceAfter;
      return doc;
    },

    rule(settings) {
      const o = settings || {};
      const spaceBefore = o.spaceBefore === undefined ? 5 : o.spaceBefore;
      const spaceAfter = o.spaceAfter === undefined ? 8 : o.spaceAfter;
      const c = o.color || [0.55, 0.55, 0.55];
      const width = o.width || 0.7;
      ensure(spaceBefore + spaceAfter + 2);
      cursor -= spaceBefore;
      pages[pages.length - 1].push(Buffer.from(
        fmt(c[0]) + ' ' + fmt(c[1]) + ' ' + fmt(c[2]) + ' RG\n' + fmt(width) + ' w\n' + fmt(MARGIN.left) + ' ' + fmt(cursor) + ' m ' + fmt(PAGE.width - MARGIN.right) + ' ' + fmt(cursor) + ' l S\n',
        'latin1'));
      cursor -= spaceAfter;
      return doc;
    },

    row(label, value, settings) {
      const o = settings || {};
      const size = o.size || 10;
      const fontKey = o.bold ? 'F2' : 'F1';
      const leading = size * 1.35;
      const indent = o.indent || 0;
      const valueLines = wrapText(value === undefined || value === null ? '' : value, fontKey, size, Math.max(120, contentWidth * 0.62));
      ensure(valueLines.length * leading + 2);
      valueLines.forEach((line, index) => {
        if (index === 0 && String(label || '').trim()) {
          textOp(MARGIN.left + indent, cursor, String(label), o.bold ? 'F2' : 'F1', size);
        }
        textOp(PAGE.width - MARGIN.right - textWidth(line, fontKey, size), cursor, line, fontKey, size);
        cursor -= leading;
      });
      cursor -= o.spaceAfter === undefined ? 3 : o.spaceAfter;
      return doc;
    },

    spacer(height) {
      cursor -= Number(height) || 4;
      return doc;
    },

    image(pdfImage, settings) {
      if (!pdfImage || !pdfImage.width || !pdfImage.height || !Buffer.isBuffer(pdfImage.rgb)) {
        throw new Error('image() requires a pdfImageFromPng() result.');
      }
      const o = settings || {};
      const drawWidth = Math.min(o.width || contentWidth, contentWidth);
      const drawHeight = drawWidth * (pdfImage.height / pdfImage.width);
      let key = imageKeys.get(pdfImage);
      if (!key) {
        key = 'Im' + (images.length + 1);
        images.push({ key, image: pdfImage });
        imageKeys.set(pdfImage, key);
      }
      ensure(drawHeight + 2);
      pages[pages.length - 1].push(Buffer.from(
        'q\n' + fmt(drawWidth) + ' 0 0 ' + fmt(drawHeight) + ' ' + fmt(MARGIN.left) + ' ' + fmt(cursor - drawHeight) + ' cm\n/' + key + ' Do\nQ\n',
        'latin1'));
      pageImages[pages.length - 1].add(key);
      cursor -= drawHeight + (o.spaceAfter === undefined ? 6 : o.spaceAfter);
      return doc;
    },

    sectionTitle(text) {
      const size = 12;
      ensure(19.5 + size + 6 + 9);
      cursor -= 19.5;
      textOp(MARGIN.left, cursor - size, String(text), 'F2', size, BODY_INK);
      cursor -= size + 6;
      pages[pages.length - 1].push(Buffer.from(
        fmt(HAIRLINE[0]) + ' ' + fmt(HAIRLINE[1]) + ' ' + fmt(HAIRLINE[2]) + ' RG\n0.75 w\n' + fmt(MARGIN.left) + ' ' + fmt(cursor) + ' m ' + fmt(PAGE.width - MARGIN.right) + ' ' + fmt(cursor) + ' l S\n',
        'latin1'));
      cursor -= 9;
      return doc;
    },

    metaGrid(items, settings) {
      const list = (items || []).filter(Boolean);
      if (!list.length) return doc;
      const perRow = (settings && settings.columns) || 4;
      const gap = 9;
      const pad = 7.5;
      const boxWidth = (contentWidth - gap * (perRow - 1)) / perRow;
      const labelSize = 8.25;
      const labelLeading = 11.4;
      const labelSpacing = 0.4125;
      const valueGap = 3.8;
      const valueSize = 10.5;
      const valueLeading = 15.2;
      for (let start = 0; start < list.length; start += perRow) {
        const rowItems = list.slice(start, start + perRow);
        const wrapped = rowItems.map((item) => ({
          label: wrapTextD(String(item.label || '').toUpperCase(), 'F2', labelSize, boxWidth - pad * 2, labelSpacing),
          lines: wrapTextD(String(item.value || ''), 'F1', valueSize, boxWidth - pad * 2)
        }));
        const valueLines = Math.max(...wrapped.map((item) => item.lines.length));
        const rowHeight = Math.max(43.5, pad * 2 + labelLeading + valueLines * valueLeading);
        ensure(rowHeight + 15);
        rowItems.forEach((item, index) => {
          const x = MARGIN.left + index * (boxWidth + gap);
          pages[pages.length - 1].push(Buffer.from(
            fmt(BOX_WASH[0]) + ' ' + fmt(BOX_WASH[1]) + ' ' + fmt(BOX_WASH[2]) + ' rg\n' + fmt(x) + ' ' + fmt(cursor - rowHeight) + ' ' + fmt(boxWidth) + ' ' + fmt(rowHeight) + ' re f\n',
            'latin1'));
          const spec = wrapped[index];
          textOp(x + pad, cursor - pad - labelSize, spec.label[0], 'F2', labelSize, MUTED_INK);
          spec.lines.forEach((line, lineIndex) => {
            textOp(x + pad, cursor - pad - labelLeading - valueSize - lineIndex * valueLeading, line, 'F1', valueSize, BODY_INK);
          });
        });
        cursor -= rowHeight + 15;
      }
      return doc;
    },

    table(spec) {
      const columns = (spec && spec.columns || []).map((column) => ({
        header: column.header || '',
        fraction: Number(column.width) || 0,
        align: column.align || 'left'
      }));
      if (!columns.length) return doc;
      const fractionTotal = columns.reduce((sum, column) => sum + column.fraction, 0) || 1;
      const colX = [];
      const colW = [];
      let x = MARGIN.left;
      columns.forEach((column) => {
        colX.push(x);
        const width = (column.fraction / fractionTotal) * contentWidth;
        colW.push(width);
        x += width;
      });
      const size = (spec && spec.size) || 10.5;
      const leading = size * 1.4476;
      const pad = 6.75;
      const cellPadX = 6;
      const headerSize = 8.25;
      const headerSpacing = 0.4125;

      const hairline = () => {
        pages[pages.length - 1].push(Buffer.from(
          fmt(HAIRLINE[0]) + ' ' + fmt(HAIRLINE[1]) + ' ' + fmt(HAIRLINE[2]) + ' RG\n0.75 w\n' + fmt(MARGIN.left) + ' ' + fmt(cursor) + ' m ' + fmt(PAGE.width - MARGIN.right) + ' ' + fmt(cursor) + ' l S\n',
          'latin1'));
      };

      const drawHeader = () => {
        const height = pad * 2 + headerSize;
        ensure(height + leading + pad * 2 + 4);
        columns.forEach((column, index) => {
          const label = String(column.header).toUpperCase();
          const width = textWidthD(label, 'F1', headerSize, headerSpacing);
          const cellX = column.align === 'right'
            ? colX[index] + colW[index] - cellPadX - width
            : colX[index] + cellPadX;
          textOp(cellX, cursor - pad - headerSize, label, 'F1', headerSize, MUTED_INK, headerSpacing);
        });
        cursor -= height;
        hairline();
      };

      cursor -= 13.5;
      drawHeader();
      const rows = (spec && spec.rows) || [];
      rows.forEach((row) => {
        const cells = columns.map((column, index) => {
          const cell = row[index];
          const entries = cell && Array.isArray(cell.lines) ? cell.lines : [cell];
          const groups = [];
          entries.forEach((entry) => {
            const text = entry && entry.text !== undefined ? String(entry.text) : String(entry || '');
            const fontKey = entry && entry.bold ? 'F2' : 'F1';
            wrapTextD(text, fontKey, size, Math.max(18, colW[index] - cellPadX * 2)).forEach((line) => {
              groups.push({ line, bold: !!(entry && entry.bold), muted: !!(entry && entry.muted) });
            });
          });
          return groups;
        });
        const lineCount = Math.max(...cells.map((cell) => cell.length));
        const rowHeight = pad * 2 + lineCount * leading;
        const pageBefore = pages.length;
        ensure(rowHeight);
        if (pages.length !== pageBefore) drawHeader();
        cells.forEach((cell, index) => {
          const column = columns[index];
          cell.forEach((group, lineIndex) => {
            const fontKey = group.bold ? 'F2' : 'F1';
            const color = group.muted ? MUTED_INK : BODY_INK;
            const width = textWidthD(group.line, fontKey, size);
            const cellX = column.align === 'right'
              ? colX[index] + colW[index] - cellPadX - width
              : colX[index] + cellPadX;
            textOp(cellX, cursor - pad - size - lineIndex * leading, group.line, fontKey, size, color);
          });
        });
        cursor -= pad * 2 + lineCount * leading;
        hairline();
      });
      cursor -= 10;
      return doc;
    },

    totalsBlock(entries) {
      const list = (entries || []).filter(Boolean);
      if (!list.length) return doc;
      const width = 240;
      const x1 = PAGE.width - MARGIN.right - width;
      const size = 10.5;
      const leading = 15.2;
      const rowPad = 4.5;
      cursor -= 13.5;
      list.forEach((entry) => {
        const label = String(entry.label || '');
        const value = String(entry.value === undefined || entry.value === null ? '' : entry.value);
        if (entry.grand) {
          const grandSize = 13.5;
          ensure(1.5 + 7.5 + grandSize * 1.2 + 10);
          pages[pages.length - 1].push(Buffer.from(
            fmt(0.063) + ' ' + fmt(0.165) + ' ' + fmt(0.263) + ' RG\n1.5 w\n' + fmt(x1) + ' ' + fmt(cursor) + ' m ' + fmt(x1 + width) + ' ' + fmt(cursor) + ' l S\n',
            'latin1'));
          cursor -= 7.5 + grandSize;
          textOp(x1, cursor, label, 'F2', grandSize, [0.043, 0.278, 0.459]);
          const valueWidth = textWidthD(value, 'F2', grandSize);
          textOp(x1 + width - valueWidth, cursor, value, 'F2', grandSize, [0.043, 0.278, 0.459]);
          cursor -= grandSize * 0.45 + 15;
        } else {
          ensure(rowPad * 2 + leading + 8);
          textOp(x1, cursor - rowPad - size, label, 'F1', size, BODY_INK);
          const valueWidth = textWidthD(value, 'F1', size);
          textOp(x1 + width - valueWidth, cursor - rowPad - size, value, 'F1', size, BODY_INK);
          cursor -= rowPad * 2 + leading - 3;
          pages[pages.length - 1].push(Buffer.from(
            fmt(HAIRLINE[0]) + ' ' + fmt(HAIRLINE[1]) + ' ' + fmt(HAIRLINE[2]) + ' RG\n0.75 w\n' + fmt(x1) + ' ' + fmt(cursor) + ' m ' + fmt(x1 + width) + ' ' + fmt(cursor) + ' l S\n',
            'latin1'));
          cursor -= 3;
        }
      });
      cursor -= 15;
      return doc;
    },

    signaturePair(leftTitle, leftCaption, rightCaption) {
      const size = 10.5;
      const captionSize = 9;
      const lineLength = 135;
      ensure(16.5 + 34 + 10);
      cursor -= 16.5;
      if (leftTitle) textOp(MARGIN.left, cursor - size, String(leftTitle), 'F2', size, BODY_INK);
      cursor -= 16.5;
      const lineInk = '0.09 0.137 0.204 RG\n0.75 w\n';
      pages[pages.length - 1].push(Buffer.from(
        lineInk + fmt(MARGIN.left) + ' ' + fmt(cursor) + ' m ' + fmt(MARGIN.left + lineLength) + ' ' + fmt(cursor) + ' l S\n' +
        fmt(PAGE.width - MARGIN.right - lineLength) + ' ' + fmt(cursor) + ' m ' + fmt(PAGE.width - MARGIN.right) + ' ' + fmt(cursor) + ' l S\n',
        'latin1'));
      cursor -= 7.5;
      if (leftCaption) textOp(MARGIN.left, cursor - captionSize, String(leftCaption), 'F1', captionSize, MUTED_INK);
      if (rightCaption) {
        const width = textWidthD(String(rightCaption), 'F1', captionSize);
        textOp(PAGE.width - MARGIN.right - width, cursor - captionSize, String(rightCaption), 'F1', captionSize, MUTED_INK);
      }
      cursor -= captionSize + 8;
      return doc;
    },

    footerBlock(lines) {
      const list = (lines || []).filter(Boolean);
      if (!list.length) return doc;
      const size = 8.25;
      const leading = 12;
      ensure(list.length * leading + 21 + 9 + 10);
      cursor -= 21;
      pages[pages.length - 1].push(Buffer.from(
        fmt(HAIRLINE[0]) + ' ' + fmt(HAIRLINE[1]) + ' ' + fmt(HAIRLINE[2]) + ' RG\n0.75 w\n' + fmt(MARGIN.left) + ' ' + fmt(cursor) + ' m ' + fmt(PAGE.width - MARGIN.right) + ' ' + fmt(cursor) + ' l S\n',
        'latin1'));
      cursor -= 9;
      list.forEach((line, index) => {
        textOp(MARGIN.left, cursor - size - index * leading, String(line), 'F1', size, MUTED_INK);
      });
      cursor -= list.length * leading;
      return doc;
    },

    build() {
      const chunks = [];
      let position = 0;
      const push = (buffer) => { chunks.push(buffer); position += buffer.length; };

      push(Buffer.from('%PDF-1.4\n', 'latin1'));
      push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

      const pageCount = pages.length;
      const firstPageObject = 3;
      const firstContentObject = firstPageObject + pageCount;
      const firstFontObject = firstContentObject + pageCount;

      // Embedded TrueType plan: F1/F3 reference the regular face (F3 is the
      // synthetic-oblique key sharing the same descriptor), F2 the bold face.
      // Each distinct descriptor owns one FontFile2 stream. Without embedded
      // faces the legacy base-14 Helvetica objects are written instead.
      const fontObjects = [];
      const fontRefFor = new Map();
      if (faces) {
        const widthsRegular = faces.regular.widths.slice(32).map(Math.round).join(' ');
        const widthsBold = faces.bold.widths.slice(32).map(Math.round).join(' ');
        const addFont = (key, face, widthsText, descriptorRef) => {
          const number = firstFontObject + fontObjects.length;
          fontObjects.push(() => writeObject(number, Buffer.from(
            '<< /Type /Font /Subtype /TrueType /BaseFont /' + (face === faces.bold ? 'IBMPlexSans-Bold' : 'IBMPlexSans-Regular') +
            ' /FirstChar 32 /LastChar 255 /Widths [' + widthsText + '] /Encoding /WinAnsiEncoding /FontDescriptor ' + descriptorRef + ' 0 R >>',
            'latin1')));
          fontRefFor.set(key, number);
        };
        let descReg = 0;
        let descBold = 0;
        const addDescriptor = (face, name, stemV) => {
          const number = firstFontObject + fontObjects.length;
          const fileNumber = firstFontObject + fontObjects.length + 1;
          const fileStream = zlib.deflateSync(face.ttf, { level: 9 });
          fontObjects.push(() => writeObject(number, Buffer.from(
            '<< /Type /FontDescriptor /FontName /' + name + ' /Flags 32 /FontBBox [' +
            face.bbox.map((value) => fmt(value)).join(' ') + '] /ItalicAngle 0 /Ascent ' + fmt(face.ascent) +
            ' /Descent ' + fmt(face.descent) + ' /CapHeight ' + fmt(face.ascent * 0.7) + ' /StemV ' + stemV +
            ' /FontFile2 ' + fileNumber + ' 0 R >>',
            'latin1')));
          fontObjects.push(() => {
            offsets[fileNumber] = position;
            push(Buffer.concat([
              Buffer.from(fileNumber + ' 0 obj\n<< /Length ' + fileStream.length + ' /Filter /FlateDecode /Length1 ' + face.ttf.length + ' >>\nstream\n', 'latin1'),
              fileStream,
              Buffer.from('\nendstream\nendobj\n', 'latin1')
            ]));
          });
          return number;
        };
        descReg = addDescriptor(faces.regular, 'IBMPlexSans-Regular', 80);
        descBold = addDescriptor(faces.bold, 'IBMPlexSans-Bold', 120);
        addFont('F1', faces.regular, widthsRegular, descReg);
        addFont('F2', faces.bold, widthsBold, descBold);
        addFont('F3', faces.regular, widthsRegular, descReg);
      } else {
        FONTS.forEach((font, index) => {
          const number = firstFontObject + index;
          fontObjects.push(() => writeObject(number, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /' + font.base + ' /Encoding /WinAnsiEncoding >>', 'latin1')));
          fontRefFor.set(font.key, number);
        });
      }

      const usedImages = images.filter((entry) => pageImages.some((set) => set.has(entry.key)));
      const imageNumbers = new Map();
      let nextObject = firstFontObject + fontObjects.length;
      usedImages.forEach((entry) => {
        imageNumbers.set(entry.key, nextObject);
        nextObject += 1;
        if (entry.image.smask) nextObject += 1;
      });
      const objectCount = nextObject - 1;
      const offsets = new Array(objectCount + 1).fill(0);

      const writeObject = (number, bodyBuffer) => {
        offsets[number] = position;
        push(Buffer.concat([Buffer.from(number + ' 0 obj\n', 'latin1'), bodyBuffer, Buffer.from('\nendobj\n', 'latin1')]));
      };

      writeObject(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
      const kids = [];
      for (let i = 0; i < pageCount; i += 1) kids.push((firstPageObject + i) + ' 0 R');
      writeObject(2, Buffer.from('<< /Type /Pages /Count ' + pageCount + ' /Kids [' + kids.join(' ') + '] >>', 'latin1'));

      const fontRefs = Array.from(fontRefFor.entries()).map(([key, number]) => '/' + key + ' ' + number + ' 0 R').join(' ');
      pages.forEach((ops, index) => {
        const imageRefs = [];
        pageImages[index].forEach((key) => {
          imageRefs.push('/' + key + ' ' + imageNumbers.get(key) + ' 0 R');
        });
        const xobjects = imageRefs.length ? ' /XObject << ' + imageRefs.join(' ') + ' >>' : '';
        writeObject(firstPageObject + index, Buffer.from(
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(PAGE.width) + ' ' + fmt(PAGE.height) + '] /Resources << /Font << ' + fontRefs + ' >>' + xobjects + ' >> /Contents ' + (firstContentObject + index) + ' 0 R >>',
          'latin1'));
      });

      pages.forEach((ops, index) => {
        const stream = Buffer.concat(ops);
        offsets[firstContentObject + index] = position;
        push(Buffer.concat([
          Buffer.from((firstContentObject + index) + ' 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n', 'latin1'),
          stream,
          Buffer.from('\nendstream\nendobj\n', 'latin1')
        ]));
      });

      fontObjects.forEach((write) => write());

      const writeImageStream = (number, dict, stream) => {
        offsets[number] = position;
        push(Buffer.concat([
          Buffer.from(number + ' 0 obj\n' + dict + ' /Length ' + stream.length + ' >>\nstream\n', 'latin1'),
          stream,
          Buffer.from('\nendstream\nendobj\n', 'latin1')
        ]));
      };
      usedImages.forEach((entry) => {
        const image = entry.image;
        const number = imageNumbers.get(entry.key);
        const smaskNumber = image.smask ? number + 1 : null;
        writeImageStream(
          number,
          '<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height +
            ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode' +
            (smaskNumber ? ' /SMask ' + smaskNumber + ' 0 R' : ''),
          image.rgb);
        if (smaskNumber) {
          writeImageStream(
            smaskNumber,
            '<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height +
              ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode',
            image.smask);
        }
      });

      const xrefOffset = position;
      let xref = 'xref\n0 ' + (objectCount + 1) + '\n0000000000 65535 f \n';
      for (let i = 1; i <= objectCount; i += 1) {
        xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      }
      push(Buffer.from(xref, 'latin1'));
      push(Buffer.from('trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n', 'latin1'));

      return { pdf: Buffer.concat(chunks, position), pageCount };
    }
  };

  return doc;
}

module.exports = { createPdfDocument, decodePng, pdfImageFromPng, encodeWinAnsi, textWidth, wrapText };
