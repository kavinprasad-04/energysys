/* EnergySYS — parts shop (products.html): faceted sidebar + results.
   The manufacturer facet is deferred behind a "Filter" button; category links,
   search, sort, view and pagination apply live.
   Progressive enhancement over a plain product grid. Respects prefers-reduced-motion. */
(function () {
  "use strict";

  var grid = document.getElementById("product-grid");
  if (!grid) return;

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var PAGE_SIZE = 20;

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".prod-card"));
  cards.forEach(function (c, i) {
    c._i = i;
    c._mfr = c.getAttribute("data-mfr") || "";
    c._cat = c.getAttribute("data-cat") || "";
    c._name = (c.getAttribute("data-name") || "").toLowerCase();
    c._code = (c.querySelector(".prod-card__pn") || {}).textContent || "";
    c._hay = (c.getAttribute("data-search") || c.textContent).toLowerCase();
  });

  var mfrList = document.querySelector('[data-facet="mfr"]');
  var catLinks = document.querySelector('.cat-links');
  var qInput = document.getElementById("shop-q");
  var sortSel = document.getElementById("shop-sort");
  var countEl = document.getElementById("result-count");
  var emptyEl = document.getElementById("no-results");
  var pagerEl = document.getElementById("shop-pager");
  var activeEl = document.getElementById("shop-active");
  var clearBtn = document.getElementById("shop-clear");
  var viewGrid = document.getElementById("view-grid");
  var viewListBtn = document.getElementById("view-list");
  var filtersToggle = document.getElementById("filters-toggle");
  var filtersWrap = document.getElementById("shop-filters");
  var mfrSearch = document.getElementById("mfr-search");
  var applyBtns = Array.prototype.slice.call(document.querySelectorAll(".facet-apply"));

  var page = 1;

  // committed = what's actually filtering; pending = staged (manufacturer only)
  var committed = { mfr: [], cat: "", q: "" };
  var pending = { mfr: [] };

  /* ---- URL prefill: ?category= ?mfr= ?q= --------------------- */
  function param(n) { return new URLSearchParams(location.search).get(n); }

  var startCat = param("category");
  if (startCat && catLinks) {
    var link = Array.prototype.slice.call(catLinks.querySelectorAll(".cat-link")).filter(function (b) {
      return (b.getAttribute("data-cat") || "").toLowerCase() === startCat.toLowerCase();
    })[0];
    if (link) committed.cat = link.getAttribute("data-cat");
  }
  var startMfr = param("mfr");
  if (startMfr && mfrList) {
    Array.prototype.slice.call(mfrList.querySelectorAll("input")).forEach(function (b) {
      if (b.value.toLowerCase() === startMfr.toLowerCase()) { b.checked = true; }
    });
    committed.mfr = checkedMfr();
    pending.mfr = committed.mfr.slice();
  }
  if (qInput && param("q")) { qInput.value = param("q"); committed.q = param("q").trim().toLowerCase(); }

  function checkedMfr() {
    if (!mfrList) return [];
    return Array.prototype.slice.call(mfrList.querySelectorAll("input:checked"))
      .map(function (b) { return b.value; });
  }

  function matches(card) {
    if (committed.mfr.length && committed.mfr.indexOf(card._mfr) === -1) return false;
    if (committed.cat && card._cat !== committed.cat) return false;
    if (committed.q && card._hay.indexOf(committed.q) === -1) return false;
    return true;
  }

  function sortCards(list) {
    var mode = sortSel ? sortSel.value : "default";
    var out = list.slice();
    if (mode === "name") out.sort(function (a, b) { return a._name < b._name ? -1 : a._name > b._name ? 1 : 0; });
    else if (mode === "code") out.sort(function (a, b) { return a._code < b._code ? -1 : a._code > b._code ? 1 : 0; });
    else out.sort(function (a, b) { return a._i - b._i; });
    return out;
  }

  /* ---- active-filter chips ------------------------------- */
  function chip(label, onRemove) {
    var el = document.createElement("span");
    el.className = "shop-chip";
    el.appendChild(document.createTextNode(label));
    var x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Remove filter " + label);
    x.textContent = "×";
    x.addEventListener("click", onRemove);
    el.appendChild(x);
    return el;
  }
  function renderChips() {
    if (!activeEl) return;
    activeEl.textContent = "";
    committed.mfr.forEach(function (v) {
      activeEl.appendChild(chip(v, function () {
        if (mfrList) Array.prototype.slice.call(mfrList.querySelectorAll("input")).forEach(function (b) {
          if (b.value === v) b.checked = false;
        });
        committed.mfr = checkedMfr();
        pending.mfr = committed.mfr.slice();
        syncApplyState();
        page = 1; render();
      }));
    });
    if (committed.cat) {
      activeEl.appendChild(chip(committed.cat, function () { setCategory(""); }));
    }
    if (committed.q) {
      activeEl.appendChild(chip('"' + committed.q + '"', function () {
        if (qInput) qInput.value = "";
        committed.q = "";
        page = 1; render();
      }));
    }
    var any = committed.mfr.length || committed.cat || committed.q;
    if (clearBtn) clearBtn.hidden = !any;
  }

  /* ---- pagination ---------------------------------------- */
  function renderPager(pageCount) {
    if (!pagerEl) return;
    pagerEl.textContent = "";
    if (pageCount <= 1) { pagerEl.hidden = true; return; }
    pagerEl.hidden = false;
    var mk = function (label, target, opts) {
      opts = opts || {};
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (opts.current) b.setAttribute("aria-current", "true");
      if (opts.disabled) b.disabled = true;
      b.addEventListener("click", function () { page = target; render(true); });
      return b;
    };
    pagerEl.appendChild(mk("‹", Math.max(1, page - 1), { disabled: page === 1 }));
    for (var pn = 1; pn <= pageCount; pn++) {
      pagerEl.appendChild(mk(String(pn), pn, { current: pn === page }));
    }
    pagerEl.appendChild(mk("›", Math.min(pageCount, page + 1), { disabled: page === pageCount }));
  }

  /* ---- main render -------------------------------------- */
  function render(fromPager) {
    var matched = sortCards(cards.filter(matches));
    var pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    if (page > pageCount) page = pageCount;
    var start = (page - 1) * PAGE_SIZE;
    var slice = matched.slice(start, start + PAGE_SIZE);

    cards.forEach(function (c) { c.hidden = true; });
    slice.forEach(function (c) { c.hidden = false; });
    slice.forEach(function (c) { grid.appendChild(c); });
    cards.forEach(function (c) { if (slice.indexOf(c) === -1) grid.appendChild(c); });

    if (countEl) {
      countEl.textContent = matched.length
        ? "Showing " + (start + 1) + "–" + (start + slice.length) + " of " + matched.length + " results"
        : "No results";
    }
    if (emptyEl) emptyEl.hidden = matched.length !== 0;
    renderChips();
    renderPager(pageCount);

    if (fromPager) {
      var top = grid.getBoundingClientRect().top + window.pageYOffset - 120;
      window.scrollTo({ top: top, behavior: reduce ? "auto" : "smooth" });
    }
  }

  /* ---- category link list (live) ----------------------- */
  function setCategory(cat) {
    committed.cat = cat;
    if (catLinks) {
      Array.prototype.slice.call(catLinks.querySelectorAll(".cat-link")).forEach(function (b) {
        b.classList.toggle("is-active", (b.getAttribute("data-cat") || "") === cat);
      });
    }
    page = 1; render();
  }
  if (catLinks) {
    catLinks.addEventListener("click", function (e) {
      var btn = e.target.closest(".cat-link");
      if (!btn) return;
      var cat = btn.getAttribute("data-cat") || "";
      setCategory(cat === committed.cat ? "" : cat);
    });
  }

  /* ---- manufacturer checkboxes (deferred) ------------- */
  if (mfrList) {
    mfrList.addEventListener("change", function () {
      pending.mfr = checkedMfr();
      syncApplyState();
    });
  }
  function dirty() {
    return pending.mfr.slice().sort().join("|") !== committed.mfr.slice().sort().join("|");
  }
  function syncApplyState() {
    var d = dirty();
    applyBtns.forEach(function (b) { b.classList.toggle("is-dirty", d); });
  }
  applyBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      committed.mfr = pending.mfr.slice();
      syncApplyState();
      page = 1; render();
    });
  });

  /* ---- product search + sort (live) ------------------ */
  if (qInput) qInput.addEventListener("input", function () {
    committed.q = qInput.value.trim().toLowerCase();
    page = 1; render();
  });
  if (sortSel) sortSel.addEventListener("change", function () { page = 1; render(); });

  // manufacturer facet: type-to-filter the checkbox rows (visual only)
  if (mfrSearch && mfrList) {
    mfrSearch.addEventListener("input", function () {
      var t = mfrSearch.value.trim().toLowerCase();
      Array.prototype.slice.call(mfrList.querySelectorAll(".facet__row")).forEach(function (row) {
        var name = (row.textContent || "").toLowerCase();
        row.style.display = (!t || name.indexOf(t) !== -1) ? "" : "none";
      });
    });
  }

  /* ---- clear all ------------------------------------- */
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (mfrList) mfrList.querySelectorAll("input:checked").forEach(function (b) { b.checked = false; });
      if (qInput) qInput.value = "";
      if (mfrSearch) { mfrSearch.value = ""; mfrSearch.dispatchEvent(new Event("input")); }
      committed = { mfr: [], cat: "", q: "" };
      pending = { mfr: [] };
      if (catLinks) Array.prototype.slice.call(catLinks.querySelectorAll(".cat-link")).forEach(function (b) {
        b.classList.toggle("is-active", (b.getAttribute("data-cat") || "") === "");
      });
      syncApplyState();
      page = 1; render();
    });
  }

  /* ---- view toggle --------------------------------- */
  function setView(mode) {
    var isList = mode === "list";
    grid.classList.toggle("prod-grid--list", isList);
    if (viewGrid) viewGrid.setAttribute("aria-pressed", String(!isList));
    if (viewListBtn) viewListBtn.setAttribute("aria-pressed", String(isList));
    try { localStorage.setItem("esys-shop-view", mode); } catch (e) {}
  }
  if (viewGrid) viewGrid.addEventListener("click", function () { setView("grid"); });
  if (viewListBtn) viewListBtn.addEventListener("click", function () { setView("list"); });
  try { if (localStorage.getItem("esys-shop-view") === "list") setView("list"); } catch (e) {}

  /* ---- mobile filters toggle ---------------------- */
  if (filtersToggle && filtersWrap) {
    filtersToggle.addEventListener("click", function () {
      var open = filtersWrap.classList.toggle("is-open");
      filtersToggle.setAttribute("aria-expanded", String(open));
    });
  }

  syncApplyState();
  render();
})();
