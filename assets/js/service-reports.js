/* Past Service Reports — list + detail modal + re-send (service-reports.html) */
(function () {
  'use strict';
  if (!window.Svc) return;

  var body = document.getElementById('reports-body');
  var statusEl = document.getElementById('list-status');

  function fmt(dt) {
    if (!dt) return '—';
    var d = new Date(String(dt).replace(' ', 'T') + 'Z');
    if (isNaN(d)) return String(dt);
    return d.toLocaleString();
  }

  Svc.mountLinks(document.getElementById('userbar'), 'list');
  load();

  function load() {
    Svc.get('/reports').then(function (d) {
      var rows = d.reports || [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--steel)">' +
          'No reports yet. <a href="services.html">Create the first one →</a></td></tr>';
        return;
      }
      body.innerHTML = '';
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        tr.tabIndex = 0;
        tr.innerHTML =
          '<td><strong>' + Svc.escapeHtml(r.public_id) + '</strong></td>' +
          '<td>' + Svc.escapeHtml(r.symptom_title || '—') +
            (r.product ? ' <span style="color:var(--steel)">· ' + Svc.escapeHtml(r.product) + '</span>' : '') + '</td>' +
          '<td>' + Svc.escapeHtml(r.symptom_category || '—') + '</td>' +
          '<td>' + (r.image_count || 0) + '</td>' +
          '<td><span class="badge" data-s="' + Svc.escapeHtml(r.status) + '">' + Svc.escapeHtml(r.status) + '</span></td>' +
          '<td>' + Svc.escapeHtml(r.entered_by || '—') + '</td>' +
          '<td>' + Svc.escapeHtml(fmt(r.created_at)) + '</td>';
        tr.addEventListener('click', function () { openDetail(r.id); });
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') openDetail(r.id); });
        body.appendChild(tr);
      });
    }).catch(function (err) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--orange-deep)">' +
        Svc.escapeHtml(err.message || 'Could not load reports.') + '</td></tr>';
    });
  }

  // ---- detail modal ------------------------------------------------
  function openDetail(id) {
    Svc.get('/reports/' + id).then(function (d) { renderModal(d); });
  }

  function row(dt, dd) {
    return '<dt>' + Svc.escapeHtml(dt) + '</dt><dd>' + (dd || '—') + '</dd>';
  }
  function esc(s) { return Svc.escapeHtml(s == null ? '' : String(s)); }

  function renderModal(d) {
    var r = d.report, team = d.team || [], imgs = d.images || [];
    var units = [];
    try { units = JSON.parse(r.affected_units || '[]'); } catch (e) {}

    var overlay = document.createElement('div');
    overlay.className = 'rd-overlay';

    var teamHtml = team.length
      ? '<div class="svc-table-wrap"><table class="svc-table"><thead><tr>' +
        '<th>Member</th><th>Role</th><th>Mobile</th><th>Email</th><th>Remarks</th></tr></thead><tbody>' +
        team.map(function (m) {
          return '<tr><td>' + esc(m.member_name) + '</td><td>' + esc(m.role) + '</td><td>' +
            esc(m.mobile) + '</td><td>' + esc(m.email) + '</td><td>' + esc(m.remarks) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<p style="color:var(--steel)">No team members.</p>';

    var imgHtml = imgs.length
      ? '<div class="rd-imgs">' + imgs.map(function (im) {
          return '<figure><img src="' + esc(im.url) + '" alt="' + esc(im.caption || 'evidence') + '">' +
            '<figcaption>' + esc(im.caption || im.original_name || '—') + '</figcaption></figure>';
        }).join('') + '</div>'
      : '<p style="color:var(--steel)">No images.</p>';

    overlay.innerHTML =
      '<div class="rd-panel" role="dialog" aria-modal="true" aria-label="Report ' + esc(r.public_id) + '">' +
        '<div class="rd-panel__head">' +
          '<div><h2>' + esc(r.symptom_title) + '</h2>' +
          '<p style="color:var(--steel);font-family:var(--mono);font-size:.75rem;margin-top:4px">' +
            esc(r.public_id) + ' · <span class="badge" data-s="' + esc(r.status) + '">' + esc(r.status) + '</span></p></div>' +
          '<button type="button" aria-label="Close" data-close>&times;</button>' +
        '</div>' +
        '<div class="rd-body">' +
          '<h3>1. Symptom Details</h3><dl>' +
            row('Symptom Title', esc(r.symptom_title)) +
            row('Description', esc(r.symptom_description)) +
            row('Category', esc(r.symptom_category)) +
            row('Product / System', esc(r.product)) +
            row('Affected Units', units.length ? units.map(esc).join('<br>') : '—') +
            row('Initial Response Date', esc(r.initial_response_date)) +
            row('Emergency Response Action', esc(r.era)) +
            row('ERA Date', esc(r.era_date)) +
            row('Contained in 24 Hrs', esc(r.contained_24h)) +
          '</dl>' +
          '<h3>2. Team (D1)</h3>' + teamHtml +
          '<h3>3. Problem Description (D2)</h3><dl>' +
            row('Problem Description', esc(r.problem_description)) +
            row('Failure Mode', esc(r.failure_mode)) +
          '</dl>' +
          '<h3>4. Problem Images / Failure Evidence</h3>' + imgHtml +
          '<h3>Record</h3><dl>' +
            row('Entered By', esc(r.entered_by)) +
            row('Updated By', esc(r.updated_by)) +
            row('Report Created', esc(fmt(r.created_at))) +
            row('Last Updated', esc(fmt(r.updated_at))) +
            row('Last Emailed', esc(fmt(r.last_emailed_at))) +
            row('Subject', esc(r.email_subject)) +
            row('Emailed to', esc(r.recipient_emails || (d.reportTo || ''))) +
            (r.cc_emails ? row('CC', esc(r.cc_emails)) : '') +
            (r.email_error ? row('Last error', '<span style="color:var(--orange-deep)">' + esc(r.email_error) + '</span>') : '') +
          '</dl>' +
          '<div class="rd-resend">' +
            '<div class="field"><label for="rs-cc">CC (optional)</label>' +
              '<input id="rs-cc" value="' + esc(r.cc_emails || '') + '" placeholder="comma or semicolon separated"></div>' +
            '<button type="button" class="btn btn--primary" data-resend>Re-send to ' + esc(d.reportTo || 'recipient') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', onKey);

    overlay.querySelector('[data-resend]').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending…';
      Svc.postJSON('/reports/' + r.id + '/resend', {
        cc_emails: overlay.querySelector('#rs-cc').value
      }).then(function (res) {
        btn.disabled = false; btn.textContent = 'Re-send to ' + (d.reportTo || 'recipient');
        var extra = res.previewUrl ? ' <a href="' + Svc.escapeHtml(res.previewUrl) + '" target="_blank" rel="noopener">view ↗</a>' : '';
        Svc.toast('✅ ' + Svc.escapeHtml(res.message || 'Re-sent.') + extra, 'ok', 0);
        close();
        load();
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'Re-send to ' + (d.reportTo || 'recipient');
        Svc.toast('⚠️ ' + Svc.escapeHtml((err.data && err.data.error) || err.message || 'Send failed.'), 'err', 0);
      });
    });

    document.body.appendChild(overlay);
    overlay.querySelector('[data-close]').focus();
  }
})();
