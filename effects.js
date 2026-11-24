// Skripte und Styles, die in Webseiten eingeschleust werden: Partikel-Themes, YouTube-Look, KI-Cursor.

const ACCENTS = { sakura: '#ff7eb6', snow: '#7cc4ff', leaves: '#ff9a3c', off: '#5fb98a' };

// ---------- Fallende Partikel (Sakura-Bluten, Schnee, Herbstlaub) ----------
// visible=false blendet einen vorhandenen Effekt sanft aus (und legt keinen neuen an).
function particles(kind, visible) {
  const fn = (kind, visible) => {
    const on = !!visible && kind !== 'off';
    let api = window.__shieldFx;
    if (!api) {
      if (!on) return;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;opacity:0;display:none;transition:opacity .9s ease;';
      const root = host.attachShadow({ mode: 'closed' });
      const c = document.createElement('canvas');
      c.style.cssText = 'width:100%;height:100%;display:block';
      root.appendChild(c);
      document.documentElement.appendChild(host);
      const g = c.getContext('2d');
      let W = 0, H = 0, cur = '', list = [], raf = 0, hideT = 0, running = false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const resize = () => { W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
      addEventListener('resize', resize); resize();

      const PINKS = ['#ffc1d9', '#ff9fc4', '#ffb3d0', '#ff86b4', '#ffd6e6'];
      const LEAVES = ['#e8742a', '#d9a21b', '#b5471c', '#c98a2b'];
      const rnd = (a, b) => a + Math.random() * (b - a);
      const make = initial => {
        const flower = cur === 'sakura' && Math.random() < 0.3;
        return {
          x: rnd(0, W), y: initial ? rnd(-H, H * 0.6) : rnd(-60, -10),
          s: flower ? rnd(9, 15) : cur === 'snow' ? rnd(1.5, 4.5) : rnd(5, 10),
          vy: rnd(0.5, 1.4) * (cur === 'snow' ? 0.8 : 1), sway: rnd(0.4, 1.2), ph: rnd(0, 6.28),
          r: rnd(0, 6.28), vr: rnd(-0.03, 0.03), flower,
          col: cur === 'sakura' ? PINKS[(Math.random() * PINKS.length) | 0] : LEAVES[(Math.random() * LEAVES.length) | 0],
          a: rnd(0.65, 0.95)
        };
      };
      const petal = s => {
        g.beginPath(); g.moveTo(0, 0);
        g.bezierCurveTo(s * 0.7, -s * 0.3, s * 0.6, -s * 1.1, 0, -s * 1.2);
        g.bezierCurveTo(-s * 0.6, -s * 1.1, -s * 0.7, -s * 0.3, 0, 0);
        g.fill();
      };
      const draw = p => {
        g.save(); g.globalAlpha = p.a; g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.col;
        if (cur === 'snow') { g.beginPath(); g.arc(0, 0, p.s, 0, 6.28); g.fillStyle = '#fff'; g.fill(); }
        else if (p.flower) {
          for (let i = 0; i < 5; i++) { g.save(); g.rotate(i * 1.2566); petal(p.s * 0.8); g.restore(); }
          g.beginPath(); g.arc(0, 0, p.s * 0.16, 0, 6.28); g.fillStyle = '#fff3a8'; g.fill();
        } else if (cur === 'sakura') { g.scale(1, 0.7); petal(p.s); }
        else { g.beginPath(); g.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 6.28); g.fill(); }
        g.restore();
      };
      const loop = () => {
        g.clearRect(0, 0, W, H);
        for (const p of list) {
          p.y += p.vy; p.ph += 0.02; p.x += Math.sin(p.ph) * p.sway; p.r += p.vr;
          if (p.y > H + 20 || p.x < -40 || p.x > W + 40) Object.assign(p, make(false));
          draw(p);
        }
        raf = requestAnimationFrame(loop);
      };
      let want = false, wantKind = 'sakura';
      const render = show => {
        clearTimeout(hideT);
        if (show) {
          if (wantKind !== cur || !list.length) { cur = wantKind; list = Array.from({ length: cur === 'snow' ? 90 : 38 }, () => make(true)); }
          host.style.display = 'block';
          if (!running) { running = true; raf = requestAnimationFrame(loop); }
          requestAnimationFrame(() => requestAnimationFrame(() => { host.style.opacity = '1'; }));
        } else {
          host.style.opacity = '0';
          hideT = setTimeout(() => { running = false; cancelAnimationFrame(raf); g.clearRect(0, 0, W, H); host.style.display = 'none'; }, 1000);
        }
      };
      // Sicherheitsnetz: Laeuft irgendwo ein grosses Video, blendet sich der Effekt aus und danach wieder ein.
      const playing = new Set();
      const isBig = v => { const r = v.getBoundingClientRect(); return r.width >= 320 && r.height >= 180; };
      const refresh = () => render(want && playing.size === 0);
      document.addEventListener('playing', e => { const v = e.target; if (v && v.tagName === 'VIDEO' && isBig(v)) { playing.add(v); refresh(); } }, true);
      const stopped = e => { if (playing.delete(e.target)) refresh(); };
      for (const ev of ['pause', 'ended', 'emptied']) document.addEventListener(ev, stopped, true);
      document.querySelectorAll('video').forEach(v => { if (!v.paused && !v.ended && isBig(v)) playing.add(v); });
      api = window.__shieldFx = { apply(k, show) { want = show; wantKind = k; refresh(); } };
    }
    api.apply(kind, on);
  };
  return `(${fn})(${JSON.stringify(kind)}, ${!!visible})`;
}

