'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const PYTHON_PDFPLUMBER_SCRIPT = [
  'import json, sys',
  'import pdfplumber',
  'sys.stdout.reconfigure(encoding="utf-8")',
  'path = sys.argv[1]',
  'with pdfplumber.open(path) as pdf:',
  '    text = "\\n".join((page.extract_text() or "") for page in pdf.pages)',
  '    print(json.dumps({"text": text, "pages": len(pdf.pages)}, ensure_ascii=False))'
].join('\n');

function extractWithPdftotext(filePath) {
  const result = spawnSync('pdftotext', ['-layout', filePath, '-'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (!result.error && result.status === 0) {
    return { ok: true, parser: 'pdftotext', text: result.stdout || '', warnings: [] };
  }
  return null;
}

function extractWithPdfplumber(filePath) {
  const result = spawnSync('python', ['-c', PYTHON_PDFPLUMBER_SCRIPT, filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return {
      ok: true,
      parser: 'python-pdfplumber',
      pages: parsed.pages || null,
      text: parsed.text || '',
      warnings: []
    };
  } catch (error) {
    return null;
  }
}

function extractTextFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, parser: null, text: '', warnings: ['Reference file was not found.'] };
  }
  if (filePath.toLowerCase().endsWith('.txt')) {
    return { ok: true, parser: 'plain-text', text: fs.readFileSync(filePath, 'utf8'), warnings: [] };
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    return { ok: false, parser: null, text: '', warnings: ['Only PDF and text fixture files are supported by the local adapter.'] };
  }

  const pdftotext = extractWithPdftotext(filePath);
  if (pdftotext) return pdftotext;
  const pdfplumber = extractWithPdfplumber(filePath);
  if (pdfplumber) return pdfplumber;

  return {
    ok: false,
    parser: null,
    text: '',
    warnings: ['PDF text extraction requires pdftotext or the optional Python pdfplumber adapter; neither is available in this environment.']
  };
}

module.exports = { extractTextFromFile };
