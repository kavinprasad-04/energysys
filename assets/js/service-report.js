/* Service / Failure Report form — services.html */
(function () {
  'use strict';

  var form = document.getElementById('report-form');
  if (!form || !window.Svc) return;

  var MAX_IMAGES = 8;
  var MAX_IMAGE_MB = 10;
  var OK_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  var sendBtn = document.getElementById('send-btn');
  var sendHint = document.getElementById('send-hint');
  var idempotencyKey = Svc.uuid();
  var sending = false;
  var sentOk = false;

  // ---- default data (from the spec) ---------------------------------
  var DEFAULT_UNITS = ['3 Units – Completely Dead', '1 Unit – No Audio Output'];
  var DEFAULT_TEAM = [
    { member_name: 'Soundar', role: 'Consultant', mobile: '9940247490', email: 'rd@renso.in', remarks: '' },
    { member_name: 'Saravanan', role: 'PRICOL', mobile: '', email: '', remarks: '' }
  ];

  // ---- image state -------------------------------------------------
  var images = []; // { file, caption, url }

  // =================================================================
  // Boot (no sign-in — the tool is open).
  // Defined here, but CALLED at the very end of this file so that every
  // module-level element reference (unitsWrap, teamBody, …) is assigned first.
  // =================================================================
  function boot() {
    Svc.mountLinks(document.getElementById('userbar'), 'form');

    Svc.get('/health').then(function (d) {
      if (d && d.reportTo) {
        var el = document.getElementById('report-to');
        if (el) el.textContent = d.reportTo;
      }
    }).catch(function () {});

    var eb = form.elements.entered_by;
    var ub = form.elements.updated_by;
    var remembered = '';
    try { remembered = localStorage.getItem('svc.enteredBy') || ''; } catch (e) {}
    eb.value = remembered;
    ub.value = remembered;
    // "Updated By" mirrors "Entered By" (there is no logged-in user).
    eb.addEventListener('input', function () { ub.value = eb.value; });

    buildUnits(DEFAULT_UNITS);
    buildTeam(DEFAULT_TEAM);
    wireImages();
    wireSubjectAuto();
    refreshSubject();
  }

  // =================================================================
  // Affected Units repeater
  // =================================================================
  var unitsWrap = document.getElementById('units-repeater');
  document.getElementById('units-add').addEventListener('click', function () { addUnitRow(''); });

  function buildUnits(list) {
    unitsWrap.innerHTML = '';
    (list && list.length ? list : ['']).forEach(addUnitRow);
  }
  function addUnitRow(value) {
    var row = document.createElement('div');
    row.className = 'repeater__row';
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. 3 Units – Completely Dead';
    input.value = value || '';
    input.setAttribute('aria-label', 'Affected unit / failure line');
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn-icon';
    rm.title = 'Remove line';
    rm.innerHTML = '&times;';
    rm.addEventListener('click', function () {
      row.remove();
      if (!unitsWrap.querySelector('input')) addUnitRow('');
    });
    row.appendChild(input);
    row.appendChild(rm);
    unitsWrap.appendChild(row);
  }
  function readUnits() {
    return Array.prototype.map.call(unitsWrap.querySelectorAll('input'), function (i) { return i.value.trim(); })
      .filter(Boolean);
  }

  // =================================================================
  // Team (D1) table
  // =================================================================
  var teamBody = document.getElementById('team-body');
  document.getElementById('team-add').addEventListener('click', function () {
    addTeamRow({}); teamBody.lastElementChild.querySelector('input').focus();
  });

  function buildTeam(rows) {
    teamBody.innerHTML = '';
    (rows && rows.length ? rows : [{}]).forEach(addTeamRow);
  }
  function addTeamRow(m) {
    m = m || {};
    var tr = document.createElement('tr');
    ['member_name', 'role', 'mobile', 'email', 'remarks'].forEach(function (key) {
      var td = document.createElement('td');
      var input = document.createElement('input');
      input.type = key === 'email' ? 'email' : 'text';
      input.name = key;
      input.value = m[key] || '';
      input.setAttribute('aria-label', key.replace('_', ' '));
      td.appendChild(input);
      tr.appendChild(td);
    });
    var tdx = document.createElement('td');
    tdx.className = 'col-x';
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn-icon';
    rm.title = 'Remove member';
    rm.innerHTML = '&times;';
    rm.addEventListener('click', function () {
      tr.remove();
      if (!teamBody.querySelector('tr')) addTeamRow({});
    });
    tdx.appendChild(rm);
    tr.appendChild(tdx);
    teamBody.appendChild(tr);
  }
  function readTeam() {
    return Array.prototype.map.call(teamBody.querySelectorAll('tr'), function (tr) {
      var v = {};
      Array.prototype.forEach.call(tr.querySelectorAll('input'), function (i) { v[i.name] = i.value.trim(); });
      return v;
    }).filter(function (m) {
      return m.member_name || m.role || m.mobile || m.email || m.remarks;
    });
  }

  // =================================================================
  // Images: pick / drop / preview / caption / remove
  // =================================================================
  function wireImages() {
    var drop = document.getElementById('img-drop');
    var input = document.getElementById('img-input');
    input.addEventListener('change', function () { handleFiles(input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
  }

  function handleFiles(fileList) {
    var errEl = document.getElementById('img-err');
    errEl.textContent = '';
    var files = Array.prototype.slice.call(fileList || []);
    var addable = MAX_IMAGES - images.length;
    if (files.length > addable) {
      errEl.textContent = 'Only ' + MAX_IMAGES + ' images allowed — extra files were ignored.';
      files = files.slice(0, Math.max(0, addable));
    }
    files.forEach(function (file) {
      if (OK_TYPES.indexOf(file.type) === -1) {
        errEl.textContent = '“' + file.name + '” skipped — use JPG, PNG or WEBP.';
        return;
      }
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        errEl.textContent = '“' + file.name + '” skipped — larger than ' + MAX_IMAGE_MB + ' MB.';
        return;
      }
      var entry = { file: file, caption: '', url: URL.createObjectURL(file), processing: true };
      images.push(entry);
      renderImages();
      processImage(file).then(function (out) {
        entry.file = out;
        entry.processing = false;
        renderImages();
      }).catch(function () { entry.processing = false; renderImages(); });
    });
  }

  function processImage(file) {
    return new Promise(function (resolve) {
      if (!('createImageBitmap' in window)) return resolve(file);
      createImageBitmap(file).then(function (bmp) {
        var MAX = 1600;
        var scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
        var reencode = file.size > 1.5 * 1024 * 1024;
        if (scale === 1 && !reencode) { if (bmp.close) bmp.close(); return resolve(file); }
        var w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
        var outType = file.type === 'image/png' ? 'image/png'
          : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          var ext = outType === 'image/png' ? '.png' : outType === 'image/webp' ? '.webp' : '.jpg';
          var base = file.name.replace(/\.(jpe?g|png|webp)$/i, '');
          resolve(new File([blob], base + ext, { type: outType }));
        }, outType, 0.82);
      }).catch(function () { resolve(file); });
    });
  }

  function renderImages() {
    var grid = document.getElementById('img-grid');
    grid.innerHTML = '';
    grid.hidden = images.length === 0;
    images.forEach(function (entry, idx) {
      var tile = document.createElement('div');
      tile.className = 'img-tile';

      var pic = document.createElement('div');
      pic.className = 'img-tile__pic';
      var img = document.createElement('img');
      img.src = entry.url;
      img.alt = entry.caption || ('Evidence image ' + (idx + 1));
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'img-tile__rm';
      rm.title = 'Remove image';
      rm.innerHTML = '&times;';
      rm.addEventListener('click', function () {
        URL.revokeObjectURL(entry.url);
        images.splice(idx, 1);
        renderImages();
      });
      pic.appendChild(img);
      pic.appendChild(rm);

      var cap = document.createElement('input');
      cap.className = 'img-tile__cap';
      cap.placeholder = 'Caption (e.g. Burnt resistor)';
      cap.value = entry.caption;
      cap.setAttribute('aria-label', 'Caption for evidence image ' + (idx + 1));
      cap.addEventListener('input', function () { entry.caption = cap.value; });

      var meta = document.createElement('div');
      meta.className = 'img-tile__meta';
      meta.textContent = entry.processing
        ? 'optimising…'
        : (entry.file.name + ' · ' + Math.max(1, Math.round(entry.file.size / 1024)) + ' KB');

      tile.appendChild(pic);
      tile.appendChild(cap);
      tile.appendChild(meta);
      grid.appendChild(tile);
    });
  }

  // =================================================================
  // Subject auto-generation
  // =================================================================
  var subjectTouched = false;
  function wireSubjectAuto() {
    var subj = form.elements.email_subject;
    subj.addEventListener('input', function () { subjectTouched = true; });
    form.elements.symptom_title.addEventListener('input', refreshSubject);
    form.elements.product.addEventListener('input', refreshSubject);
  }
  function refreshSubject() {
    if (subjectTouched) return;
    var title = form.elements.symptom_title.value.trim();
    var product = form.elements.product.value.trim();
    var parts = ['Service Failure Report'];
    if (title) parts.push(title);
    if (product) parts.push(product);
    form.elements.email_subject.value = parts.join(' – ');
  }

  // =================================================================
  // Validation
  // =================================================================
  var REQUIRED = {
    symptom_title: 'Symptom Title',
    symptom_description: 'Symptom Description',
    symptom_category: 'Symptom Category',
    problem_description: 'Problem Description',
    failure_mode: 'Failure Mode',
    entered_by: 'Entered By'
  };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function clearErrors() {
    form.querySelectorAll('.field[data-error]').forEach(function (f) { f.removeAttribute('data-error'); });
    form.querySelectorAll('.field__err').forEach(function (s) { if (s.id !== 'img-err') s.textContent = ''; });
  }
  function setErr(name, msg) {
    var el = form.elements[name];
    if (!el) return;
    var wrap = el.closest('.field');
    if (wrap) {
      wrap.setAttribute('data-error', 'true');
      var slot = wrap.querySelector('.field__err');
      if (slot) slot.textContent = msg;
    }
  }
  function parseEmails(raw) {
    return String(raw || '').split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function validate() {
    clearErrors();
    var bad = [];
    Object.keys(REQUIRED).forEach(function (name) {
      if (!String(form.elements[name].value || '').trim()) {
        setErr(name, REQUIRED[name] + ' is required.');
        bad.push(REQUIRED[name]);
      }
    });
    var cc = parseEmails(form.elements.cc_emails.value);
    var badCc = cc.filter(function (e) { return !EMAIL_RE.test(e); });
    if (badCc.length) { setErr('cc_emails', 'Invalid CC address: ' + badCc.join(', ')); bad.push('CC Email'); }

    return bad;
  }

  // =================================================================
  // Submit
  // =================================================================
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    if (sentOk) { location.reload(); return; }

    var bad = validate();
    if (bad.length) {
      Svc.toast('Please fix: <strong>' + Svc.escapeHtml(bad.join(', ')) + '</strong>', 'err');
      var firstBad = form.querySelector('.field[data-error]');
      if (firstBad) firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var stillProcessing = images.some(function (i) { return i.processing; });
    if (stillProcessing) {
      Svc.toast('Images are still being optimised — try again in a moment.', 'info', 3000);
      return;
    }

    try { localStorage.setItem('svc.enteredBy', form.elements.entered_by.value.trim()); } catch (err) {}

    var payload = {
      product: form.elements.product.value.trim(),
      symptom_title: form.elements.symptom_title.value.trim(),
      symptom_description: form.elements.symptom_description.value.trim(),
      symptom_category: form.elements.symptom_category.value.trim(),
      affected_units: readUnits(),
      initial_response_date: form.elements.initial_response_date.value,
      era: form.elements.era.value.trim(),
      era_date: form.elements.era_date.value,
      contained_24h: form.elements.contained_24h.value,
      problem_description: form.elements.problem_description.value.trim(),
      failure_mode: form.elements.failure_mode.value.trim(),
      entered_by: form.elements.entered_by.value.trim(),
      updated_by: form.elements.updated_by.value.trim(),
      cc_emails: form.elements.cc_emails.value.trim(),
      email_subject: form.elements.email_subject.value.trim(),
      team: readTeam(),
      imageCaptions: images.map(function (i) { return i.caption || ''; }),
      idempotencyKey: idempotencyKey
    };

    var fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    images.forEach(function (entry) { fd.append('images', entry.file, entry.file.name); });

    setSending(true);
    Svc.postForm('/reports', fd, { 'Idempotency-Key': idempotencyKey })
      .then(function (res) {
        setSending(false);
        if (res.ok) {
          sentOk = true;
          sendBtn.textContent = 'Start another report';
          sendBtn.disabled = false;
          var extra = res.previewUrl
            ? ' &nbsp;<a href="' + Svc.escapeHtml(res.previewUrl) + '" target="_blank" rel="noopener">view test email ↗</a>'
            : '';
          Svc.toast('✅ ' + Svc.escapeHtml(res.message || 'Report sent.') +
            ' &nbsp;Ref <strong>' + Svc.escapeHtml(res.publicId) + '</strong>.' + extra, 'ok', 0);
          sendHint.innerHTML = 'Sent · ref ' + Svc.escapeHtml(res.publicId) +
            ' · <a href="service-reports.html">past reports</a>';
        } else if (res.duplicate) {
          sentOk = true;
          Svc.toast(Svc.escapeHtml(res.message || 'Already submitted.'), 'info', 0);
        } else {
          Svc.toast('⚠️ ' + Svc.escapeHtml(res.error || res.message || 'Could not send.'), 'err', 0);
        }
      })
      .catch(function (err) {
        setSending(false);
        if (err.data && err.data.fields) {
          Object.keys(err.data.fields).forEach(function (k) { setErr(k, err.data.fields[k]); });
        }
        Svc.toast('⚠️ ' + Svc.escapeHtml((err.data && (err.data.error)) || err.message || 'Send failed.'), 'err', 0);
      });
  });

  function setSending(on) {
    sending = on;
    sendBtn.disabled = on;
    if (on) {
      sendBtn.innerHTML = '<span class="spinner"></span> Sending…';
      sendHint.textContent = 'Generating report and sending email…';
    } else if (!sentOk) {
      sendBtn.textContent = 'Send Service Report';
      sendHint.textContent = '';
    }
  }

  // Warn on accidental navigation with unsent images/edits
  window.addEventListener('beforeunload', function (e) {
    if (sending) { e.preventDefault(); e.returnValue = ''; }
  });

  // Everything above is defined — safe to initialise the form now.
  boot();
})();