// ---------- YouTube ----------
function ytCss(mode, accent) {
  if (mode === 'off') return '';
  const base = `
    html, html[dark], ytd-app { --yt-spec-base-background:#15111a !important; --yt-spec-raised-background:#201a28 !important;
      --yt-spec-menu-background:#201a28 !important; --yt-spec-general-background-a:#15111a !important;
      --yt-spec-general-background-b:#1b1622 !important; --yt-spec-general-background-c:#201a28 !important;
      --yt-spec-brand-background-solid:#15111a !important; --yt-spec-call-to-action:${accent} !important; }
    ytd-app, body { background:#15111a !important; }
    ytd-thumbnail, ytd-thumbnail a, ytd-thumbnail yt-image, yt-img-shadow, .yt-core-image { border-radius:16px !important; }
    .ytp-play-progress, .ytp-swatch-background-color { background:${accent} !important; }
    .ytp-scrubber-button { background:${accent} !important; }
    ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
    ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"],
    ytd-merch-shelf-renderer, ytd-display-ad-renderer, ytd-ad-slot-renderer, #masthead-ad, ytd-banner-promo-renderer,
    ytd-statement-banner-renderer, .ytp-ce-element, .ytp-endscreen-content { display:none !important; }
    ytd-video-renderer:hover, ytd-rich-item-renderer:hover { filter:drop-shadow(0 6px 18px ${accent}33); }`;
  if (mode !== 'fokus') return base;
  return base + `
    #secondary, ytd-comments#comments, #related, ytd-watch-next-secondary-results-renderer { display:none !important; }
    ytd-browse[page-subtype="home"] ytd-rich-grid-renderer #contents { display:none !important; }
    ytd-browse[page-subtype="home"] ytd-rich-grid-renderer::before { content:"Fokus-Modus: Suche nach dem, was du sehen willst."; display:block; margin:30vh auto 0; text-align:center; color:#b9b0c4; font:500 18px system-ui; }
    ytd-watch-flexy[flexy] #primary.ytd-watch-flexy { max-width:1400px !important; margin:0 auto; }`;
}

function ytScript(mode, accent) {
  const css = ytCss(mode, accent);
  const fn = (css, on) => {
    let st = document.getElementById('shield-yt');
    if (!st) { st = document.createElement('style'); st.id = 'shield-yt'; document.documentElement.appendChild(st); }
    st.textContent = css;
    if (on && !window.__shieldYtAds) {
      window.__shieldYtAds = setInterval(() => {
        const p = document.querySelector('.html5-video-player.ad-showing');
        const v = document.querySelector('video');
        if (p && v) { v.muted = true; v.playbackRate = 16; if (isFinite(v.duration)) v.currentTime = Math.max(v.currentTime, v.duration - 0.1); }
        document.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button').forEach(b => b.click());
      }, 400);
    } else if (!on && window.__shieldYtAds) { clearInterval(window.__shieldYtAds); window.__shieldYtAds = 0; }
  };
  return `(${fn})(${JSON.stringify(css)}, ${mode !== 'off'})`;
}

