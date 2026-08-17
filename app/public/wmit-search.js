'use strict';

// Global search: one header box that finds clients, cases, quotes, bookings,
// suppliers, and expo leads, then jumps straight to the record. Shared by the
// Operations workspace and the Events console via window.wmitSearchResults.

(function () {
  var DEBOUNCE_MS = 120;
  var MAX_RESULTS = 8;

  function closeDropdown(input) {
    var list = document.getElementById('wmit-search-results');
    if (list) list.remove();
    input.setAttribute('aria-expanded', 'false');
    input.dataset.activeIndex = '';
  }

  function ensureDropdown(input) {
    var list = document.getElementById('wmit-search-results');
    if (!list) {
      list = document.createElement('div');
      list.id = 'wmit-search-results';
      list.setAttribute('role', 'listbox');
      list.style.cssText = 'position:fixed;z-index:180;background:#fff;color:#172334;border:1px solid #d9e2ec;border-radius:8px;box-shadow:0 14px 34px rgba(23,35,52,.25);max-height:60vh;overflow:auto;min-width:280px;font-family:inherit;';
      document.body.appendChild(list);
    }
    var rect = input.getBoundingClientRect();
    var top = rect.bottom + 6;
    var maxHeight = window.innerHeight - top - 12;
    list.style.top = top + 'px';
    list.style.left = Math.max(8, rect.right - Math.max(280, rect.width)) + 'px';
    list.style.maxHeight = Math.max(160, maxHeight) + 'px';
    return list;
  }

  function renderResults(input, results, activeIndex) {
    var list = ensureDropdown(input);
    list.innerHTML = '';
    results.forEach(function (result, index) {
      var row = document.createElement('div');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      row.tabIndex = -1;
      row.style.cssText = 'padding:9px 12px;cursor:pointer;display:flex;flex-direction:column;gap:2px;border-bottom:1px solid #e6ebf0;' + (index === activeIndex ? 'background:var(--passage-tint,#f5f9fd);' : '');
      var title = document.createElement('div');
      title.style.cssText = 'font-weight:700;font-size:13.5px;';
      title.textContent = result.title;
      var subtitle = document.createElement('div');
      subtitle.style.cssText = 'font-size:11.5px;color:#607085;';
      subtitle.textContent = (result.kind ? result.kind + ' · ' : '') + (result.subtitle || '');
      row.appendChild(title);
      row.appendChild(subtitle);
      row.addEventListener('mousedown', function (event) { event.preventDefault(); });
      row.addEventListener('click', function () { closeDropdown(input); input.value = ''; result.run(); });
      list.appendChild(row);
    });
    input.setAttribute('aria-expanded', 'true');
  }

  function wire(input, provider) {
    var results = [];
    var activeIndex = -1;
    var timer = null;

    function refresh() {
      var query = input.value.trim();
      if (query.length < 2) { closeDropdown(input); results = []; activeIndex = -1; return; }
      results = provider(query).slice(0, MAX_RESULTS);
      activeIndex = results.length ? 0 : -1;
      if (!results.length) {
        var list = ensureDropdown(input);
        list.innerHTML = '';
        var empty = document.createElement('div');
        empty.style.cssText = 'padding:10px 12px;font-size:12.5px;color:#607085;';
        empty.textContent = 'No matches for “' + query + '”.';
        list.appendChild(empty);
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      renderResults(input, results, activeIndex);
    }

    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, DEBOUNCE_MS);
    });
    input.addEventListener('keydown', function (event) {
      var open = document.getElementById('wmit-search-results');
      if (event.key === 'Escape') { closeDropdown(input); return; }
      if (!open || !results.length) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = (activeIndex + 1) % results.length; renderResults(input, results, activeIndex); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = (activeIndex - 1 + results.length) % results.length; renderResults(input, results, activeIndex); }
      else if (event.key === 'Enter') { event.preventDefault(); var chosen = results[activeIndex]; if (chosen) { closeDropdown(input); input.value = ''; chosen.run(); } }
    });
    input.addEventListener('blur', function () { setTimeout(function () { closeDropdown(input); }, 150); });
  }

  function onReady() {
    var input = document.getElementById('wmit-global-search');
    if (input && typeof window.wmitSearchResults === 'function') wire(input, window.wmitSearchResults);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
