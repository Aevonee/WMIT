'use strict';

// Table extraction for supplier PDFs. Uses Python pdfplumber's
// extract_tables: first the ruling-lines strategy (drawn table borders),
// falling back to a text-alignment strategy for borderless tables. Degrades
// gracefully to "no tables" when Python/pdfplumber is unavailable so the
// caller can continue with plain text extraction.

const { spawnSync } = require('node:child_process');

const PYTHON_TABLE_SCRIPT = [
  'import json, sys',
  'import pdfplumber',
  'sys.stdout.reconfigure(encoding="utf-8")',
  'path = sys.argv[1]',
  'out = {"ok": True, "pages": 0, "tables": [], "warnings": []}',
  'with pdfplumber.open(path) as pdf:',
  '    out["pages"] = len(pdf.pages)',
  '    for page_index, page in enumerate(pdf.pages, start=1):',
  '        tables = []',
  '        try:',
  '            tables = page.extract_tables()',
  '        except Exception:',
  '            tables = []',
  '        if not tables:',
  '            try:',
  '                tables = page.extract_tables({"vertical_strategy": "text", "horizontal_strategy": "text"})',
  '            except Exception:',
  '                tables = []',
  '        for table_index, rows in enumerate(tables, start=1):',
  '            cleaned = [[(None if c is None else str(c).strip()) for c in row] for row in rows]',
  '            if any(any(c for c in row) for row in cleaned):',
  '                out["tables"].append({"page": page_index, "table": table_index, "rows": cleaned})',
  'if not out["tables"]:',
  '    out["warnings"].append("No tables were detected in this PDF.")',
  'print(json.dumps(out, ensure_ascii=False))'
].join('\n');

function extractTablesFromFile(filePath) {
  const result = spawnSync('python', ['-c', PYTHON_TABLE_SCRIPT, filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      tables: [],
      warnings: ['Table extraction requires Python with pdfplumber; it is unavailable in this environment. Only plain-text extraction runs.']
    };
  }
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return { ok: Boolean(parsed.ok), pages: parsed.pages || 0, tables: parsed.tables || [], warnings: parsed.warnings || [] };
  } catch (_) {
    return { ok: false, tables: [], warnings: ['Table extraction returned unreadable output; continuing with plain text.'] };
  }
}

module.exports = { extractTablesFromFile };
