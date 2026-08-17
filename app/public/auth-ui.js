'use strict';

// Shared account self-service: the change-password dialog used by both the
// Operations workspace and the Events console. Any page that loads this file
// and renders an element with id "nav-change-password" gets the dialog wired.

(function () {
  var OVERLAY_ID = 'wmit-change-password-overlay';

  function token() { return sessionStorage.getItem('wmit_session'); }

  function close() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function message(text, isError) {
    var target = document.getElementById('wmit-change-password-message');
    if (!target) return;
    target.textContent = text || '';
    target.style.color = isError ? 'var(--msg-err-text, #922c2c)' : 'var(--status-good-text, #176237)';
  }

  function submit(event) {
    event.preventDefault();
    var current = document.getElementById('wmit-cp-current').value;
    var next = document.getElementById('wmit-cp-new').value;
    var confirm2 = document.getElementById('wmit-cp-confirm').value;
    if (!current) return message('Enter your current password.', true);
    if (next.length < 10) return message('The new password must be at least 10 characters.', true);
    if (next !== confirm2) return message('The new passwords do not match.', true);
    if (next === current) return message('The new password must be different from the current one.', true);
    var button = document.getElementById('wmit-cp-submit');
    button.disabled = true;
    message('Changing password…', false);
    fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token() || '') },
      body: JSON.stringify({ current_password: current, new_password: next })
    })
      .then(function (response) { return response.json().then(function (body) { return { status: response.status, body: body }; }); })
      .then(function (result) {
        button.disabled = false;
        if (result.status === 401 && result.body && result.body.error && result.body.error.code === 'UNAUTHORIZED') {
          message('Your sign-in expired — redirecting to the sign-in page.', true);
          setTimeout(function () { window.location.href = 'login.html'; }, 1200);
          return;
        }
        if (!result.body.ok) return message((result.body.error && result.body.error.message) || 'The password could not be changed.', true);
        message('Password changed. Other signed-in devices were signed out.', false);
        ['wmit-cp-current', 'wmit-cp-new', 'wmit-cp-confirm'].forEach(function (id) { document.getElementById(id).value = ''; });
        setTimeout(close, 2200);
      })
      .catch(function () {
        button.disabled = false;
        message('No connection — try again.', true);
      });
  }

  function open() {
    close();
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Change password');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,51,79,.55);z-index:100;display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });

    var card = document.createElement('form');
    card.style.cssText = 'background:#fff;color:#172334;border-radius:11px;padding:24px;width:100%;max-width:380px;box-shadow:0 18px 50px rgba(23,35,52,.35);font-family:inherit;';
    card.innerHTML =
      '<h3 style="margin:0 0 4px;font-size:17px">Change password</h3>' +
      '<p style="margin:0 0 14px;font-size:12.5px;color:#607085">At least 10 characters. Other devices signed in as you will be signed out.</p>' +
      '<label style="display:block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#56677a;margin:10px 0 4px" for="wmit-cp-current">Current password</label>' +
      '<input id="wmit-cp-current" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #c8d2df;border-radius:6px;font:inherit">' +
      '<label style="display:block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#56677a;margin:10px 0 4px" for="wmit-cp-new">New password</label>' +
      '<input id="wmit-cp-new" type="password" autocomplete="new-password" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #c8d2df;border-radius:6px;font:inherit">' +
      '<label style="display:block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#56677a;margin:10px 0 4px" for="wmit-cp-confirm">Repeat new password</label>' +
      '<input id="wmit-cp-confirm" type="password" autocomplete="new-password" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #c8d2df;border-radius:6px;font:inherit">' +
      '<div id="wmit-change-password-message" style="min-height:18px;font-size:12.5px;margin:10px 0 4px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
      '<button type="button" id="wmit-cp-cancel" style="border:0;border-radius:6px;padding:9px 14px;background:#34526f;color:#fff;font:inherit;font-weight:700;cursor:pointer">Cancel</button>' +
      '<button type="submit" id="wmit-cp-submit" style="border:0;border-radius:6px;padding:9px 14px;background:var(--manifest-green,#177245);color:#fff;font:inherit;font-weight:700;cursor:pointer">Change password</button>' +
      '</div>';
    card.addEventListener('submit', submit);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.getElementById('wmit-cp-cancel').addEventListener('click', close);
    document.getElementById('wmit-cp-current').focus();
  }

  window.wmitOpenChangePassword = open;
  var trigger = document.getElementById('nav-change-password');
  if (trigger) trigger.addEventListener('click', open);
})();
