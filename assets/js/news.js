/* EnergySYS — News page: loads the latest wind-energy headlines from /api/news
   (the server reads public RSS feeds and returns headline, link, source, date). */
(function () {
  "use strict";

  var list = document.getElementById("news-list");
  if (!list) return;

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function note(msg) {
    list.textContent = "";
    var p = document.createElement("p");
    p.className = "news-note";
    p.textContent = msg;
    list.appendChild(p);
  }

  function render(items) {
    list.textContent = "";
    items.forEach(function (it) {
      var article = document.createElement("article");
      article.className = "news-item";

      var time = document.createElement("time");
      time.setAttribute("datetime", it.date);
      time.textContent = fmtDate(it.date);

      var body = document.createElement("div");
      var h3 = document.createElement("h3");
      var a = document.createElement("a");
      a.href = it.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.title;
      h3.appendChild(a);

      var p = document.createElement("p");
      p.textContent = "Source: " + it.source;

      body.appendChild(h3);
      body.appendChild(p);
      article.appendChild(time);
      article.appendChild(body);
      list.appendChild(article);
    });
  }

  fetch("/api/news")
    .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
    .then(function (r) {
      var items = (r.data && r.data.items) || [];
      if (r.ok && items.length) render(items);
      else note("Latest wind energy news is unavailable right now. Please check back soon.");
    })
    .catch(function () {
      note("Latest wind energy news is unavailable right now. Please check back soon.");
    });
})();
