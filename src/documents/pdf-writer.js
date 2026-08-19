'use strict';

// Zero-dependency PDF 1.4 writer for WMIT client documents: A4 pages,
// base-14 fonts with WinAnsiEncoding, flowing text layout with automatic
// pagination and page footers, and a byte-exact xref table computed from
// real Buffer lengths. ASCII-only source; non-ASCII output text is
// produced through the WinAnsi encoder at runtime.

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 64, right: 57, bottom: 60, left: 57 };

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

function createPdfDocument(options) {
  const opts = options || {};
  const generatedAt = (() => {
    const parsed = opts.generatedAt ? new Date(opts.generatedAt) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  })();
  const contentWidth = PAGE.width - MARGIN.left - MARGIN.right;
  const pages = [];
  let cursor = 0;

  const startPage = () => {
    pages.push([]);
    cursor = PAGE.height - MARGIN.top;
  };
  startPage();

  const ensure = (height) => {
    if (cursor - height < MARGIN.bottom) startPage();
  };

  const textOp = (x, yTop, text, fontKey, size, gray) => {
    const color = gray ? '0.45 0.45 0.45 rg\n' : '';
    const head = Buffer.from(color + 'BT\n/' + fontKey + ' ' + fmt(size) + ' Tf\n1 0 0 1 ' + fmt(x) + ' ' + fmt(PAGE.height - yTop) + ' Tm\n(', 'latin1');
    const tail = Buffer.from(') Tj\nET\n', 'latin1');
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
      const size = o.size || 10;
      const leading = size * 1.35;
      const indent = o.indent || 0;
      const lines = wrapText(text, fontKey, size, contentWidth - indent);
      if (lines.length > 1) ensure(2 * leading);
      lines.forEach((line) => {
        ensure(leading);
        textOp(MARGIN.left + indent, cursor, line, fontKey, size);
        cursor -= leading;
      });
      cursor -= o.spaceAfter === undefined ? 5 : o.spaceAfter;
      return doc;
    },

    rule(settings) {
      const o = settings || {};
      const spaceBefore = o.spaceBefore === undefined ? 5 : o.spaceBefore;
      const spaceAfter = o.spaceAfter === undefined ? 8 : o.spaceAfter;
      ensure(spaceBefore + spaceAfter + 2);
      cursor -= spaceBefore;
      pages[pages.length - 1].push(Buffer.from(
        '0.55 0.55 0.55 RG\n' + fmt(0.7) + ' w\n' + fmt(MARGIN.left) + ' ' + fmt(PAGE.height - cursor) + ' m ' + fmt(PAGE.width - MARGIN.right) + ' ' + fmt(PAGE.height - cursor) + ' l S\n',
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

    build() {
      const dateText = generatedAt.toISOString().slice(0, 10);
      const total = pages.length;
      pages.forEach((ops, index) => {
        const footer = 'Page ' + (index + 1) + ' of ' + total + ' - generated ' + dateText;
        ops.push(Buffer.concat([
          Buffer.from('0.45 0.45 0.45 rg\nBT\n/F1 7.5 Tf\n1 0 0 1 ' + fmt(MARGIN.left) + ' ' + fmt(PAGE.height - 32) + ' Tm\n(', 'latin1'),
          escapePdfBytes(encodeWinAnsi('World Master International Travel')),
          Buffer.from(') Tj\nET\n', 'latin1')
        ]));
        const rightText = footer;
        ops.push(Buffer.concat([
          Buffer.from('0.45 0.45 0.45 rg\nBT\n/F1 7.5 Tf\n1 0 0 1 ' + fmt(PAGE.width - MARGIN.right - textWidth(rightText, 'F1', 7.5)) + ' ' + fmt(PAGE.height - 32) + ' Tm\n(', 'latin1'),
          escapePdfBytes(encodeWinAnsi(rightText)),
          Buffer.from(') Tj\nET\n0 0 0 rg\n', 'latin1')
        ]));
      });

      const chunks = [];
      let position = 0;
      const push = (buffer) => { chunks.push(buffer); position += buffer.length; };

      push(Buffer.from('%PDF-1.4\n', 'latin1'));
      push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

      const pageCount = pages.length;
      const firstPageObject = 3;
      const firstContentObject = firstPageObject + pageCount;
      const firstFontObject = firstContentObject + pageCount;
      const objectCount = firstFontObject + FONTS.length - 1;
      const offsets = new Array(objectCount + 1).fill(0);

      const writeObject = (number, bodyBuffer) => {
        offsets[number] = position;
        push(Buffer.concat([Buffer.from(number + ' 0 obj\n', 'latin1'), bodyBuffer, Buffer.from('\nendobj\n', 'latin1')]));
      };

      writeObject(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
      const kids = [];
      for (let i = 0; i < pageCount; i += 1) kids.push((firstPageObject + i) + ' 0 R');
      writeObject(2, Buffer.from('<< /Type /Pages /Count ' + pageCount + ' /Kids [' + kids.join(' ') + '] >>', 'latin1'));

      const fontRefs = FONTS.map((font, index) => '/' + font.key + ' ' + (firstFontObject + index) + ' 0 R').join(' ');
      pages.forEach((ops, index) => {
        writeObject(firstPageObject + index, Buffer.from(
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(PAGE.width) + ' ' + fmt(PAGE.height) + '] /Resources << /Font << ' + fontRefs + ' >> >> /Contents ' + (firstContentObject + index) + ' 0 R >>',
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

      FONTS.forEach((font, index) => {
        writeObject(firstFontObject + index, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /' + font.base + ' /Encoding /WinAnsiEncoding >>', 'latin1'));
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

module.exports = { createPdfDocument, encodeWinAnsi, textWidth, wrapText };