// ---------- Simulierter KI-Cursor ----------
function cursorScript(accent) {
  const fn = (accent) => {
    if (window.__shieldCursor) { window.__shieldCursor.show(); return; }
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform .9s cubic-bezier(.22,.8,.3,1);transform:translate(45vw,35vh)';
    // Ohne innerHTML aufgebaut: Seiten mit "Trusted Types" (z. B. YouTube) verbieten HTML als Text
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '28'); svg.setAttribute('height', '28'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.cssText = 'filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))';
    const arrow = document.createElementNS(NS, 'path');
    arrow.setAttribute('d', 'M4 2l15 9-6.5 1.5L9 19z'); arrow.setAttribute('fill', accent); arrow.setAttribute('stroke', '#fff'); arrow.setAttribute('stroke-width', '1.5'); arrow.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(arrow);
    const label = document.createElement('span');
    label.style.cssText = 'position:absolute;left:24px;top:22px;font:600 11px system-ui,sans-serif;background:' + accent + ';color:#fff;padding:2px 8px;border-radius:9px;white-space:nowrap';
    label.textContent = 'Shield KI';
    el.appendChild(svg); el.appendChild(label);
    el.setAttribute('data-shield-ui', '1'); // eigene Oberflaeche: wird bei der Seitenanalyse ignoriert
    document.documentElement.appendChild(el);
    let marked = null;
    // Statusleiste unten in der Seite: zeigt, woran die KI gerade arbeitet
    const css = document.createElement('style');
    css.textContent = '@keyframes shieldspin{to{transform:rotate(360deg)}}';
    document.documentElement.appendChild(css);
    const hudEl = document.createElement('div');
    hudEl.setAttribute('data-shield-ui', '1');
    hudEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(24px);z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:10px;padding:9px 16px 9px 13px;border-radius:999px;background:rgba(22,15,30,.92);border:1px solid rgba(217,183,122,.55);color:#f3e9ee;font:500 13px system-ui,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.45);opacity:0;transition:opacity .35s ease,transform .6s cubic-bezier(.22,1,.36,1);max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const spin = document.createElement('i');
    spin.style.cssText = 'flex:none;width:10px;height:10px;border-radius:50%;border:2px solid ' + accent + ';border-top-color:transparent;animation:shieldspin .8s linear infinite';
    const hudText = document.createElement('span'); hudText.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
    const hudCount = document.createElement('b'); hudCount.style.cssText = 'flex:none;font-weight:600;color:#d9b77a';
    hudEl.appendChild(spin); hudEl.appendChild(hudText); hudEl.appendChild(hudCount);
    document.documentElement.appendChild(hudEl);
    window.__shieldCursor = {
      show() { el.style.display = 'block'; },
      hide() { el.style.display = 'none'; this.unmark(); },
      label(t) { label.textContent = t; },
      move(x, y) { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; },
      // Fluggeschwindigkeit des Cursors (Sekunden pro Bewegung); beim Abarbeiten von Aufgaben schneller
      speed(sec) { el.style.transition = 'transform ' + sec + 's cubic-bezier(.22,.8,.3,1)'; },
      click(x, y) {
        const r = document.createElement('div');
        r.setAttribute('data-shield-ui', '1');
        r.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:10px;height:10px;border-radius:50%;border:2px solid ' + accent + ';left:' + (x - 5) + 'px;top:' + (y - 5) + 'px;transition:all .5s ease-out;opacity:1';
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => { r.style.transform = 'scale(5)'; r.style.opacity = '0'; });
        setTimeout(() => r.remove(), 600);
      },
      mark(e) {
        if (marked) { marked.style.outline = ''; marked.style.background = marked.__bg || ''; }
        marked = e; e.__bg = e.style.background;
        e.style.outline = '2px solid ' + accent; e.style.background = accent + '22'; e.style.borderRadius = '4px';
      },
      unmark() {
        if (marked) { marked.style.outline = ''; marked.style.background = marked.__bg || ''; marked = null; }
      },
      // Fundstelle hervorheben (Rechtecke in Viewport-Koordinaten), blendet nach ms wieder aus
      highlight(rects, ms) {
        for (const r of rects) {
          const d = document.createElement('div');
          d.setAttribute('data-shield-ui', '1');
          d.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:3px;opacity:0;transition:opacity .5s ease;left:' + (r.x - 2) + 'px;top:' + (r.y - 1) + 'px;width:' + (r.w + 4) + 'px;height:' + (r.h + 2) + 'px;background:' + accent + '33;outline:2px solid ' + accent;
          document.documentElement.appendChild(d);
          requestAnimationFrame(() => { d.style.opacity = '1'; });
          setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, ms || 4000);
        }
      },
      hud(text, i, n) {
        hudText.textContent = text; hudCount.textContent = n ? i + '/' + n : '';
        hudEl.style.opacity = '1'; hudEl.style.transform = 'translateX(-50%) translateY(0)';
      },
      hudHide() { hudEl.style.opacity = '0'; hudEl.style.transform = 'translateX(-50%) translateY(24px)'; }
    };
  };
  return `(${fn})(${JSON.stringify(accent)})`;
}

module.exports = { ACCENTS, particles, ytScript, cursorScript };
