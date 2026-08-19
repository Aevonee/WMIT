# Document ingestion — staff guide

This guide explains how documents (quotations, invoices, vouchers, tariff
sheets, tickets) enter the WMIT system, what the confidence flags mean, and
how the review loop works. The service behind it lives in
`src/documents/ingestion-service.js` and its tests in
`tests/integration/documents-ingestion.test.js`.

## The pipeline at a glance

Every document moves through the same five stages. A human is always the last
step before anything is linked to a business record.

```
register -> classify -> extract -> review queue -> human review -> match/archive
```

A document record has one of five statuses:

| Status       | Meaning                                                            |
|--------------|--------------------------------------------------------------------|
| RECEIVED     | Registered, nothing analyzed yet                                   |
| CLASSIFIED   | Type recognized with good confidence, waiting for extraction/review |
| NEEDS_REVIEW | The system flagged it: low confidence, ambiguity, or weak extraction |
| MATCHED      | A reviewer approved it and chose the record links                  |
| ARCHIVED     | A reviewer rejected it; it is kept for reference but leaves the queue |

## Paste text or upload a file?

**Paste text (recommended).** Copy the text of an email, quotation, or
voucher and paste it. This always works, everywhere, including on the hosted
server. Pasted text is normalized (line endings and stray control characters
are cleaned) and capped at about 1 MB.

**Upload a file.** Works when the text of the file can be read:

- Plain-text uploads where the caller already read the content work like a
  paste.
- PDF uploads need a text-extraction tool on the server. **On the shared
  webhosting server there is no `pdftotext` and no Python, so PDF extraction
  is unavailable by design.** A PDF upload there fails immediately with
  `EXTRACTION_UNAVAILABLE` and the message *"Paste the document text instead
  of uploading the file."* Nothing is created and nothing is guessed — the
  system never fakes an extraction. Open the PDF, select the text, and paste
  it.

Duplicate protection: the content is hashed (SHA-256). Pasting or uploading
the exact same content twice returns the existing document — you cannot
accidentally create duplicates, even across paste and upload.

File-name safety: path components and unsafe characters are stripped from
uploaded file names before anything is stored.

## Classification and the confidence flag

The classifier recognizes these document types: WMIT quotation, WMIT invoice,
WMIT voucher, supplier quotation, supplier tariff, tour-operator voucher,
tour-operator memo, airline ticket, hotel voucher — plus who issued it
(WMIT, supplier, tour operator, airline, hotel).

`classifyDocument` stores the type, the confidence, and the evidence (which
phrases drove the decision).

- **Confidence 0.8 or higher and no warnings** → status CLASSIFIED. The
  system is sure enough to proceed.
- **Anything lower, or any warning** (unrecognized text, tied competing
  types, unknown source) → status NEEDS_REVIEW. The 0.8 line matches the
  confidence floor WMIT already uses for tariff review.

## Extraction and why almost everything is flagged

`extractDocument` pulls structured fields out of the text — travel dates,
passenger count, client name, amounts, currency, hotel, destination,
inclusions, and so on. Every field is stored with its **own confidence**,
its raw text, and its normalized value.

The extractor is deliberately conservative. A field that crosses a money
line, a fuzzy name, or an inclusions block gets a confidence in the 0.65-0.8
range. Only a fully clean extraction (every field at 0.9+ with no warnings)
is marked `AUTO_ACCEPTABLE`. **Expect most extractions to carry
`review_required: true`** — that is the design, not a fault: extracted values
are untrusted until a person checks them.

## Match suggestions are only suggestions

`matchSuggestions` compares the extracted fields against clients, suppliers,
quotations, bookings, supplier bookings, and invoices and proposes likely
links with a score and evidence. It writes nothing. Until a reviewer chooses
links, the document's `match_links` stay empty — even when the system finds a
perfect-looking match.

## The review loop

1. Open the review queue (`queue()`): every RECEIVED, CLASSIFIED, or
   NEEDS_REVIEW document, worst-first. The queue listing shows status,
   classification summary, and the review flags — never the document text.
2. Open the document, read the text, and check the extracted fields against
   it.
3. Look at the match suggestions, then decide:
   - **APPROVE** (`reviewDocument` with decision `APPROVE`): choose the
     record links you verified (for example, the client the document belongs
     to). The document becomes MATCHED. Only these human-chosen links are
     stored.
   - **REJECT** (decision `REJECT`): the document is ARCHIVED with your note.
     It stays queryable but leaves the queue.
4. Both decisions are final. Replaying the same decision is a harmless
   retry; flipping an approved document back (or rejecting an archived one)
   is refused with `DOCUMENT_STATUS_FINAL`.

Every transition — register, classify, extract, review, and extraction
failures — is written to the audit log with who, when, old status, and new
status. Audit details are metadata only: document text and extracted
personal data never go into log lines.

## Troubleshooting

- **`EXTRACTION_UNAVAILABLE` on upload** — expected for PDFs on the hosted
  webhosting server. Paste the text instead.
- **`TEXT_TOO_LARGE`** — the pasted text exceeds ~1 MB. Register a shorter
  excerpt or split the document.
- **`CLASSIFICATION_REQUIRED` when extracting** — classify first; the
  pipeline order is fixed.
- **`DOCUMENT_STATUS_FINAL`** — the document was already matched or archived.
  If it was archived by mistake, register the content again is NOT needed —
  ask an administrator; review decisions are deliberately one-way.
- **Duplicate keeps coming back as the same document** — that is the content
  hash doing its job; identical content always maps to one record.
