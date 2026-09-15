/* EnergySYS — G8D Wind Farm Service Request wizard (service-request.html).
   Step-by-step D1..D8 + Attachments/Review, team-member & corrective-action
   repeaters, multipart submit straight to Formspree (https://formspree.io/f/myeyrqzy).
   No backend involved: no draft save/resume, no PDF report — fill and submit
   the wizard in one sitting. */
(function () {
  "use strict";

  var form = document.getElementById("g8d-form");
  if (!form) return;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var MAX_FILES = 12;
  var MAX_FILE_MB = 25;
  var OK_EXT = [
    "pdf", "jpg", "jpeg", "png", "webp", "gif", "heic",
    "mp4", "mov", "avi", "mkv", "webm",
    "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf",
    "dwg", "dxf", "zip", "7z", "rar"
  ];
  var STEP_COUNT = 9; // 0..7 = D1..D8, 8 = attachments + review

  var tracker = document.getElementById("g8d-tracker");
  var trackerItems = tracker ? Array.prototype.slice.call(tracker.querySelectorAll("li[data-step]")) : [];
  var stepEls = Array.prototype.slice.call(form.querySelectorAll(".g8d-step[data-step]"));
  var backBtn = document.getElementById("g8d-back");
  var nextBtn = document.getElementById("g8d-next");
  var submitBtn = document.getElementById("g8d-submit");
  var submitText = submitBtn && submitBtn.querySelector(".btn--send__text");
  var submitSpin = submitBtn && submitBtn.querySelector(".btn--send__spin");
  var status = form.querySelector(".form-status");

  var teamRows = document.getElementById("g8d-team-rows");
  var teamAdd = document.getElementById("g8d-team-add");
  var caRows = document.getElementById("g8d-ca-rows");
  var caAdd = document.getElementById("g8d-ca-add");
  var reviewEl = document.getElementById("g8d-review");

  var fileInput = document.getElementById("g8d-docs");
  var drop = document.getElementById("g8d-drop");
  var fileList = document.getElementById("g8d-filelist");
  var docsErr = document.getElementById("g8d-docs-err");
  var honeypot = document.getElementById("g8d-website");

  var successPanel = document.getElementById("g8d-success");
  var resDate = document.getElementById("g8d-res-date");
  var resStatus = document.getElementById("g8d-res-status");
  var resDiscipline = document.getElementById("g8d-res-discipline");
  var againBtn = document.getElementById("g8d-again");

  var currentStep = 0;
  var maxStepReached = 0;
  var sending = false;
  var files = [];

  /* ------------------------------------------------------------ helpers --- */
  function setError(el, msg) {
    var wrap = el.closest(".field");
    var slot = wrap ? wrap.querySelector(".field__err") : null;
    if (msg) { if (wrap) wrap.setAttribute("data-error", "true"); if (slot) slot.textContent = msg; }
    else { if (wrap) wrap.removeAttribute("data-error"); if (slot) slot.textContent = ""; }
  }
  function showStatus(state, msg) {
    if (!status) return;
    status.hidden = false;
    status.setAttribute("data-state", state);
    status.innerHTML = msg;
  }
  function hideStatus() { if (status) status.hidden = true; }

  /* ----------------------------------------------------------- wizard ----- */
  function showStep(n) {
    n = Math.max(0, Math.min(STEP_COUNT - 1, n));
    currentStep = n;
    if (n > maxStepReached) maxStepReached = n;
    stepEls.forEach(function (el) {
      var isActive = Number(el.getAttribute("data-step")) === n;
      el.hidden = !isActive;
      el.classList.toggle("is-active", isActive);
    });
    trackerItems.forEach(function (li) {
      var s = Number(li.getAttribute("data-step"));
      li.classList.toggle("is-active", s === n);
      li.classList.toggle("is-done", s < maxStepReached || (s < n));
    });
    backBtn.disabled = n === 0;
    var isLast = n === STEP_COUNT - 1;
    nextBtn.hidden = isLast;
    submitBtn.hidden = !isLast;
    if (isLast) renderReview();
    hideStatus();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function validateStep(n) {
    var stepEl = stepEls[n];
    var bad = [];
    stepEl.querySelectorAll("[required]").forEach(function (el) {
      if (el.closest("[data-row]")) return;
      var val = (el.value || "").trim();
      if (!val) { setError(el, "This field is required."); bad.push(el); }
      else if (el.type === "email" && !EMAIL_RE.test(val)) { setError(el, "Enter a valid email address."); bad.push(el); }
      else setError(el, "");
    });
    return bad;
  }

  nextBtn.addEventListener("click", function () {
    var bad = validateStep(currentStep);
    if (bad.length) {
      showStatus("err", "Please complete the highlighted fields.");
      bad[0].scrollIntoView({ behavior: "smooth", block: "center" });
      try { bad[0].focus({ preventScroll: true }); } catch (_) {}
      return;
    }
    showStep(currentStep + 1);
  });
  backBtn.addEventListener("click", function () { showStep(currentStep - 1); });

  trackerItems.forEach(function (li) {
    li.querySelector("button").addEventListener("click", function () {
      var s = Number(li.getAttribute("data-step"));
      if (s <= maxStepReached) showStep(s);
    });
  });

  /* -------------------------------------------------- repeaters: D1 team -- */
  var teamCount = 0;
  function addTeamRow(data) {
    data = data || {};
    teamCount++;
    var row = document.createElement("div");
    row.className = "g8d-row";
    row.setAttribute("data-row", "");
    row.innerHTML =
      '<div class="g8d-row__title">Team Member #' + teamCount + "</div>" +
      '<button type="button" class="g8d-row__rm" aria-label="Remove this team member">×</button>' +
      '<div class="form-grid">' +
      '<div class="field"><label>Name</label><input type="text" data-field="name" placeholder="Full name"></div>' +
      '<div class="field"><label>Role</label><input type="text" data-field="role" placeholder="e.g. Site Engineer, QA Lead"></div>' +
      "</div>";
    row.querySelector('[data-field="name"]').value = data.name || "";
    row.querySelector('[data-field="role"]').value = data.role || "";
    row.querySelector(".g8d-row__rm").addEventListener("click", function () { row.remove(); });
    teamRows.appendChild(row);
  }
  if (teamAdd) teamAdd.addEventListener("click", function () { addTeamRow(); });

  /* ---------------------------------------------- repeaters: D5 corrective -- */
  var CA_FIELDS = [
    ["corrective_action", "Corrective Action", "textarea", true],
    ["recommended_repair", "Recommended Repair", "text"],
    ["component_replacement", "Component Replacement", "text"],
    ["design_modification", "Design Modification", "text"],
    ["software_update", "Software / Firmware Update", "text"],
    ["maintenance_procedure_change", "Maintenance Procedure Change", "text"],
    ["responsible_person", "Responsible Person", "text"],
    ["target_date", "Target Completion Date", "date"],
    ["spare_parts", "Spare Parts", "text"],
    ["tools_equipment", "Tools / Equipment", "text"]
  ];
  var caCount = 0;
  function addCARow(data) {
    data = data || {};
    caCount++;
    var row = document.createElement("div");
    row.className = "g8d-row";
    row.setAttribute("data-row", "");
    var html = '<div class="g8d-row__title">Corrective Action #' + caCount + "</div>" +
      '<button type="button" class="g8d-row__rm" aria-label="Remove this corrective action">×</button>' +
      '<div class="form-grid">';
    CA_FIELDS.forEach(function (f) {
      var key = f[0], label = f[1], kind = f[2], full = f[3];
      html += '<div class="field' + (full ? " is-full" : "") + '">' +
        "<label>" + label + "</label>" +
        (kind === "textarea"
          ? '<textarea data-field="' + key + '"></textarea>'
          : '<input type="' + kind + '" data-field="' + key + '">') +
        "</div>";
    });
    html += "</div>";
    row.innerHTML = html;
    CA_FIELDS.forEach(function (f) {
      var el = row.querySelector('[data-field="' + f[0] + '"]');
      if (el) el.value = data[f[0]] || "";
    });
    row.querySelector(".g8d-row__rm").addEventListener("click", function () { row.remove(); });
    caRows.appendChild(row);
  }
  if (caAdd) caAdd.addEventListener("click", function () { addCARow(); });

  function collectRows(container) {
    return Array.prototype.slice.call(container.querySelectorAll("[data-row]")).map(function (row) {
      var obj = {};
      row.querySelectorAll("[data-field]").forEach(function (el) { obj[el.getAttribute("data-field")] = (el.value || "").trim(); });
      return obj;
    }).filter(function (obj) {
      return Object.keys(obj).some(function (k) { return obj[k]; });
    });
  }

  /* -------------------------------------------------------- collect data -- */
  function collectStepData(n) {
    var stepEl = stepEls[n];
    var obj = {};
    stepEl.querySelectorAll("[name]").forEach(function (el) {
      if (el.closest("[data-row]")) return;
      obj[el.name] = (el.value || "").trim();
    });
    return obj;
  }
  function gatherAll() {
    var d1 = collectStepData(0); d1.team_members = collectRows(teamRows);
    var d2 = collectStepData(1);
    var d3 = collectStepData(2);
    var d4 = collectStepData(3);
    var d5 = { corrective_actions: collectRows(caRows) };
    var d6 = collectStepData(5);
    var d7 = collectStepData(6);
    var d8 = collectStepData(7);
    return { d1: d1, d2: d2, d3: d3, d4: d4, d5: d5, d6: d6, d7: d7, d8: d8 };
  }

  /* -------------------------------------------------------------- review -- */
  var REVIEW_BLOCKS = [
    ["D1 — Establish the Team", "d1", [
      ["team_leader", "Team Leader"], ["d_team", "D-Team"], ["company_name", "Company Name"],
      ["contact_person", "Contact Person"], ["email", "Email"], ["phone", "Phone"], ["service_engineer", "Service Engineer"]
    ]],
    ["D2 — Describe the Problem", "d2", [
      ["wind_farm_name", "Wind Farm Name"], ["wind_farm_location", "Wind Farm Location"], ["turbine_id", "Turbine ID"],
      ["oem_manufacturer", "OEM / Manufacturer"], ["turbine_model", "Turbine Model"], ["component_system", "Component / System"],
      ["failure_category", "Failure Category"], ["problem_description", "Detailed Problem Description"]
    ]],
    ["D3 — Interim Containment Action", "d3", [
      ["immediate_action", "Immediate Action Taken"], ["turbine_shutdown", "Turbine Shutdown"], ["downtime", "Downtime"], ["safety_risk", "Safety Risk"]
    ]],
    ["D4 — Root Cause Analysis", "d4", [
      ["suspected_root_cause", "Suspected Root Cause"], ["confirmed_root_cause", "Confirmed Root Cause"], ["root_cause_category", "Root Cause Category"]
    ]],
    ["D6 — Implement & Validate", "d6", [
      ["action_implemented", "Corrective Action Implemented"], ["test_result", "Test Result"], ["returned_to_service", "Turbine Returned to Service"]
    ]],
    ["D7 — Prevent Recurrence", "d7", [
      ["preventive_action", "Preventive Action"], ["training_required", "Training Required"]
    ]],
    ["D8 — Closure & Recognition", "d8", [
      ["completion_date", "G8D Completion Date"], ["final_status", "Final Problem Status"], ["customer_approval", "Customer Approval"]
    ]]
  ];
  function renderReview() {
    if (!reviewEl) return;
    var data = gatherAll();
    var html = "";
    REVIEW_BLOCKS.forEach(function (block) {
      var title = block[0], key = block[1], fields = block[2];
      var d = data[key] || {};
      var rows = fields.filter(function (f) { return d[f[0]]; });
      if (!rows.length) return;
      html += '<div class="g8d-review__block"><h4>' + title + "</h4>";
      rows.forEach(function (f) {
        html += "<div><dt>" + f[1] + "</dt><dd>" + escapeHtml(d[f[0]]) + "</dd></div>";
      });
      html += "</div>";
    });
    var teamCountN = collectRows(teamRows).length;
    var caCountN = collectRows(caRows).length;
    if (teamCountN) html += '<div class="g8d-review__block"><div><dt>Team Members</dt><dd>' + teamCountN + " added</dd></div></div>";
    if (caCountN) html += '<div class="g8d-review__block"><div><dt>Corrective Actions</dt><dd>' + caCountN + " added</dd></div></div>";
    if (files.length) html += '<div class="g8d-review__block"><div><dt>Attachments</dt><dd>' + files.length + " file(s) selected</dd></div></div>";
    reviewEl.innerHTML = html || '<div class="g8d-review__block"><div><dt>No details yet</dt><dd>Go back and fill in the disciplines that apply.</dd></div></div>';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* -------------------------------------------------------- file upload --- */
  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function syncInput() {
    try {
      var dt = new DataTransfer();
      files.forEach(function (f) { dt.items.add(f); });
      fileInput.files = dt.files;
    } catch (e) { /* older browsers: input keeps its own last selection */ }
  }
  function renderFileList() {
    fileList.textContent = "";
    if (!files.length) { fileList.hidden = true; return; }
    fileList.hidden = false;
    files.forEach(function (f, i) {
      var li = document.createElement("li");
      li.className = "srq-file";
      var name = document.createElement("span");
      name.className = "srq-file__name";
      name.textContent = f.name;
      var size = document.createElement("span");
      size.className = "srq-file__size";
      size.textContent = fmtSize(f.size);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "srq-file__rm";
      rm.setAttribute("aria-label", "Remove " + f.name);
      rm.textContent = "×";
      rm.addEventListener("click", function () { files.splice(i, 1); syncInput(); renderFileList(); });
      li.appendChild(name); li.appendChild(size); li.appendChild(rm);
      fileList.appendChild(li);
    });
  }
  function addFiles(fileListLike) {
    if (docsErr) docsErr.textContent = "";
    var incoming = Array.prototype.slice.call(fileListLike || []);
    var rejected = [];
    incoming.forEach(function (f) {
      if (files.length >= MAX_FILES) { rejected.push(f.name + " (max " + MAX_FILES + " files)"); return; }
      if (OK_EXT.indexOf(extOf(f.name)) === -1) { rejected.push(f.name + " (type not allowed)"); return; }
      if (f.size > MAX_FILE_MB * 1024 * 1024) { rejected.push(f.name + " (over " + MAX_FILE_MB + " MB)"); return; }
      var dup = files.some(function (x) { return x.name === f.name && x.size === f.size; });
      if (dup) return;
      files.push(f);
    });
    if (rejected.length && docsErr) docsErr.textContent = "Skipped: " + rejected.join(", ") + ".";
    syncInput();
    renderFileList();
  }
  if (fileInput) fileInput.addEventListener("change", function () { addFiles(fileInput.files); });
  if (drop) {
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-drag"); });
    });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
    drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  }

  /* ------------------------------------------------------- Formspree body -- */
  // Flattened, human-readable field labels — Formspree just lists whatever
  // fields it receives in the notification email, so raw JSON blobs would be
  // unreadable there. Field-name dictionary matches the wizard's own inputs.
  var FIELD_LABELS = {
    d1: [
      ["team_leader", "Team Leader"], ["d_team", "D-Team"], ["company_name", "Company Name"],
      ["contact_person", "Contact Person"], ["email", "Email"], ["phone", "Phone"], ["service_engineer", "Service Engineer"]
    ],
    d2: [
      ["wind_farm_name", "Wind Farm Name"], ["wind_farm_location", "Wind Farm Location"], ["turbine_id", "Turbine ID"],
      ["oem_manufacturer", "OEM / Manufacturer"], ["turbine_model", "Turbine Model"], ["serial_number", "Serial Number"],
      ["component_system", "Component / System"], ["failure_date", "Failure Date"], ["units_affected", "Number of Units Affected"],
      ["turbine_status", "Current Turbine Status"], ["failure_category", "Failure Category"], ["fault_error_code", "Fault / Error Code"],
      ["problem_description", "Detailed Problem Description"]
    ],
    d3: [
      ["immediate_action", "Immediate Action Taken"], ["turbine_shutdown", "Turbine Shutdown"], ["temporary_repair", "Temporary Repair"],
      ["temporary_solution", "Temporary Solution"], ["downtime", "Downtime"], ["safety_risk", "Safety Risk"], ["containment_details", "Containment Details"]
    ],
    d4: [
      ["why1", "Why 1"], ["why2", "Why 2"], ["why3", "Why 3"], ["why4", "Why 4"], ["why5", "Why 5"],
      ["suspected_root_cause", "Suspected Root Cause"], ["confirmed_root_cause", "Confirmed Root Cause"],
      ["failure_mechanism", "Failure Mechanism"], ["root_cause_category", "Root Cause Category"]
    ],
    d6: [
      ["action_implemented", "Corrective Action Implemented"], ["implementation_date", "Implementation Date"], ["implemented_by", "Implemented By"],
      ["validation_method", "Validation Method"], ["test_performed", "Test Performed"], ["test_result", "Test Result"],
      ["returned_to_service", "Turbine Returned to Service"], ["performance_after_repair", "Performance After Repair"],
      ["monitoring_period", "Monitoring Period"], ["validation_comments", "Validation Comments"]
    ],
    d7: [
      ["preventive_action", "Preventive Action"], ["maintenance_procedure_updated", "Maintenance Procedure Updated"],
      ["inspection_frequency_changed", "Inspection Frequency Changed"], ["spare_parts_spec_updated", "Spare Parts Specification Updated"],
      ["design_change_required", "Design Change Required"], ["supplier_oem_action", "Supplier / OEM Action"],
      ["training_required", "Training Required"], ["documentation_updated", "Documentation Updated"],
      ["similar_turbines_inspected", "Similar Turbines Inspected"], ["lessons_learned", "Lessons Learned"]
    ],
    d8: [
      ["completion_date", "G8D Completion Date"], ["final_status", "Final Problem Status"], ["final_verification", "Final Verification"],
      ["customer_approval", "Customer Approval"], ["customer_comments", "Customer Comments"],
      ["service_engineer_approval", "Service Engineer Approval"], ["team_leader_approval", "Team Leader Approval"]
    ]
  };
  var DISCIPLINE_TITLES = {
    d1: "D1 — Establish the Team", d2: "D2 — Describe the Problem", d3: "D3 — Interim Containment Action",
    d4: "D4 — Root Cause Analysis", d6: "D6 — Implement & Validate Corrective Action",
    d7: "D7 — Prevent Recurrence", d8: "D8 — Closure & Recognition"
  };

  function buildFormspreeData(data) {
    var fd = new FormData();
    Object.keys(FIELD_LABELS).forEach(function (disc) {
      var title = DISCIPLINE_TITLES[disc];
      var d = data[disc] || {};
      FIELD_LABELS[disc].forEach(function (pair) {
        var val = d[pair[0]];
        if (val) fd.append(title + " — " + pair[1], val);
      });
    });
    (data.d1.team_members || []).forEach(function (m, i) {
      if (m.name || m.role) fd.append("D1 — Team Member " + (i + 1), (m.name || "") + (m.role ? " (" + m.role + ")" : ""));
    });
    (data.d5.corrective_actions || []).forEach(function (a, i) {
      var parts = [];
      CA_FIELDS.forEach(function (f) { if (a[f[0]]) parts.push(f[1] + ": " + a[f[0]]); });
      if (parts.length) fd.append("D5 — Corrective Action " + (i + 1), parts.join(" | "));
    });
    return fd;
  }

  /* ------------------------------------------------------------- submit --- */
  function btnState(s) {
    if (!submitBtn) return;
    if (s === "loading") {
      submitBtn.setAttribute("data-state", "loading");
      submitBtn.disabled = true;
      if (submitText) submitText.textContent = "Submitting…";
      if (submitSpin) submitSpin.hidden = false;
    } else if (s === "success") {
      submitBtn.setAttribute("data-state", "success");
      if (submitText) submitText.textContent = "✓ Submitted";
      if (submitSpin) submitSpin.hidden = true;
    } else {
      submitBtn.removeAttribute("data-state");
      submitBtn.disabled = false;
      if (submitText) submitText.textContent = submitBtn.getAttribute("data-label") || "SUBMIT G8D SERVICE REQUEST";
      if (submitSpin) submitSpin.hidden = true;
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;

    var bad0 = validateStep(0), bad1 = validateStep(1);
    if (bad0.length || bad1.length) {
      showStatus("err", "Please complete the required fields in Team (D1) and Problem (D2).");
      showStep(bad0.length ? 0 : 1);
      var firstBad = (bad0.length ? bad0 : bad1)[0];
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      try { firstBad.focus({ preventScroll: true }); } catch (_) {}
      return;
    }

    var data = gatherAll();
    var fd = buildFormspreeData(data);
    fd.append("email", data.d1.email || ""); // Formspree auto-detects this as Reply-To
    fd.append("_subject", "New G8D Service Request — " + (data.d2.wind_farm_name || "Wind Farm") + (data.d2.turbine_id ? " / " + data.d2.turbine_id : ""));
    fd.append("page", location.pathname + location.search);
    fd.append("_gotcha", (honeypot && honeypot.value) || ""); // Formspree honeypot
    files.forEach(function (f, i) { fd.append("attachment_" + (i + 1), f, f.name); });

    sending = true;
    btnState("loading");
    showStatus("ok", "Submitting your G8D service request…");

    fetch(form.getAttribute("action"), {
      method: "POST",
      body: fd,
      headers: { "Accept": "application/json" }
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; }); })
      .then(function (r) {
        sending = false;
        if (r.res.ok) {
          btnState("success");
          var finalStatus = (data.d8.final_status === "Closed") ? "Closed" : "D8";
          setTimeout(function () {
            form.hidden = true;
            if (tracker) tracker.hidden = true;
            hideStatus();
            if (successPanel) {
              if (resDate) resDate.textContent = new Date().toLocaleString();
              if (resStatus) resStatus.textContent = "Submitted";
              if (resDiscipline) resDiscipline.textContent = finalStatus;
              successPanel.hidden = false;
              successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 650);
        } else {
          btnState("normal");
          var errs = (r.data && r.data.errors) || [];
          var msg = errs.length ? errs.map(function (e) { return e.message; }).join(" ") : "Please try again.";
          showStatus("err", "<strong>Unable to submit.</strong> " + msg);
        }
      })
      .catch(function () {
        sending = false;
        btnState("normal");
        showStatus("err", "Could not reach Formspree. Your answers are still here — please check your connection and try Submit again.");
      });
  });

  if (againBtn) {
    againBtn.addEventListener("click", function () { window.location.href = "service-request.html"; });
  }

  /* -------------------------------------------------------------- init --- */
  addTeamRow();
  addCARow();
  showStep(0);
})();
