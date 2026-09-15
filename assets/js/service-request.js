/* EnergySYS — Wind Farm Service Request form (service-request.html).
   Multi-file picker + drag/drop, per-field validation, multipart POST to
   /api/service-request, animated success panel, mailto fallback.
   Mirrors the Send-Query handler in main.js for consistent behaviour. */
(function () {
  "use strict";

  var form = document.getElementById("service-request-form");
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

  var status = form.querySelector(".form-status");
  var btn = document.getElementById("srq-submit");
  var btnText = btn && btn.querySelector(".btn--send__text");
  var btnSpin = btn && btn.querySelector(".btn--send__spin");
  var successPanel = document.getElementById("srq-success");
  var refLine = document.getElementById("srq-ref");
  var againBtn = document.getElementById("srq-again");
  var sending = false;

  /* ---------- per-field errors ---------- */
  function setError(el, msg) {
    var wrap = el.closest(".field");
    var slot = wrap ? wrap.querySelector(".field__err") : null;
    if (msg) { if (wrap) wrap.setAttribute("data-error", "true"); if (slot) slot.textContent = msg; }
    else { if (wrap) wrap.removeAttribute("data-error"); if (slot) slot.textContent = ""; }
  }
  function clearAllErrors() {
    form.querySelectorAll(".field[data-error]").forEach(function (w) { w.removeAttribute("data-error"); });
    form.querySelectorAll(".field__err").forEach(function (s) { s.textContent = ""; });
    if (docsErr) docsErr.textContent = "";
  }
  form.querySelectorAll("[required]").forEach(function (f) {
    f.addEventListener("blur", function () {
      if (!f.value.trim()) setError(f, "This field is required.");
      else if (f.type === "email" && !EMAIL_RE.test(f.value.trim())) setError(f, "Enter a valid email address.");
      else setError(f, "");
    });
  });

  /* ---------- multi-file picker ---------- */
  var fileInput = document.getElementById("f-docs");
  var drop = document.getElementById("srq-drop");
  var list = document.getElementById("srq-filelist");
  var docsErr = document.getElementById("f-docs-err");
  var files = []; // accumulated File objects

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
  function renderList() {
    list.textContent = "";
    if (!files.length) { list.hidden = true; return; }
    list.hidden = false;
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
      rm.addEventListener("click", function () {
        files.splice(i, 1);
        syncInput();
        renderList();
      });
      li.appendChild(name);
      li.appendChild(size);
      li.appendChild(rm);
      list.appendChild(li);
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
    renderList();
  }

  if (fileInput) {
    fileInput.addEventListener("change", function () {
      // the input holds the freshly picked set; merge then re-sync from `files`
      addFiles(fileInput.files);
    });
  }
  if (drop) {
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-drag"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
  }

  /* ---------- status + button state ---------- */
  function showStatus(state, msg) {
    if (!status) return;
    status.hidden = false;
    status.setAttribute("data-state", state);
    status.innerHTML = msg;
  }
  function btnState(s) {
    if (!btn) return;
    if (s === "loading") {
      btn.setAttribute("data-state", "loading");
      btn.disabled = true;
      if (btnText) btnText.textContent = "Submitting…";
      if (btnSpin) btnSpin.hidden = false;
    } else if (s === "success") {
      btn.setAttribute("data-state", "success");
      if (btnText) btnText.textContent = "✓ Submitted";
      if (btnSpin) btnSpin.hidden = true;
    } else {
      btn.removeAttribute("data-state");
      btn.disabled = false;
      if (btnText) btnText.textContent = btn.getAttribute("data-label") || "REQUEST SERVICE";
      if (btnSpin) btnSpin.hidden = true;
    }
  }

  function mailtoFallback() {
    var to = form.getAttribute("data-fallback-email") || "kavinprasad887@gmail.com";
    var farm = (form.elements.farm_name && form.elements.farm_name.value) || "wind farm";
    var s = encodeURIComponent("Wind Farm Service Request – " + farm);
    var lines = [];
    var labels = {
      full_name: "Full Name", company: "Company", email: "Email", phone: "Phone",
      country: "Country", city: "City / Location",
      farm_name: "Wind Farm Name", farm_location: "Wind Farm Location",
      turbine_count: "Number of Turbines", turbine_oem: "Turbine OEM", turbine_model: "Turbine Model",
      turbine_capacity_mw: "Turbine Capacity (MW)", farm_capacity_mw: "Total Farm Capacity (MW)",
      commissioning_year: "Commissioning Year",
      description: "Problem / Service Description", turbines_affected: "Turbines Affected",
      turbine_ids: "Turbine ID(s)", turbine_status: "Current Turbine Status",
      required_date: "Required Service Date", priority: "Priority", comments: "Additional Comments"
    };
    Object.keys(labels).forEach(function (n) {
      var el = form.elements[n];
      if (el && el.value && el.value.trim()) lines.push(labels[n] + ": " + el.value.trim());
    });
    var svc = getServices();
    if (svc.length) lines.push("Service Required: " + svc.join(", "));
    if (files.length) lines.push("Documents (send separately): " + files.map(function (f) { return f.name; }).join(", "));
    window.location.href = "mailto:" + to + "?subject=" + s + "&body=" + encodeURIComponent(lines.join("\n"));
    showStatus("err", "We couldn't reach the server. Your email app should open with the request ready to send — or email us at <strong>" + to + "</strong> (attach your files there).");
  }

  function getServices() {
    return Array.prototype.slice.call(form.querySelectorAll('input[name="services"]:checked'))
      .map(function (c) { return c.value; });
  }

  if (againBtn) {
    againBtn.addEventListener("click", function () {
      if (successPanel) successPanel.hidden = true;
      form.hidden = false;
      btnState("normal");
      if (status) status.hidden = true;
      var first = form.querySelector("#f-name");
      if (first) first.focus();
    });
  }

  /* ---------- submit ---------- */
  var REQUIRED = [
    ["full_name", "Please enter your full name."],
    ["company", "Please enter your company name."],
    ["email", "Please enter your email address."],
    ["phone", "Please enter your phone number."],
    ["country", "Please enter your country."],
    ["city", "Please enter your city or location."],
    ["farm_name", "Please enter the wind farm name."],
    ["farm_location", "Please enter the wind farm location."],
    ["description", "Please describe the problem or service required."]
  ];

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    clearAllErrors();

    var bad = [];
    REQUIRED.forEach(function (pair) {
      var el = form.elements[pair[0]];
      if (!el) return;
      if (!el.value.trim()) { setError(el, pair[1]); bad.push(el); }
      else if (el.type === "email" && !EMAIL_RE.test(el.value.trim())) {
        setError(el, "Please enter a valid email address."); bad.push(el);
      }
    });

    if (bad.length) {
      showStatus("err", "Please complete the highlighted fields.");
      bad[0].scrollIntoView({ behavior: "smooth", block: "center" });
      try { bad[0].focus({ preventScroll: true }); } catch (_) {}
      return;
    }

    var fd = new FormData(form);
    fd.delete("services");
    getServices().forEach(function (v) { fd.append("services", v); });
    fd.set("page", location.pathname + location.search);
    // ensure the accumulated files are what we send
    fd.delete("documents");
    files.forEach(function (f) { fd.append("documents", f, f.name); });

    sending = true;
    btnState("loading");
    showStatus("ok", "Submitting your service request…");

    fetch(form.getAttribute("action") || "/api/service-request", { method: "POST", body: fd })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      })
      .then(function (r) {
        sending = false;
        var data = r.data || {};
        if (r.res.ok && data.success) {
          btnState("success");
          setTimeout(function () {
            form.hidden = true;
            if (status) status.hidden = true;
            if (successPanel) {
              if (refLine && data.reference) {
                refLine.textContent = "Your reference: " + data.reference;
                refLine.hidden = false;
              }
              successPanel.hidden = false;
              successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            form.reset();
            files = [];
            renderList();
            syncInput();
            btnState("normal");
          }, 750);
        } else if (data.fields) {
          btnState("normal");
          Object.keys(data.fields).forEach(function (k) {
            var el = form.elements[k];
            if (el) setError(el && el.length ? el[0] : el, data.fields[k]);
          });
          showStatus("err", data.message || "Please complete the required fields.");
          var firstBad = form.querySelector(".field[data-error]");
          if (firstBad) firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (r.res.status === 429) {
          btnState("normal");
          showStatus("err", data.message || "Too many requests — please try again in a little while.");
        } else if (r.res.status === 502 && data.reference) {
          // saved but not emailed — treat as received
          btnState("normal");
          showStatus("ok", (data.message || "Your request was received.") +
            " Reference <strong>" + data.reference + "</strong>.");
        } else {
          btnState("normal");
          showStatus("err", "<strong>Unable to submit.</strong> Something went wrong. Please try again, or email us directly.");
        }
      })
      .catch(function () {
        sending = false;
        btnState("normal");
        mailtoFallback();
      });
  });
})();
