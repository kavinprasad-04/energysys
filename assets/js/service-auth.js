/* Shared helpers for the Service tool pages: fetch wrappers, toasts, small utils.
   (No authentication — the Service tool is open.) */
(function (global) {
  'use strict';

  var API = '/api';

  function j(res) {
    return res.text().then(function (t) {
      var data = {};
      try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { error: t || ('HTTP ' + res.status) }; }
      if (!res.ok) {
        var err = new Error(data.error || ('HTTP ' + res.status));
        err.status = res.status; err.data = data;
        throw err;
      }
      return data;
    });
  }

  var Svc = {
    api: API,

    get: function (path) {
      return fetch(API + path, { credentials: 'same-origin' }).then(j);
    },
    postJSON: function (path, body) {
      return fetch(API + path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      }).then(j);
    },
    postForm: function (path, formData, headers) {
      return fetch(API + path, {
        method: 'POST', credentials: 'same-origin',
        headers: headers || {}, body: formData
      }).then(j);
    },

    /** Render the small links bar in the green header. `current`: 'form' | 'list'. */
    mountLinks: function (el, current) {
      if (!el) return;
      el.innerHTML = '';
      var mk = function (href, text) {
        var a = document.createElement('a');
        a.href = href; a.textContent = text;
        return a;
      };
      if (current === 'list') {
        el.appendChild(mk('services.html', '＋ New report'));
      } else {
        el.appendChild(mk('service-reports.html', 'Past reports →'));
      }
    },

    toastHost: function () {
      var h = document.querySelector('.svc-toast-host');
      if (!h) { h = document.createElement('div'); h.className = 'svc-toast-host'; document.body.appendChild(h); }
      return h;
    },

    /** kind: 'ok' | 'err' | 'info'. `html` allowed. Returns the node. */
    toast: function (html, kind, stickyMs) {
      var host = Svc.toastHost();
      var t = document.createElement('div');
      t.className = 'svc-toast';
      t.setAttribute('data-kind', kind || 'info');
      t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
      t.innerHTML = html;
      host.appendChild(t);
      var ms = stickyMs == null ? (kind === 'err' ? 9000 : 6000) : stickyMs;
      if (ms > 0) setTimeout(function () { t.remove(); }, ms);
      return t;
    },

    escapeHtml: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    uuid: function () {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
      return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
  };

  global.Svc = Svc;
})(window);
