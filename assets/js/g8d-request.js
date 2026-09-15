/* EnergySYS — G8D Wind Farm Service Request wizard (service-request.html).
   Step-by-step D1..D8 + Review, team-member & corrective-action repeaters,
   multipart submit straight to Formspree (https://formspree.io/f/myeyrqzy).
   No backend involved: no draft save/resume, no file attachments (this
   Formspree plan rejects any submission containing a file). On submit, a
   PDF report is generated client-side (jsPDF) and downloaded to the
   visitor's own device — it is not emailed. */
(function () {
  "use strict";

  var form = document.getElementById("g8d-form");
  if (!form) return;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var STEP_COUNT = 9; // 0..7 = D1..D8, 8 = review

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

  var honeypot = document.getElementById("g8d-website");

  var successPanel = document.getElementById("g8d-success");
  var resDate = document.getElementById("g8d-res-date");
  var resStatus = document.getElementById("g8d-res-status");
  var resDiscipline = document.getElementById("g8d-res-discipline");
  var againBtn = document.getElementById("g8d-again");

  var currentStep = 0;
  var maxStepReached = 0;
  var sending = false;

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
    reviewEl.innerHTML = html || '<div class="g8d-review__block"><div><dt>No details yet</dt><dd>Go back and fill in the disciplines that apply.</dd></div></div>';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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

  /* -------------------------------------------------------- PDF report --- */
  // Built entirely in the browser with jsPDF (no backend) and downloaded to
  // the visitor's own device — this Formspree plan rejects any submission
  // that includes a file, so the PDF cannot be emailed as an attachment.
  // Mirrors the branded report the old server used to generate with pdfkit.
  function buildG8DPdfDoc(data) {
    if (!window.jspdf || !window.jspdf.jsPDF) return null;
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    var M = 40;
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var y = 90;

    function ensureSpace(h) {
      if (y + h > pageH - 40) { doc.addPage(); y = 40; }
    }
    function line(label, value) {
      if (value == null || value === "") return;
      ensureSpace(26);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(94, 107, 98);
      doc.text(String(label).toUpperCase(), M, y); y += 12;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(4, 54, 31);
      var lines = doc.splitTextToSize(String(value), pageW - M * 2);
      lines.forEach(function (l) { ensureSpace(14); doc.text(l, M, y); y += 14; });
      y += 4;
    }
    function sectionHead(idx, title) {
      ensureSpace(30);
      y += 6;
      doc.setFillColor(234, 241, 236); doc.rect(M, y, pageW - M * 2, 20, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(0, 117, 58);
      doc.text(idx + "  —  " + title, M + 6, y + 14);
      y += 30;
      doc.setTextColor(4, 54, 31);
    }

    // header band
    doc.setFillColor(4, 54, 31); doc.rect(0, 0, pageW, 70, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text("EnergySYS", M, 32);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(134, 227, 172);
    doc.text("G8D Wind Farm Service Request Report", M, 50);

    doc.setTextColor(4, 54, 31); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    var d2 = data.d2 || {};
    doc.text((d2.wind_farm_name || "Wind farm") + (d2.turbine_id ? " — " + d2.turbine_id : ""), M, y);
    y += 16;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(94, 107, 98);
    doc.text("Generated " + new Date().toLocaleString(), M, y);
    y += 20;
    doc.setTextColor(4, 54, 31);

    var d1 = data.d1 || {};
    sectionHead("D1", "Establish the Team");
    line("Team Leader", d1.team_leader);
    line("D-Team", d1.d_team);
    if ((d1.team_members || []).length) {
      line("Team Members", d1.team_members.map(function (m) { return (m.name || "") + (m.role ? " (" + m.role + ")" : ""); }).filter(Boolean).join(", "));
    }
    line("Company Name", d1.company_name);
    line("Contact Person", d1.contact_person);
    line("Email", d1.email);
    line("Phone", d1.phone);
    line("Service Engineer", d1.service_engineer);

    sectionHead("D2", "Describe the Problem");
    line("Wind Farm Name", d2.wind_farm_name);
    line("Wind Farm Location", d2.wind_farm_location);
    line("Turbine ID", d2.turbine_id);
    line("OEM / Manufacturer", d2.oem_manufacturer);
    line("Turbine Model", d2.turbine_model);
    line("Serial Number", d2.serial_number);
    line("Component / System", d2.component_system);
    line("Failure Date", d2.failure_date);
    line("Number of Units Affected", d2.units_affected);
    line("Current Turbine Status", d2.turbine_status);
    line("Failure Category", d2.failure_category);
    line("Fault / Error Code", d2.fault_error_code);
    line("Detailed Problem Description", d2.problem_description);

    var d3 = data.d3 || {};
    sectionHead("D3", "Interim Containment Action");
    line("Immediate Action Taken", d3.immediate_action);
    line("Turbine Shutdown", d3.turbine_shutdown);
    line("Temporary Repair", d3.temporary_repair);
    line("Temporary Solution", d3.temporary_solution);
    line("Downtime", d3.downtime);
    line("Safety Risk", d3.safety_risk);
    line("Containment Details", d3.containment_details);

    var d4 = data.d4 || {};
    sectionHead("D4", "Root Cause Analysis");
    [1, 2, 3, 4, 5].forEach(function (n) { line("Why " + n, d4["why" + n]); });
    line("Suspected Root Cause", d4.suspected_root_cause);
    line("Confirmed Root Cause", d4.confirmed_root_cause);
    line("Failure Mechanism", d4.failure_mechanism);
    line("Root Cause Category", d4.root_cause_category);

    sectionHead("D5", "Permanent Corrective Action");
    var actions = (data.d5 && data.d5.corrective_actions) || [];
    if (!actions.length) {
      ensureSpace(16);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(94, 107, 98);
      doc.text("No corrective actions recorded yet.", M, y); y += 18;
      doc.setTextColor(4, 54, 31);
    }
    actions.forEach(function (a, i) {
      ensureSpace(16);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0, 117, 58);
      doc.text("Action " + (i + 1), M, y); y += 14;
      doc.setTextColor(4, 54, 31);
      CA_FIELDS.forEach(function (f) { line(f[1], a[f[0]]); });
    });

    var d6 = data.d6 || {};
    sectionHead("D6", "Implement & Validate Corrective Action");
    line("Corrective Action Implemented", d6.action_implemented);
    line("Implementation Date", d6.implementation_date);
    line("Implemented By", d6.implemented_by);
    line("Validation Method", d6.validation_method);
    line("Test Performed", d6.test_performed);
    line("Test Result", d6.test_result);
    line("Turbine Returned to Service", d6.returned_to_service);
    line("Performance After Repair", d6.performance_after_repair);
    line("Monitoring Period", d6.monitoring_period);
    line("Validation Comments", d6.validation_comments);

    var d7 = data.d7 || {};
    sectionHead("D7", "Prevent Recurrence");
    line("Preventive Action", d7.preventive_action);
    line("Maintenance Procedure Updated", d7.maintenance_procedure_updated);
    line("Inspection Frequency Changed", d7.inspection_frequency_changed);
    line("Spare Parts Specification Updated", d7.spare_parts_spec_updated);
    line("Design Change Required", d7.design_change_required);
    line("Supplier / OEM Action", d7.supplier_oem_action);
    line("Training Required", d7.training_required);
    line("Documentation Updated", d7.documentation_updated);
    line("Similar Turbines Inspected", d7.similar_turbines_inspected);
    line("Lessons Learned", d7.lessons_learned);

    var d8 = data.d8 || {};
    sectionHead("D8", "Closure & Recognition");
    line("G8D Completion Date", d8.completion_date);
    line("Final Problem Status", d8.final_status);
    line("Final Verification", d8.final_verification);
    line("Customer Approval", d8.customer_approval);
    line("Customer Comments", d8.customer_comments);
    line("Service Engineer Approval", d8.service_engineer_approval);
    line("Team Leader Approval", d8.team_leader_approval);

    return doc;
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
          try {
            var pdfDoc = buildG8DPdfDoc(data);
            if (pdfDoc) pdfDoc.save("G8D-Report.pdf");
          } catch (pdfErr) { /* PDF is a courtesy download; never block success on it */ }
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
