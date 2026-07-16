// IncBlog landing — editorial GSAP motion (parchment theme preserved).
// Self-hosted gsap + ScrollTrigger. Vanilla, no framework.
// Design intent: motion that feels like a printed page coming to life —
// rare, considered, never bouncy. Respects prefers-reduced-motion and
// degrades gracefully: content is visible by default; pre-animation states
// are applied by THIS script, so if JS/GSAP ever fails to load nothing hides.

(function () {
  'use strict';

  // ── Guard: only run on the landing page ──────────────────────────────
  var body = document.body;
  if (!body || !body.classList.contains('landing')) return;
  // If GSAP itself didn't load (blocked, 404, etc.), bail — content still visible.
  if (typeof window.gsap === 'undefined') return;

  var gsap = window.gsap;
  var ScrollTrigger;
  try {
    if (typeof window.ScrollTrigger !== 'undefined') {
      ScrollTrigger = window.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
    }
  } catch (e) { /* ScrollTrigger optional — entrance animations still work */ }

  // Project-wide defaults: short, decisive, no overshoot on body type.
  gsap.defaults({ ease: 'power3.out', duration: 0.7 });

  var mm = gsap.matchMedia();
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Reveal helper: set a "settled-from-below" pre-state, return vars ──
  function revealVars() {
    return { yPercent: 6, autoAlpha: 0 };
  }

  mm.add(
    {
      isWide: '(min-width: 760px)',
      isNarrow: '(max-width: 759px)',
      reduceMotion: '(prefers-reduced-motion: reduce)'
    },
    function (ctx) {
      var conditions = ctx.conditions || {};

      // Reduced motion: ensure everything is visible, no animation.
      if (conditions.reduceMotion || prefersReduced) {
        gsap.set(
          [
            '.hero h1', '.hero-sub', '.hero-actions', '.hero-note',
            '.section-header', '.feature-item', '.how-step',
            '.pricing-card', '.cta-section'
          ],
          { clearProps: 'all' }
        );
        return;
      }

      // ── 1. Hero — staggered arrival on load ────────────────────────
      // Headline reveals line-by-line (each <br> break is a line; we split by
      // wrapping). CSS already lays out normally; we animate from a hidden
      // state we set here so there's no FOUC if JS is slow.
      var heroHeadline = document.querySelector('.hero h1');
      var heroLines = null;
      if (heroHeadline) {
        // Split by visual lines: wrap each top-level text node line. Simplest
        // robust approach: animate the headline words via child spans we add.
        heroLines = wrapLines(heroHeadline);
      }

      var heroTL = gsap.timeline({
        delay: 0.15,
        defaults: { ease: 'power3.out' }
      });

      if (heroLines && heroLines.length) {
        // Set pre-state only via JS (not CSS) so no-JS keeps text visible.
        heroTL.set(heroLines, { yPercent: 110, autoAlpha: 0 });
        heroTL.to(heroLines, {
          yPercent: 0, autoAlpha: 1,
          duration: 0.9, stagger: 0.08, ease: 'power3.out'
        });
      } else {
        heroTL.from('.hero h1', { yPercent: 6, autoAlpha: 0, duration: 0.9 });
      }

      heroTL.from('.hero-sub', { y: 16, autoAlpha: 0, duration: 0.7 }, '-=0.45');
      heroTL.from('.hero-actions > *', {
        y: 14, autoAlpha: 0, duration: 0.6, stagger: 0.08
      }, '-=0.4');
      heroTL.from('.hero-note', { autoAlpha: 0, y: 8, duration: 0.5 }, '-=0.25');

      // ── 2. Sticky header — solidify on scroll ─────────────────────
      var header = document.querySelector('.site-header');
      if (header && ScrollTrigger) {
        ScrollTrigger.create({
          start: 'top top-=1',
          end: 99999,
          onUpdate: function (self) {
            var scrolled = self.scroll() > 8;
            header.classList.toggle('is-scrolled', scrolled);
          }
        });
      }

      // ── 3. Section headers — rise + reveal on enter ────────────────
      if (ScrollTrigger) {
        gsap.utils.toArray('.section-header').forEach(function (sh) {
          gsap.from(sh, {
            y: 24, autoAlpha: 0, duration: 0.8, ease: 'power3.out',
            scrollTrigger: { trigger: sh, start: 'top 88%', once: true }
          });
        });

        // ── 4. Feature grid — batched stagger (cards arrive together) ─
        ScrollTrigger.batch('.feature-item', {
          start: 'top 85%',
          once: true,
          onEnter: function (batch) {
            gsap.set(batch, revealVars());
            gsap.to(batch, {
              yPercent: 0, autoAlpha: 1, duration: 0.8,
              stagger: { each: 0.08, from: 'start' }, ease: 'power3.out'
            });
          }
        });

        // ── 5. How-steps — numbers draw in, copy rises ───────────────
        ScrollTrigger.batch('.how-step', {
          start: 'top 85%',
          once: true,
          onEnter: function (batch) {
            batch.forEach(function (step, i) {
              var num = step.querySelector('.how-number');
              var tl = gsap.timeline({ delay: i * 0.1, defaults: { ease: 'power3.out' } });
              tl.set(step, { yPercent: 6, autoAlpha: 0 });
              tl.to(step, { yPercent: 0, autoAlpha: 1, duration: 0.7 });
              if (num) {
                tl.from(num, { scale: 0.6, autoAlpha: 0, duration: 0.5 }, '-=0.55');
              }
            });
          }
        });

        // ── 6. Pricing cards — rise with a slight accent delay ───────
        ScrollTrigger.batch('.pricing-card', {
          start: 'top 85%',
          once: true,
          onEnter: function (batch) {
            gsap.set(batch, revealVars());
            gsap.to(batch, {
              yPercent: 0, autoAlpha: 1, duration: 0.8,
              stagger: 0.12, ease: 'power3.out'
            });
          }
        });

        // ── 7. CTA section — full reveal ─────────────────────────────
        gsap.from('.cta-section > *', {
          y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out',
          scrollTrigger: { trigger: '.cta-section', start: 'top 80%', once: true }
        });
      } else {
        // No ScrollTrigger — still give a gentle entrance to the hero only.
      }

      // Recalculate after fonts/images settle.
      if (ScrollTrigger) {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
        }
        window.addEventListener('load', function () { ScrollTrigger.refresh(); });
      }

      return function () { /* cleanup when media query stops matching */ };
    }
  );

  // ── Helpers ────────────────────────────────────────────────────────
  // Split a heading into per-line animatable spans WITHOUT a plugin.
  // Wraps each <br>-separated run; falls back to a single line.
  function wrapLines(el) {
    if (!el) return [];
    // If it already has inline structure (e.g. an <a>), animate the whole el.
    var html = el.innerHTML;
    if (html.indexOf('<br') === -1) return [el];

    // Build spans per text segment split by <br>.
    // We work on the live DOM to keep nested anchors intact.
    var nodes = Array.prototype.slice.call(el.childNodes);
    var lines = [];
    var current = document.createDocumentFragment();
    var holder = [];

    function flush() {
      if (holder.length === 0) return;
      var span = document.createElement('span');
      span.className = 'rev-line';
      span.style.display = 'block';
      span.style.overflow = 'hidden';
      var inner = document.createElement('span');
      inner.className = 'rev-inner';
      inner.style.display = 'block';
      holder.forEach(function (n) { inner.appendChild(n); });
      span.appendChild(inner);
      lines.push(inner); // animate the inner so overflow clip is on the wrapper
      current.appendChild(span);
      holder = [];
    }

    nodes.forEach(function (n) {
      if (n.nodeType === 1 && n.nodeName === 'BR') {
        flush();
      } else {
        holder.push(n);
      }
    });
    flush();

    el.innerHTML = '';
    // Wrap each line in an overflow-hidden + a transition wrapper for slide-up.
    var wrapped = [];
    lines.forEach(function (innerSpan) {
      var outer = innerSpan.parentNode; // .rev-line
      wrapped.push(innerSpan);
      el.appendChild(outer);
    });
    return wrapped;
  }
})();
