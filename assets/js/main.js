/* EnergySYS — site behaviour: nav, reveal, product filter, enquiry form */
(function () {
  "use strict";

  /* ---- Mobile navigation ---------------------------------------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    /* ---- Service menu (click-to-open, works from disk or server) ---- */
    // The "Service" label is a button (no href). Clicking it toggles the
    // Wind/Solar submenu using INLINE styles, so it shows regardless of any
    // stylesheet / media-query / cache state. No hover.
    var svcLi = nav.querySelector(".has-drop.drop-click");
    if (svcLi && svcLi.getAttribute("data-svc-inline") !== "1") {
      var svcBtn = svcLi.querySelector("a, .drop-toggle");
      var svcDrop = svcLi.querySelector(".drop");
      if (svcBtn && svcDrop) {
        var svcOpen = false;
        var showSvc = function () {
          svcOpen = true;
          svcDrop.style.cssText =
            "display:block;opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:none;";
          svcBtn.setAttribute("aria-expanded", "true");
          svcLi.classList.add("is-open");
        };
        var hideSvc = function () {
          svcOpen = false;
          svcDrop.style.cssText = "display:none;";
          svcBtn.setAttribute("aria-expanded", "false");
          svcLi.classList.remove("is-open");
        };
        var toggleSvc = function (e) {
          if (e) e.preventDefault();
          if (svcOpen) hideSvc(); else showSvc();
        };
        svcBtn.addEventListener("click", toggleSvc);
        svcBtn.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") toggleSvc(e);
        });
        document.addEventListener("click", function (e) {
          if (svcOpen && !svcLi.contains(e.target)) hideSvc();
        });
        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape" && svcOpen) hideSvc();
        });
        hideSvc();
      }
    }

    /* ---- Other dropdowns (Resources): hover on desktop, tap on mobile ---- */
    nav.querySelectorAll(".has-drop:not(.drop-click) > a").forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (window.matchMedia("(max-width: 980px)").matches) {
          var drop = a.parentElement.querySelector(".drop");
          if (drop) { e.preventDefault(); drop.classList.toggle("is-open"); }
        }
      });
    });
  }

  /* ---- Footer year -------------------------------------------- */
  var y = document.getElementById("year");
  if (y) { y.textContent = new Date().getFullYear(); }

  /* ---- Reveal on scroll -------------------------------------- */
  var reveals = document.querySelectorAll(".reveal");
  if (reveals.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { threshold: 0, rootMargin: "0px 0px 0px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
    // Safety net: reveal anything at/above the fold on load, and never leave
    // content hidden if observers misbehave.
    var sweep = function () {
      reveals.forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) { el.classList.add("is-in"); }
      });
    };
    requestAnimationFrame(sweep);
    window.addEventListener("load", sweep);
    setTimeout(sweep, 1200);
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ---- Query helpers --------------------------------------- */
  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /* ---- Products page: filter by category / search ---------- */
  var grid = document.getElementById("product-grid");
  if (grid) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll("[data-cat]"));
    var catSel = document.getElementById("filter-cat");
    var qInput = document.getElementById("filter-q");
    var countEl = document.getElementById("result-count");
    var emptyEl = document.getElementById("no-results");

    var startCat = param("category");
    var startQ = param("q");
    if (startCat && catSel) { catSel.value = startCat; }
    if (startQ && qInput) { qInput.value = startQ; }

    function apply() {
      var c = (catSel && catSel.value ? catSel.value : "").toLowerCase();
      var q = (qInput && qInput.value ? qInput.value : "").trim().toLowerCase();
      var shown = 0;
      cards.forEach(function (card) {
        var matchCat = !c || card.getAttribute("data-cat").toLowerCase() === c;
        var hay = (card.getAttribute("data-search") || card.textContent).toLowerCase();
        var matchQ = !q || hay.indexOf(q) !== -1;
        var ok = matchCat && matchQ;
        card.hidden = !ok;
        if (ok) { shown++; }
      });
      if (countEl) { countEl.textContent = shown + (shown === 1 ? " part" : " parts"); }
      if (emptyEl) { emptyEl.hidden = shown !== 0; }
    }
    if (catSel) { catSel.addEventListener("change", apply); }
    if (qInput) { qInput.addEventListener("input", apply); }
    apply();
  }

  /* ---- Send Query form: prefill, validate, attachment, submit --- */
  var form = document.getElementById("enquiry-form");
  if (form) {
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var MAX_MB = 10;
    var OK_FILE = ["image/jpeg", "image/png", "application/pdf"];

    var ref = param("ref");
    var subjectEl = form.querySelector('[name="subject"]');
    var messageEl = form.querySelector('[name="message"]');
    if (ref && subjectEl && !subjectEl.value) {
      subjectEl.value = "Price enquiry — " + ref;
      if (messageEl && !messageEl.value) {
        messageEl.value = "Please send pricing and lead time for: " + ref +
          "\n\nQuantity required: \nTurbine model / application: ";
      }
    }

    var status = form.querySelector(".form-status");
    var btn = document.getElementById("send-query-btn");
    var btnText = btn && btn.querySelector(".btn--send__text");
    var btnSpin = btn && btn.querySelector(".btn--send__spin");
    var successPanel = document.getElementById("query-success");
    var againBtn = document.getElementById("query-again");
    var sending = false;

    /* --- per-field errors --- */
    function setError(el, msg) {
      var wrap = el.closest(".field");
      var slot = wrap ? wrap.querySelector(".field__err") : null;
      if (msg) { if (wrap) wrap.setAttribute("data-error", "true"); if (slot) slot.textContent = msg; }
      else { if (wrap) wrap.removeAttribute("data-error"); if (slot) slot.textContent = ""; }
    }
    function clearAllErrors() {
      form.querySelectorAll(".field[data-error]").forEach(function (w) { w.removeAttribute("data-error"); });
      form.querySelectorAll(".field__err").forEach(function (s) { s.textContent = ""; });
    }
    form.querySelectorAll("[required]").forEach(function (f) {
      f.addEventListener("blur", function () {
        if (!f.value.trim()) setError(f, "This field is required.");
        else if (f.type === "email" && !EMAIL_RE.test(f.value.trim())) setError(f, "Enter a valid email address.");
        else setError(f, "");
      });
    });

    /* --- attachment picker --- */
    var fileInput = document.getElementById("f-attach");
    var chosen = document.getElementById("f-attach-chosen");
    var chosenName = chosen && chosen.querySelector(".filepick__name");
    var fileErr = document.getElementById("f-attach-err");
    var pickLabel = form.querySelector("#f-attach-pick .filepick__label");

    function clearFile() {
      if (fileInput) fileInput.value = "";
      if (chosen) chosen.hidden = true;
      if (fileErr) fileErr.textContent = "";
      if (pickLabel) pickLabel.textContent = "Choose a file";
    }
    function checkFile() {
      if (fileErr) fileErr.textContent = "";
      var f = fileInput && fileInput.files && fileInput.files[0];
      if (!f) { if (chosen) chosen.hidden = true; return true; }
      var extOk = /\.(jpe?g|png|pdf)$/i.test(f.name);
      if (OK_FILE.indexOf(f.type) === -1 && !extOk) {
        if (fileErr) fileErr.textContent = "Only JPG, PNG or PDF files are allowed.";
        clearFile();
        return false;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        if (fileErr) fileErr.textContent = "That file is larger than " + MAX_MB + " MB.";
        clearFile();
        return false;
      }
      if (chosenName) chosenName.textContent = f.name + "  ·  " + Math.max(1, Math.round(f.size / 1024)) + " KB";
      if (chosen) chosen.hidden = false;
      if (pickLabel) pickLabel.textContent = "Change file";
      return true;
    }
    if (fileInput) fileInput.addEventListener("change", checkFile);
    if (chosen) {
      var rm = chosen.querySelector(".filepick__rm");
      if (rm) rm.addEventListener("click", clearFile);
    }

    /* --- status + button state helpers --- */
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
        if (btnText) btnText.textContent = "Sending Query…";
        if (btnSpin) btnSpin.hidden = false;
      } else if (s === "success") {
        btn.setAttribute("data-state", "success");
        if (btnText) btnText.textContent = "✓ Query Sent";
        if (btnSpin) btnSpin.hidden = true;
      } else {
        btn.removeAttribute("data-state");
        btn.disabled = false;
        if (btnText) btnText.textContent = btn.getAttribute("data-label") || "SEND QUERY";
        if (btnSpin) btnSpin.hidden = true;
      }
    }

    function mailtoFallback() {
      var to = form.getAttribute("data-fallback-email") || "kavinprasad887@gmail.com";
      var s = encodeURIComponent("New Website Query – " + ((subjectEl && subjectEl.value) || "EnergySYS"));
      var lines = [];
      ["name", "company", "email", "mobile", "query_type", "subject", "message"].forEach(function (n) {
        var el = form.elements[n];
        if (el && el.value) lines.push(n.replace("_", " ") + ": " + el.value);
      });
      window.location.href = "mailto:" + to + "?subject=" + s + "&body=" + encodeURIComponent(lines.join("\n"));
      showStatus("err", "We couldn't reach the server. Your email app should open with the query ready to send — or email us at <strong>" + to + "</strong>.");
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

    /* --- submit --- */
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      clearAllErrors();

      // spec validation: name, email format, subject, message
      var bad = [];
      var nameEl = form.elements.name, emailEl = form.elements.email;
      if (!nameEl.value.trim()) { setError(nameEl, "Please enter your name."); bad.push(nameEl); }
      if (!emailEl.value.trim()) { setError(emailEl, "Please enter your email address."); bad.push(emailEl); }
      else if (!EMAIL_RE.test(emailEl.value.trim())) { setError(emailEl, "Please enter a valid email address."); bad.push(emailEl); }
      if (!subjectEl.value.trim()) { setError(subjectEl, "Please enter a subject."); bad.push(subjectEl); }
      if (!messageEl.value.trim()) { setError(messageEl, "Please enter your query."); bad.push(messageEl); }
      if (!checkFile()) bad.push(fileInput);

      if (bad.length) {
        showStatus("err", "Please complete the highlighted fields.");
        bad[0].scrollIntoView({ behavior: "smooth", block: "center" });
        try { bad[0].focus({ preventScroll: true }); } catch (_) {}
        return;
      }

      var fd = new FormData();
      ["name", "company", "email", "mobile", "query_type", "subject", "message", "website"].forEach(function (n) {
        var el = form.elements[n];
        if (el) fd.append(n, el.value || "");
      });
      fd.append("ref", param("ref") || "");
      fd.append("page", location.pathname + location.search);
      if (fileInput && fileInput.files && fileInput.files[0]) {
        fd.append("attachment", fileInput.files[0], fileInput.files[0].name);
      }

      sending = true;
      btnState("loading");
      showStatus("ok", "Sending your query…");

      fetch(form.getAttribute("action") || "/api/send-query", { method: "POST", body: fd })
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
                successPanel.hidden = false;
                successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
              }
              form.reset();
              clearFile();
              btnState("normal");
            }, 750);
          } else if (data.fields) {
            btnState("normal");
            Object.keys(data.fields).forEach(function (k) {
              var el = form.elements[k] || (k === "attachment" ? fileInput : null);
              if (el) setError(el, data.fields[k]);
            });
            showStatus("err", data.message || "Please complete the required fields.");
          } else if (r.res.status === 429) {
            btnState("normal");
            showStatus("err", data.message || "Too many queries — please try again in a little while.");
          } else if (r.res.status === 400) {
            btnState("normal");
            showStatus("err", data.message || "Please check your details and try again.");
          } else {
            btnState("normal");
            showStatus("err", "<strong>Unable to Send Query.</strong> Something went wrong while sending your query. Please try again.");
          }
        })
        .catch(function () {
          sending = false;
          btnState("normal");
          mailtoFallback();
        });
    });
  }
})();
