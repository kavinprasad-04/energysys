/* EnergySYS — motion layer: video hero control, parallax, count-up, mask reveals.
   Loads on every marketing page after main.js. Respects prefers-reduced-motion. */
(function () {
  'use strict';

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 1. Hero video: play only while visible ---------------------- */
  var video = document.querySelector('.vhero video');
  if (video) {
    video.muted = true;
    video.setAttribute('playsinline', '');
    if (reduce) {
      video.removeAttribute('autoplay');
      video.pause();
    } else if ('IntersectionObserver' in window) {
      var vio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
          else { video.pause(); }
        });
      }, { threshold: 0.15 });
      vio.observe(video);
    }
    // pause when the tab is hidden
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) video.pause();
      else if (!reduce && isInView(video)) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    });
    // once the video is actually rendering, fade out the CSS fallback behind it
    var vhero = video.closest('.vhero');
    if (vhero) {
      video.addEventListener('playing', function () { vhero.classList.add('has-video'); });
      if (video.readyState >= 3 && !video.paused) vhero.classList.add('has-video');
    }
  }

  function isInView(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || 0);
  }

  /* ---- 2. Mask reveals ----------------------------------------- */
  // main.js already toggles .is-in on .reveal elements; .reveal-mask needs the
  // same treatment but isn't necessarily class="reveal".
  var masks = document.querySelectorAll('.reveal-mask');
  if (masks.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      masks.forEach(function (m) { m.classList.add('is-in'); });
    } else {
      var mio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); mio.unobserve(e.target); }
        });
      }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
      masks.forEach(function (m) { mio.observe(m); });
    }
  }

  /* ---- 3. Count-up numbers ----------------------------------- */
  var counters = document.querySelectorAll('[data-count]');
  function fmtNum(n, decimals) {
    return decimals ? n.toFixed(decimals) : String(Math.round(n));
  }
  counters.forEach(function (el) {
    var target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var decimals = (String(target).split('.')[1] || '').length;
    if (reduce || !('IntersectionObserver' in window)) {
      el.textContent = prefix + fmtNum(target, decimals) + suffix;
      return;
    }
    el.textContent = prefix + fmtNum(0, decimals) + suffix;
    var cio = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        obs.disconnect();
        var dur = 1200, t0 = performance.now();
        (function tick(now) {
          var p = Math.min(1, (now - t0) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = prefix + fmtNum(target * eased, decimals) + suffix;
          if (p < 1) requestAnimationFrame(tick);
          else el.textContent = prefix + fmtNum(target, decimals) + suffix;
        })(t0);
      });
    }, { threshold: 0.6 });
    cio.observe(el);
  });

  /* ---- 3b. Auto-scrolling logo marquees --------------------- */
  var marquees = document.querySelectorAll('.logo-marquee');
  marquees.forEach(function (mq) {
    var track = mq.querySelector('.logo-marquee__track');
    if (!track) return;
    var originals = Array.prototype.slice.call(track.children);
    if (!originals.length) return;

    if (reduce) return; // static wrapped grid, no clones, no animation

    // duplicate the row once so translateX(-50%) loops seamlessly
    originals.forEach(function (li) {
      var clone = li.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('data-dup', '');
      track.appendChild(clone);
    });

    // pace the animation by content width (~60px/sec), clamp to a sane range
    var setDuration = function () {
      var half = track.scrollWidth / 2;
      var secs = Math.max(18, Math.min(70, half / 60));
      mq.style.setProperty('--dur', secs.toFixed(1) + 's');
    };
    if (track.querySelector('img:not([complete])')) {
      window.addEventListener('load', setDuration);
    }
    setDuration();
  });

  /* ---- 4. Parallax ----------------------------------------- */
  if (!reduce) {
    var items = Array.prototype.map.call(
      document.querySelectorAll('[data-parallax]'),
      function (el) { return { el: el, speed: parseFloat(el.getAttribute('data-parallax')) || 0.14 }; }
    );
    if (items.length) {
      var ticking = false;
      var update = function () {
        var vh = window.innerHeight || 800;
        items.forEach(function (it) {
          var r = it.el.getBoundingClientRect();
          if (r.bottom < -240 || r.top > vh + 240) return;
          var mid = r.top + r.height / 2;
          var offset = (mid - vh / 2) * it.speed * -1;
          it.el.style.transform = 'translate3d(0,' + offset.toFixed(1) + 'px,0) scale(1.12)';
        });
        ticking = false;
      };
      var onScroll = function () {
        if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', update);
      update();
    }
  }
})();
