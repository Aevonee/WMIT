'use strict';

// Upper-right toast notifications shared by the Operations workspace and the
// Events console. Success confirms an action went through; errors and
// warnings surface problems where they cannot be missed.

(function () {
  var CONTAINER_ID = 'wmit-toast-container';
  var MAX_VISIBLE = 4;

  function container() {
    var found = document.getElementById(CONTAINER_ID);
    if (found) return found;
    var created = document.createElement('div');
    created.id = CONTAINER_ID;
    created.setAttribute('role', 'status');
    created.setAttribute('aria-live', 'polite');
    created.style.cssText = 'position:fixed;top:16px;right:16px;z-index:200;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 32px));pointer-events:none;';
    document.body.appendChild(created);
    return created;
  }

  function dismiss(toast) {
    if (!toast.parentNode) return;
    toast.style.transition = 'opacity .25s ease, transform .25s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(12px)';
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 260);
  }

  window.wmitToast = function (kind, title, detail) {
    var root = container();
    while (root.children.length >= MAX_VISIBLE) root.removeChild(root.firstChild);

    var toast = document.createElement('div');
    var isOk = kind === 'ok' || kind === 'success';
    var isError = kind === 'error';
    var isWarn = kind === 'warn' || kind === 'warning';
    var border = isOk ? 'var(--manifest-green,#177245)' : isError ? 'var(--ensign-red,#9b3434)' : 'var(--stamp-amber,#966308)';
    var icon = isOk ? '✓' : isError ? '✕' : '!';
    toast.tabIndex = -1;
    toast.style.cssText = 'pointer-events:auto;cursor:pointer;background:var(--paper,#fff);color:var(--ledger-ink,#172334);border:1px solid var(--rule,#d9e2ec);border-left:4px solid ' + border + ';border-radius:8px;box-shadow:0 10px 28px rgba(23,35,52,.22);padding:12px 14px;display:flex;gap:10px;align-items:flex-start;font-family:inherit;font-size:13.5px;line-height:1.45;';
    var iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.style.cssText = 'flex:none;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#fff;background:' + border + ';margin-top:1px;';
    var textSpan = document.createElement('span');
    textSpan.style.cssText = 'min-width:0;word-wrap:break-word;';
    var titleDiv = document.createElement('div');
    titleDiv.textContent = title || '';
    titleDiv.style.cssText = 'font-weight:800;';
    var detailDiv = document.createElement('div');
    detailDiv.textContent = detail || '';
    detailDiv.style.cssText = 'color:var(--sea-fog,#607085);margin-top:2px;white-space:pre-wrap;';
    textSpan.appendChild(titleDiv);
    if (detail) textSpan.appendChild(detailDiv);
    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    toast.addEventListener('click', function () { dismiss(toast); });
    toast.setAttribute('title', 'Dismiss');
    root.appendChild(toast);
    var lifetime = isOk ? 5000 : 9000;
    setTimeout(function () { dismiss(toast); }, lifetime);
    return toast;
  };
})();
