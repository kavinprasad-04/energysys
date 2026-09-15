/* EnergySYS — subtle technical particle background.
   Fixed canvas behind all content, very low opacity, light blue/grey dots with
   faint connecting lines. CSS fallback (.tech-bg-fallback) covers no-JS / errors.
   Honors prefers-reduced-motion (skips entirely). */
(function () {
  'use strict';

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var canvas = document.getElementById('tech-particles');
  var fallback = document.querySelector('.tech-bg-fallback');
  if (!canvas || reduce || !canvas.getContext) return;

  var ctx;
  try { ctx = canvas.getContext('2d'); } catch (e) { return; }
  if (!ctx) return;

  // canvas is taking over — hide the CSS gradient fallback
  if (fallback) fallback.style.display = 'none';

  var DOT = 'rgba(120,150,185,0.40)';   // cool grey-blue, low opacity
  var LINE = 'rgba(120,150,185,0.9)';   // alpha scaled per-pair below
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0, h = 0, particles = [], linkDist = 130, running = true, raf = 0;

  function count() {
    var area = window.innerWidth * window.innerHeight;
    var n = Math.round(area / 32000);        // ~ density (sparser)
    return Math.max(18, Math.min(n, 90));
  }

  function resize() {
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    linkDist = w < 640 ? 96 : 130;
    var target = count();
    while (particles.length < target) particles.push(spawn());
    if (particles.length > target) particles.length = target;
  }

  function spawn() {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      r: Math.random() * 1.4 + 0.6
    };
  }

  function step() {
    if (!running) return;
    ctx.clearRect(0, 0, w, h);

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
    }

    // links
    for (var a = 0; a < particles.length; a++) {
      for (var b = a + 1; b < particles.length; b++) {
        var pa = particles[a], pb = particles[b];
        var dx = pa.x - pb.x, dy = pa.y - pb.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < linkDist * linkDist) {
          var alpha = (1 - Math.sqrt(d2) / linkDist) * 0.07;
          ctx.strokeStyle = 'rgba(120,150,185,' + alpha.toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
    }

    // dots
    ctx.fillStyle = DOT;
    for (var k = 0; k < particles.length; k++) {
      var q = particles[k];
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
      ctx.fill();
    }

    raf = window.requestAnimationFrame(step);
  }

  window.addEventListener('resize', debounce(resize, 200));
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) { cancelAnimationFrame(raf); step(); }
  });

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  resize();
  step();
})();
