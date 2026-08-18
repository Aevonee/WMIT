'use strict';

// Message templates: seeded library (admin-editable in Settings, persisted by
// the server), placeholder rendering against real records, and the shared
// Copy / WhatsApp / Viber action widget used by both workspaces.

(function () {
  var PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

  var SEEDS = [
    { key: 'LEAD_FOLLOWUP_1', label: 'Lead follow-up — thank you (day 1)', body: 'Hi {{first_name}}! This is {{consultant}} from Worldmaster International Travel. Thank you for visiting our booth and sharing your travel plans for {{destination}}{{travel_month}}. I\'m preparing your quotation and will send it within the next few days. Feel free to reply here if you\'d like to add anything!' },
    { key: 'LEAD_FOLLOWUP_NUDGE', label: 'Lead follow-up — nudge (day 3/7)', body: 'Hi {{first_name}}! Just following up on your {{destination}} trip inquiry. Your quotation is ready whenever you are — may I send it over? Reply YES and I\'ll share the details right away.' },
    { key: 'NO_REPLY_CLOSING', label: 'Final attempt before marking lost', body: 'Hi {{first_name}}, I don\'t want to keep messaging you about your {{destination}} trip, so this is my last note — your quotation remains valid for a limited time. If you\'d still like to travel, just reply here and I\'ll pick it right up. Safe travels! — {{consultant}}, Worldmaster International Travel' },
    { key: 'QUOTE_DELIVERY', label: 'Quote delivery', body: 'Hi {{first_name}}! Your {{destination}} travel quotation is ready: {{quote_link}} — it shows your package options with full pricing. It\'s valid until {{valid_until}}. Questions or a preferred option? Reply here and I\'ll take care of the rest. — {{consultant}}' },
    { key: 'QUOTE_FOLLOWUP', label: 'Quote follow-up', body: 'Hi {{first_name}}! Checking in on the {{destination}} quotation we sent ({{quote_link}}). Would you like me to adjust anything — dates, hotel, budget? Happy to revise it for you. — {{consultant}}' },
    { key: 'DEPOSIT_REMINDER', label: 'Deposit reminder', body: 'Hi {{first_name}}! Friendly reminder: the 50% deposit for your {{destination}} trip ({{booking_id}}) of {{deposit}} is due on {{due_date}} to secure your slots and current rates. Payment details are in your quotation. Thank you! — {{consultant}}' },
    { key: 'BALANCE_REMINDER', label: 'Balance reminder', body: 'Hi {{first_name}}! Your {{destination}} trip is approaching — the remaining balance of {{balance}} for booking {{booking_id}} is due on {{due_date}}. Once settled, we\'ll release your final travel documents. Thank you! — {{consultant}}' },
    { key: 'BOOKING_CONFIRMED', label: 'Booking confirmed', body: 'Great news, {{first_name}}! Your {{destination}} trip is confirmed under booking {{booking_id}}. We\'re now arranging your hotels and services with our partners. I\'ll send your finalized itinerary and vouchers before departure. — {{consultant}}, Worldmaster International Travel' },
    { key: 'DOCUMENTS_REQUEST', label: 'Documents request', body: 'Hi {{first_name}}! To process your {{destination}} booking, please send clear photos of your passport (valid 6+ months from return){{extra_documents}}. You can reply here with the photos. Thank you! — {{consultant}}' },
    { key: 'TICKETING_NOTICE', label: 'Ticketing notice', body: 'Hi {{first_name}}! Your flights for {{destination}} have been issued. I\'ll share the e-tickets together with your final documents. Please double-check the name spelling on your booking {{booking_id}} and let me know right away if anything needs correcting. — {{consultant}}' },
    { key: 'FINAL_ITINERARY_SENT', label: 'Final itinerary sent', body: 'Hi {{first_name}}! Your complete travel documents for {{destination}} are ready: day-by-day itinerary, e-tickets, hotel vouchers, and tour confirmations. Please review everything and keep a copy on your phone. We wish you a wonderful trip! — {{consultant}}, Worldmaster International Travel' },
    { key: 'POSTTRIP_THANKYOU', label: 'Post-trip thank you', body: 'Welcome back, {{first_name}}! We hope {{destination}} was everything you hoped for. If you have a moment, we\'d love to hear about your trip — and when you\'re ready to plan the next one, you know where to find me. Safe travels always! — {{consultant}}' }
  ];

  function seedTemplates() { return SEEDS.map(function (seed) { return { key: seed.key, label: seed.label, body: seed.body }; }); }

  window.wmitSeedTemplates = seedTemplates;

  // CSV download shared by both workspaces: BOM so Excel reads UTF-8, and
  // proper quoting for commas, quotes, and newlines in cell values.
  window.wmitDownloadCsv = function (filename, rows) {
    var csv = '\uFEFF' + rows.map(function (row) {
      return row.map(function (cell) {
        var value = String(cell === undefined || cell === null ? '' : cell);
        return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
      }).join(',');
    }).join('\r\n');
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  // Returns { key, label, body } list: server-persisted overrides when they
  // exist, seeds otherwise (union on key, override wins).
  window.wmitMessageTemplates = function (persisted) {
    var byKey = {};
    seedTemplates().forEach(function (seed) { byKey[seed.key] = seed; });
    (persisted || []).forEach(function (override) {
      if (!override || !override.key) return;
      byKey[override.key] = { key: override.key, label: override.label || override.key, body: override.body || '' };
    });
    return Object.keys(byKey).map(function (key) { return byKey[key]; });
  };

  // Renders a template body against a context object. Missing fields collapse
  // gracefully: surrounding punctuation/spaces are cleaned so the sentence
  // stays natural, and the raw {{token}} never reaches the client.
  window.wmitRenderTemplate = function (body, context) {
    var values = context || {};
    return String(body || '').replace(PLACEHOLDER, function (match, name) {
      var value = values[name.toLowerCase()];
      if (value === undefined || value === null || String(value).trim() === '') return '';
      return String(value).trim();
    }).replace(/ +([,.;!?])/g, '$1').replace(/,\s*,/g, ',').replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ');
  };

  // Philippine mobile normalization for deep links: 0917… / +63917… / 63917… → +63917…
  window.wmitE164 = function (mobile) {
    var digits = String(mobile || '').replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    if (digits.length === 11 && digits.startsWith('0')) return '+63' + digits.slice(1);
    if (digits.length === 12 && digits.startsWith('63')) return '+' + digits;
    if (digits.length === 10 && digits.startsWith('9')) return '+63' + digits;
    return digits ? '+' + digits.replace(/^0+/, '') : '';
  };

  window.wmitChatLinks = function (mobile, text) {
    var e164 = window.wmitE164(mobile);
    var encoded = encodeURIComponent(text || '');
    return {
      whatsapp: e164 ? 'https://wa.me/' + e164.slice(1) + (encoded ? '?text=' + encoded : '') : null,
      viber: e164 ? 'viber://chat?number=' + encodeURIComponent(e164) : null
    };
  };

  // Message composer dialog. options: { title, mobile, context, templates,
  // fetchContext } — fetchContext(optional, key) lets a page lazily supply
  // values that cost a server call (e.g. a rotated quote link) only when the
  // chosen template actually references them.
  window.wmitOpenMessageComposer = function (options) {
    var opts = options || {};
    var overlayId = 'wmit-composer-overlay';
    var existing = document.getElementById(overlayId);
    if (existing) existing.remove();

    var templates = opts.templates || [];
    if (!templates.length) {
      if (window.wmitToast) window.wmitToast('error', 'No message templates', 'Ask an admin to configure templates in Settings.');
      return;
    }
    var context = Object.assign({}, opts.context || {});
    var overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', opts.title || 'Send message');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,51,79,.55);z-index:150;display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.addEventListener('click', function (event) { if (event.target === overlay) overlay.remove(); });

    var card = document.createElement('form');
    card.style.cssText = 'background:#fff;color:#172334;border-radius:11px;padding:22px;width:100%;max-width:520px;box-shadow:0 18px 50px rgba(23,35,52,.35);font-family:inherit;display:flex;flex-direction:column;gap:10px;';

    var heading = document.createElement('h3');
    heading.textContent = opts.title || 'Send message';
    heading.style.cssText = 'margin:0;font-size:17px;';
    var recipient = document.createElement('div');
    var e164 = window.wmitE164(opts.mobile);
    recipient.textContent = e164 ? 'To: ' + e164 + (context.first_name ? ' · ' + context.first_name : '') : 'No mobile number on record — copy the text instead.';
    recipient.style.cssText = 'font-size:12.5px;color:#607085;';

    var select = document.createElement('select');
    select.setAttribute('aria-label', 'Message template');
    select.style.cssText = 'padding:10px;border:1px solid #c8d2df;border-radius:6px;font:inherit;background:#fff;';
    templates.forEach(function (template, index) {
      var option = document.createElement('option');
      option.value = String(index);
      option.textContent = template.label;
      select.appendChild(option);
    });

    var textarea = document.createElement('textarea');
    textarea.rows = 7;
    textarea.style.cssText = 'padding:10px;border:1px solid #c8d2df;border-radius:6px;font:inherit;line-height:1.5;resize:vertical;';

    var hint = document.createElement('div');
    hint.style.cssText = 'font-size:11.5px;color:#607085;min-height:15px;';
    hint.textContent = 'Edit freely — what you see is what gets sent.';

    function renderSelected() {
      var template = templates[Number(select.value)];
      if (!template) return;
      var needed = String(template.body).match(PLACEHOLDER) || [];
      var pending = needed.map(function (match) { return match.replace(/[{}\s]/g, ''); }).filter(function (name) {
        var value = context[name.toLowerCase()];
        return value === undefined || value === null || String(value).trim() === '';
      });
      if (pending.length && typeof opts.fetchContext === 'function') {
        hint.textContent = 'Loading details…';
        Promise.resolve(opts.fetchContext(pending)).then(function (fetched) {
          Object.assign(context, fetched || {});
          textarea.value = window.wmitRenderTemplate(template.body, context);
          hint.textContent = 'Edit freely — what you see is what gets sent.';
        }).catch(function () {
          textarea.value = window.wmitRenderTemplate(template.body, context);
          hint.textContent = 'Some details could not be loaded — fill them in manually.';
        });
      } else {
        textarea.value = window.wmitRenderTemplate(template.body, context);
        if (pending.length) hint.textContent = 'Missing: ' + pending.join(', ') + ' — fill them in manually.';
        else hint.textContent = 'Edit freely — what you see is what gets sent.';
      }
    }
    select.addEventListener('change', renderSelected);
    renderSelected();

    var buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
    function actionButton(label, background) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'border:0;border-radius:6px;padding:10px 14px;background:' + background + ';color:#fff;font:inherit;font-weight:700;cursor:pointer;';
      return button;
    }
    var copyButton = actionButton('Copy text', '#34526f');
    var waButton = actionButton('Open WhatsApp', '#177245');
    var viberButton = actionButton('Open Viber', '#553099');
    var closeButton = actionButton('Close', '#56677a');
    if (!e164) { waButton.disabled = true; viberButton.disabled = true; waButton.style.opacity = viberButton.style.opacity = '.5'; waButton.style.cursor = viberButton.style.cursor = 'not-allowed'; }

    var sendNotified = false;
    function notifySent(channel) {
      if (sendNotified) return;
      sendNotified = true;
      if (typeof opts.onSend === 'function') { try { opts.onSend(channel, select.value); } catch (_) { /* logging is best-effort */ } }
    }

    function copyText() {
      var text = textarea.value;
      var done = function () { notifySent('COPY'); if (window.wmitToast) window.wmitToast('ok', 'Message copied', 'Paste it anywhere.'); overlay.remove(); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    }
    function fallbackCopy(text) {
      var scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(scratch);
      scratch.select();
      try { document.execCommand('copy'); } catch (_) { /* clipboard unavailable */ }
      scratch.remove();
    }
    copyButton.addEventListener('click', copyText);
    closeButton.addEventListener('click', function () { overlay.remove(); });
    waButton.addEventListener('click', function () {
      var links = window.wmitChatLinks(opts.mobile, textarea.value);
      if (links.whatsapp) { notifySent('WHATSAPP'); window.open(links.whatsapp, '_blank', 'noopener'); overlay.remove(); }
    });
    viberButton.addEventListener('click', function () {
      var links = window.wmitChatLinks(opts.mobile, textarea.value);
      if (links.viber) { notifySent('VIBER'); window.open(links.viber, '_blank', 'noopener'); }
    });

    card.appendChild(heading);
    card.appendChild(recipient);
    card.appendChild(select);
    card.appendChild(textarea);
    card.appendChild(hint);
    buttons.appendChild(copyButton);
    buttons.appendChild(waButton);
    buttons.appendChild(viberButton);
    buttons.appendChild(closeButton);
    card.appendChild(buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    select.focus();
  };
})();
