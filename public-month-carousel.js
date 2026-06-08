/**
 * Instagram-style horizontal month carousel for the public report panel.
 * Pointer Events + 1:1 finger tracking, velocity snap, edge rubber band, WAAPI spring settle.
 */
(function () {
  'use strict';

  const CFG = {
    axisLockPx: 10,
    snapThresholdRatio: 0.28,
    velocityThreshold: 0.45,
    edgeResistance: 0.35,
    snapDuration: 350,
    springEasing: 'spring(3, 1000, 500, 0)',
    fallbackEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    velocitySampleMs: 100,
  };

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function parseTranslateX(transform) {
    if (!transform || transform === 'none') return 0;
    const m = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
    if (!m) return 0;
    const parts = m[1].split(',').map(s => parseFloat(s.trim()));
    return parts.length === 16 ? parts[12] : parts[4];
  }

  function initMonthCarousel(options) {
    const {
      viewport,
      track,
      getData,
      getAdjacentMonthKey,
      buildReportHTML,
      getCurrentKey,
      setCurrentKey,
      onSettle,
    } = options;

    if (!viewport || !track) return null;

    let slideWidth = 0;
    let isDragging = false;
    let isAnimating = false;
    let activePointerId = null;
    let startX = 0;
    let startY = 0;
    let dragPx = 0;
    let axisLocked = null;
    let velocitySamples = [];
    let currentAnim = null;
    let resizeObserver = null;

    function measure() {
      slideWidth = viewport.clientWidth || viewport.offsetWidth;
      return slideWidth;
    }

    function applyLayoutAfterMount() {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const width = measure();
          if (width === 0) {
            requestAnimationFrame(() => {
              measure();
              applyTransform(getBaseOffset(), false);
            });
            return;
          }
          applyTransform(getBaseOffset(), false);
        });
      });
    }

    function neighbors(key) {
      const data = getData();
      return {
        prev: getAdjacentMonthKey(data, key, -1),
        next: getAdjacentMonthKey(data, key, 1),
      };
    }

    function canSwipe(key) {
      const { prev, next } = neighbors(key);
      return !!(prev || next);
    }

    function slideHTML(key) {
      if (!key) {
        return '<div class="month-carousel__slide-spacer" aria-hidden="true"></div>';
      }
      return buildReportHTML(key);
    }

    function mountSlides(centerKey) {
      const { prev, next } = neighbors(centerKey);

      track.style.width = '';

      if (!prev && !next) {
        track.innerHTML = `
          <div class="month-carousel__slide month-carousel__slide--active" data-month-key="${centerKey}">
            ${slideHTML(centerKey)}
          </div>`;
      } else {
        const keys = [prev || null, centerKey, next || null];
        track.innerHTML = keys.map((key, i) => {
          const active = i === 1 ? ' month-carousel__slide--active' : '';
          const monthAttr = key ? ` data-month-key="${key}"` : '';
          return `<div class="month-carousel__slide${active}"${monthAttr}>${slideHTML(key)}</div>`;
        }).join('');
      }

      applyLayoutAfterMount();
    }

    function getBaseOffset() {
      const key = getCurrentKey();
      if (!key || !canSwipe(key)) return 0;
      return -slideWidth;
    }

    function applyTransform(px, animate) {
      track.style.transform = `translate3d(${px}px, 0, 0)`;
      if (!animate) {
        track.style.transition = 'none';
      }
    }

    function getCurrentOffset() {
      const inline = track.style.transform;
      if (inline) {
        const m = inline.match(/translate3d\(([-\d.]+)px/);
        if (m) return parseFloat(m[1]);
      }
      return parseTranslateX(getComputedStyle(track).transform);
    }

    function cancelAnimation() {
      const currentPx = getCurrentOffset();
      if (currentAnim) {
        currentAnim.cancel();
        currentAnim = null;
      }
      track.getAnimations().forEach(a => a.cancel());
      isAnimating = false;
      applyTransform(currentPx, false);
    }

    function rubberBandOffset(rawDrag, hasPrev, hasNext) {
      let px = rawDrag;
      if (px > 0 && !hasPrev) px *= CFG.edgeResistance;
      if (px < 0 && !hasNext) px *= CFG.edgeResistance;
      return px;
    }

    function recordVelocity(x) {
      const now = performance.now();
      velocitySamples.push({ x, t: now });
      const cutoff = now - CFG.velocitySampleMs;
      velocitySamples = velocitySamples.filter(s => s.t >= cutoff);
    }

    function getVelocityX() {
      if (velocitySamples.length < 2) return 0;
      const first = velocitySamples[0];
      const last = velocitySamples[velocitySamples.length - 1];
      const dt = last.t - first.t;
      if (dt <= 0) return 0;
      return (last.x - first.x) / dt;
    }

    function animateTo(targetPx, onDone) {
      cancelAnimation();
      const fromPx = getCurrentOffset();

      if (prefersReducedMotion() || fromPx === targetPx) {
        applyTransform(targetPx, false);
        isAnimating = false;
        onDone?.();
        return;
      }

      isAnimating = true;
      track.style.transition = 'none';

      const keyframes = [
        { transform: `translate3d(${fromPx}px, 0, 0)` },
        { transform: `translate3d(${targetPx}px, 0, 0)` },
      ];

      try {
        currentAnim = track.animate(keyframes, {
          duration: CFG.snapDuration,
          easing: CFG.springEasing,
          fill: 'forwards',
        });
      } catch {
        currentAnim = track.animate(keyframes, {
          duration: CFG.snapDuration,
          easing: CFG.fallbackEasing,
          fill: 'forwards',
        });
      }

      currentAnim.finished
        .then(() => {
          currentAnim = null;
          isAnimating = false;
          applyTransform(targetPx, false);
          onDone?.();
        })
        .catch(() => {
          currentAnim = null;
          isAnimating = false;
        });
    }

    function commitMonth(delta) {
      const data = getData();
      const key = getCurrentKey();
      const nextKey = getAdjacentMonthKey(data, key, delta);
      if (!nextKey) return;

      setCurrentKey(nextKey);
      mountSlides(nextKey);
      onSettle?.(nextKey);
    }

    function settleFromDrag() {
      const key = getCurrentKey();
      const { prev, next } = neighbors(key);
      const velocityX = getVelocityX();
      const threshold = slideWidth * CFG.snapThresholdRatio;

      let targetDelta = 0;

      if (dragPx > threshold || (dragPx > 0 && velocityX > CFG.velocityThreshold)) {
        if (prev) targetDelta = -1;
      } else if (dragPx < -threshold || (dragPx < 0 && velocityX < -CFG.velocityThreshold)) {
        if (next) targetDelta = 1;
      }

      const base = getBaseOffset();

      if (targetDelta === -1) {
        animateTo(0, () => commitMonth(-1));
      } else if (targetDelta === 1) {
        animateTo(-slideWidth * 2, () => commitMonth(1));
      } else {
        animateTo(base, () => {});
      }
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!canSwipe(getCurrentKey())) return;

      if (isAnimating) {
        cancelAnimation();
        const currentPx = getCurrentOffset();
        const base = getBaseOffset();
        dragPx = currentPx - base;
        startX = e.clientX - dragPx;
      } else {
        startX = e.clientX;
        dragPx = 0;
      }

      activePointerId = e.pointerId;
      startY = e.clientY;
      axisLocked = null;
      velocitySamples = [{ x: e.clientX, t: performance.now() }];
      isDragging = true;

      viewport.classList.add('is-dragging');
      track.style.transition = 'none';
    }

    function onPointerMove(e) {
      if (!isDragging || e.pointerId !== activePointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (axisLocked === null) {
        if (Math.abs(dx) < CFG.axisLockPx && Math.abs(dy) < CFG.axisLockPx) return;
        axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axisLocked === 'y') {
          endDrag(false);
          return;
        }
        try {
          viewport.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      if (axisLocked !== 'x') return;

      e.preventDefault();
      recordVelocity(e.clientX);

      const key = getCurrentKey();
      const { prev, next } = neighbors(key);
      dragPx = rubberBandOffset(dx, !!prev, !!next);

      const base = getBaseOffset();
      applyTransform(base + dragPx, false);
    }

    function endDrag(shouldSettle) {
      if (!isDragging) return;
      isDragging = false;
      activePointerId = null;
      viewport.classList.remove('is-dragging');

      if (shouldSettle && axisLocked === 'x') {
        settleFromDrag();
      } else {
        dragPx = 0;
        if (!isAnimating) {
          applyTransform(getBaseOffset(), false);
        }
      }
      axisLocked = null;
      velocitySamples = [];
    }

    function onPointerUp(e) {
      if (e.pointerId !== activePointerId) return;
      endDrag(true);
      try {
        viewport.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    function onPointerCancel(e) {
      if (e.pointerId !== activePointerId) return;
      endDrag(false);
      mountSlides(getCurrentKey());
    }

    function goTo(delta) {
      const data = getData();
      const key = getCurrentKey();
      const targetKey = getAdjacentMonthKey(data, key, delta);
      if (!targetKey || isAnimating) return;

      if (!canSwipe(key)) {
        setCurrentKey(targetKey);
        mountSlides(targetKey);
        onSettle?.(targetKey);
        return;
      }

      const targetPx = delta < 0 ? 0 : -slideWidth * 2;
      animateTo(targetPx, () => commitMonth(delta));
    }

    function refresh() {
      if (isDragging) {
        isDragging = false;
        activePointerId = null;
        axisLocked = null;
        dragPx = 0;
        velocitySamples = [];
        viewport.classList.remove('is-dragging');
      }
      cancelAnimation();
      const key = getCurrentKey();
      if (key) mountSlides(key);
      else track.innerHTML = '<div class="month-carousel__slide"><p class="empty-state">No report available yet.</p></div>';
    }

    function destroy() {
      resizeObserver?.disconnect();
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerCancel);
      viewport.removeEventListener('keydown', onKeyDown);
    }

    function onKeyDown(e) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(1);
      }
    }

    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove, { passive: false });
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerCancel);
    viewport.addEventListener('keydown', onKeyDown);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (isDragging || isAnimating) return;
        const key = getCurrentKey();
        if (!key) return;
        const width = measure();
        if (width === 0) return;
        applyTransform(getBaseOffset(), false);
      });
      resizeObserver.observe(viewport);
    }

    return { mountSlides, goTo, refresh, destroy, measure };
  }

  window.initMonthCarousel = initMonthCarousel;
})();
