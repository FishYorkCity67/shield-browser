'use strict';
// Shield – Oberflaeche, Teil 1: Grundlagen, Layout, Szene, Tabs, Adressleiste, Befehlspalette.
const S = window.shield;
const $ = id => document.getElementById(id);
const U = window.U = { S, $, state: { active: null, tabs: [], bookmarked: false }, settings: {}, CONST: {}, listeners: {} };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
Object.assign(U, { reduced, sleep });

U.on = (evt, fn) => { (U.listeners[evt] = U.listeners[evt] || []).push(fn); };
U.emit = (evt, p) => { for (const fn of U.listeners[evt] || []) { try { fn(p); } catch (e) { console.error(evt, e); } } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stagger = el => [...el.children].forEach((c, i) => c.style.setProperty('--i', i));
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
Object.assign(U, { esc, stagger, hostOf });

// ---------- Symbole ----------
const ic = (d, extra = '') => `<svg class="i" viewBox="0 0 24 24" ${extra}>${d}</svg>`;
const STAR = '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>';
const ICON = U.ICON = {
  back: ic('<path d="M19 12H5M11 6l-6 6 6 6"/>'), forward: ic('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  reload: ic('<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>'), stop: ic('<path d="M6 6l12 12M18 6L6 18"/>'), x: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'), star: ic(STAR), starOn: ic(STAR, 'style="fill:currentColor"'),
  sidebar: ic('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9 4.5v15"/>'),
  spark: ic('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
  shield: ic('<path d="M12 3l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z"/>'),
  shieldlock: ic('<path d="M12 3l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9.5a2 2 0 0 1 4 0V11"/>'),
  gear: ic('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  flower: ic('<g><ellipse cx="12" cy="6.4" rx="2.7" ry="3.6"/><ellipse cx="12" cy="6.4" rx="2.7" ry="3.6" transform="rotate(72 12 12)"/><ellipse cx="12" cy="6.4" rx="2.7" ry="3.6" transform="rotate(144 12 12)"/><ellipse cx="12" cy="6.4" rx="2.7" ry="3.6" transform="rotate(216 12 12)"/><ellipse cx="12" cy="6.4" rx="2.7" ry="3.6" transform="rotate(288 12 12)"/></g><circle cx="12" cy="12" r="1.5"/><path class="slash" d="M4 4l16 16"/>'),
  lock: ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  lockOpen: ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>'),
  globe: ic('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5z"/>'),
  search: ic('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  scroll: ic('<path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h6"/>'),
  copy: ic('<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  speaker: ic('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>'),
  speakerOff: ic('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9l4 6M21 9l-4 6"/>'),
  trash: ic('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  flip: ic('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  flag: ic('<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>'),
  page: ic('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>'),
  warn: ic('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.1"/>'),
  tab: ic('<rect x="4" y="6" width="16" height="12" rx="2.5"/><path d="M4 10h16"/>'),
  clock: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'),
  info: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>')
};
for (const el of document.querySelectorAll('[data-ic]')) el.innerHTML = ICON[el.dataset.ic] || '';
U.hydrateIcons = root => { for (const el of (root || document).querySelectorAll('[data-ic]')) el.innerHTML = ICON[el.dataset.ic] || ''; };

// ---------- Hinweise ----------
U.toast = (text, ms = 2800) => {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, ms);
};
S.on('toast', t => U.toast(t));
// Browser-Vollbild (F11): keine Fenstertasten mehr rechts oben
S.on('fullscreen', on => document.body.classList.toggle('fs', !!on));

// ---------- Design ----------
// Tageszeit-Farben fuer Berg, Sonne und Huegel: dieselben Werte wie auf der Startseite
const PHASES = {
  dawn: { '--s-sun': '#fff1c9', '--s-far': '#e0a3b5', '--s-fuji': '#8a7fa6', '--s-fuji2': '#a69bc4', '--s-snow': '#ffffff', '--s-hill': '#5a4262' },
  dusk: { '--s-sun': '#ffd9a8', '--s-far': '#7a3f78', '--s-fuji': '#3a2a58', '--s-fuji2': '#5a3d78', '--s-snow': '#f0d6e6', '--s-hill': '#2a1838' },
  night: { '--s-sun': '#f4f1ff', '--s-far': '#241f4e', '--s-fuji': '#151a3c', '--s-fuji2': '#212a55', '--s-snow': '#cfd8ff', '--s-hill': '#0a0d24' }
};
const phaseNow = () => { const h = new Date().getHours(); return h < 5 || h >= 21 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : 'dusk'; };

// Liquid Glass: ein Lichtreflex folgt dem Zeiger ueber Glasflaechen (setzt --mx/--my an der Flaeche unter dem Zeiger)
(function glassLight() {
  if (reduced) return;
  const SEL = '#omni, .ai-btn, #newtab, .tab, .fav-tile, #sidefoot .ib, .chip, .sug, .m.a, .mission, .workcard, .note, .lvl button, .stat, .wstats > div, .btn, .seg, #panel, #palette, #modal';
  let cur = null, raf = 0, ev = null;
  const clear = el => { if (el) { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); } };
  document.addEventListener('pointermove', e => {
    const t = e.target.closest ? e.target.closest(SEL) : null;
    if (cur && cur !== t) clear(cur);
    cur = t; ev = e;
    if (!t || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (!cur || !ev) return; const r = cur.getBoundingClientRect(); cur.style.setProperty('--mx', (ev.clientX - r.left) + 'px'); cur.style.setProperty('--my', (ev.clientY - r.top) + 'px'); });
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { clear(cur); cur = null; });
})();

// Szene: Fuji, ferne Berge und Huegel aus dem gemeinsamen Modul (fuji.js) – dieselbe Form wie auf der Startseite, Farben aus den CSS-Variablen
(function buildScene() {
  const F = window.ShieldFuji;
  if (!F || !$('sfuji')) return;
  $('sfar1').setAttribute('d', F.range({ x0: -100, x1: 1700, y: 700, amp: 150, seed: 4, step: 100 }));
  $('sfar2').setAttribute('d', F.range({ x0: -100, x1: 1700, y: 760, amp: 90, seed: 9, step: 70 }));
  $('sfuji').innerHTML = F.render({ cx: 112, baseY: 900, H: 470, L: 420, light: 1, id: 'sf', snowFrac: 0.3, v: { body: 'var(--s-fuji)', body2: 'var(--s-fuji2)', snow: 'var(--s-snow)', sun: 'var(--s-sun)', haze: 'var(--sc3)' } });
  $('sfoot').setAttribute('d', F.ridge({ x0: -100, x1: 1700, y: 800, amp: 34, wl: 210, seed: 2, bottom: 1000 }));
  $('shill').setAttribute('d', F.ridge({ x0: -100, x1: 1700, y: 852, amp: 28, wl: 300, seed: 7, bottom: 1000 }));
})();

function applyTheme() {
  const s = U.settings;
  const root = document.documentElement;
  root.dataset.fx = s.fx || 'sakura';
  root.dataset.mode = s.mode === 'sandbox' ? 'sandbox' : 'normal';
  for (const k of ['--s-sun', '--s-far', '--s-fuji', '--s-fuji2', '--s-snow', '--s-hill']) root.style.removeProperty(k);
  const ph = PHASES[phaseNow()];
  if (s.mode !== 'sandbox' && (s.fx || 'sakura') === 'sakura' && ph) for (const [k, v] of Object.entries(ph)) root.style.setProperty(k, v);
  document.title = s.mode === 'sandbox' ? 'Shield – Isolierter Modus' : 'Shield';
  startPetals();
}
setInterval(() => { if (U.settings && U.settings.fx) applyTheme(); }, 10 * 60 * 1000); // Tageszeit nachfuehren

// Fallende Blueten (Sakura), Schnee oder Laub hinter der Oberflaeche
let petalRaf = 0;
function startPetals() {
  cancelAnimationFrame(petalRaf);
  const c = $('petals'); const g = c.getContext('2d');
  const kind = U.settings.mode === 'sandbox' ? 'off' : (U.settings.fx || 'sakura');
  g.clearRect(0, 0, c.width, c.height);
  if (kind === 'off' || reduced) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;
  const resize = () => { W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize(); window.addEventListener('resize', resize);
  const PINK = ['#ffc1d9', '#ff9fc4', '#ffb3d0', '#ff86b4', '#ffd6e6'], LEAF = ['#e8742a', '#d9a21b', '#b5471c', '#c98a2b'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const make = init => ({ x: rnd(0, W), y: init ? rnd(-H, H) : rnd(-40, -8), s: kind === 'snow' ? rnd(1.2, 3.6) : rnd(4, 9), vy: rnd(.35, 1) * (kind === 'snow' ? .7 : 1), sw: rnd(.3, .9), ph: rnd(0, 6.28), r: rnd(0, 6.28), vr: rnd(-.025, .025), a: rnd(.35, .7), col: kind === 'sakura' ? PINK[(Math.random() * 5) | 0] : LEAF[(Math.random() * 4) | 0] });
  const list = Array.from({ length: kind === 'snow' ? 60 : 26 }, () => make(true));
  const petal = s => { g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(s * .7, -s * .3, s * .6, -s * 1.1, 0, -s * 1.2); g.bezierCurveTo(-s * .6, -s * 1.1, -s * .7, -s * .3, 0, 0); g.fill(); };
  const loop = () => {
    g.clearRect(0, 0, W, H);
    for (const p of list) {
      p.y += p.vy; p.ph += .018; p.x += Math.sin(p.ph) * p.sw; p.r += p.vr;
      if (p.y > H + 20 || p.x < -30 || p.x > W + 30) Object.assign(p, make(false));
      g.save(); g.globalAlpha = p.a; g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = kind === 'snow' ? '#fff' : p.col;
      if (kind === 'snow') { g.beginPath(); g.arc(0, 0, p.s, 0, 6.28); g.fill(); }
      else if (kind === 'sakura') { g.scale(1, .7); petal(p.s); }
      else { g.beginPath(); g.ellipse(0, 0, p.s, p.s * .55, 0, 0, 6.28); g.fill(); }
      g.restore();
    }
    petalRaf = requestAnimationFrame(loop);
  };
  loop();
}

// ---------- Layout: Seitenleiste und rechte Karte gleiten, die echte Seite folgt pro Frame ----------
const lay = U.lay = { side: 244, panel: 0 };
let layTween = 0;
function applyLay() {
  const C = U.CONST, r = document.documentElement.style;
  r.setProperty('--side', lay.side + 'px');
  r.setProperty('--panel', lay.panel + 'px');
  r.setProperty('--panelGap', lay.panel > 0 ? C.GAP + 'px' : '0px');
  document.body.classList.toggle('compact', lay.side < 150);
  const p = $('panel'), pr = lay.panel / C.PANEL_MAX;
  p.style.transform = `translateX(${(1 - pr) * (C.PANEL_MAX + C.GAP + 24)}px)`;
  p.style.opacity = String(Math.min(1, pr * 1.8));
  S.send('layout', { side: Math.round(lay.side), panel: Math.round(lay.panel) });
}
U.tweenLay = (target, ms = 440) => {
  cancelAnimationFrame(layTween);
  const from = { side: lay.side, panel: lay.panel };
  const to = { side: target.side == null ? lay.side : target.side, panel: target.panel == null ? lay.panel : target.panel };
  if (reduced || ms <= 0) { Object.assign(lay, to); applyLay(); return Promise.resolve(); }
  const t0 = performance.now();
  return new Promise(res => {
    const step = now => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 4);
      lay.side = from.side + (to.side - from.side) * e; lay.panel = from.panel + (to.panel - from.panel) * e;
      applyLay();
      if (p < 1) layTween = requestAnimationFrame(step); else res();
    };
    layTween = requestAnimationFrame(step);
  });
};

let sideOpen = true;
function setSide(open, animate = true) {
  sideOpen = open;
  U.tweenLay({ side: open ? U.CONST.SIDE_MAX : U.CONST.SIDE_MIN }, animate ? 420 : 0);
}
$('sidebtn').onclick = () => { setSide(!sideOpen); S.call('set-setting', 'side', sideOpen); };
S.on('toggle-side', () => $('sidebtn').click());

// ---------- Eroeffnung ----------
let introDone = false;
function runIntro() {
  if (introDone) return;
  introDone = true;
  const finish = () => { $('splash').classList.add('gone'); document.body.classList.remove('pre'); setTimeout(() => S.send('intro-done'), 380); };
  if (reduced) { finish(); return; }
  setTimeout(finish, 1350);
}
S.on('intro', () => { U.introFired = true; if (U.ready) runIntro(); });
setTimeout(() => { if (U.ready) runIntro(); }, 3800);

// ---------- Tabs (Seitenleiste) ----------
const tabEls = new Map();
let dragId = null;

function avatar(host) {
  let h = 0; for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { letter: (host.replace(/^www\./, '')[0] || '•').toUpperCase(), color: `hsl(${h} 42% 34%)` };
}
function favInner(t) {
  if (t.start) return U.settings.mode === 'sandbox' ? ICON.shieldlock : ICON.spark;
  if (t.favicon) return `<img src="${t.favicon}" alt="">`;
  const a = avatar(hostOf(t.url) || '?');
  return `<span style="color:#fff">${esc(a.letter)}</span>`;
}

function makeTab(t) {
  const d = document.createElement('div');
  d.className = 'tab enter';
  d.draggable = true;
  d.innerHTML = '<div class="fav"><i class="ring"></i><span class="fi"></span></div><div class="meta"><b class="ttl"></b><small class="hst"></small></div><span class="aud"></span><button class="x" aria-label="Tab schließen"></button>';
  d.querySelector('.x').innerHTML = ICON.x;
  d.onclick = () => S.call('switch-tab', t.id);
  d.onauxclick = e => { if (e.button === 1) { e.preventDefault(); S.call('close-tab', t.id); } };
  d.oncontextmenu = e => { e.preventDefault(); S.call('tab-menu', t.id); };
  d.querySelector('.x').onclick = e => { e.stopPropagation(); S.call('close-tab', t.id); };
  d.addEventListener('dragstart', e => { dragId = t.id; d.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); });
  d.addEventListener('dragend', () => { dragId = null; d.classList.remove('dragging'); for (const n of tabEls.values()) n.classList.remove('dragover'); });
  d.addEventListener('dragover', e => { if (dragId != null && dragId !== t.id) { e.preventDefault(); d.classList.add('dragover'); } });
  d.addEventListener('dragleave', () => d.classList.remove('dragover'));
  d.addEventListener('drop', e => {
    e.preventDefault(); d.classList.remove('dragover');
    const from = dragId; dragId = null;
    if (from == null || from === t.id) return;
    const ids = U.state.tabs.map(x => x.id).filter(i => i !== from);
    ids.splice(ids.indexOf(t.id), 0, from);
    S.call('reorder-tabs', ids);
  });
  setTimeout(() => d.classList.remove('enter'), 600);
  return d;
}

function renderTabs() {
  const el = $('tabs'), st = U.state;
  const ids = new Set(st.tabs.map(t => t.id));
  for (const [id, node] of tabEls) {
    if (!ids.has(id)) { tabEls.delete(id); node.classList.add('leave'); setTimeout(() => node.remove(), 320); }
  }
  let cursor = el.firstElementChild;
  for (const t of st.tabs) {
    let node = tabEls.get(t.id);
    if (!node) { node = makeTab(t); tabEls.set(t.id, node); }
    node.classList.toggle('active', t.id === st.active);
    node.classList.toggle('loading', !!t.loading);
    node.classList.toggle('audible', !!t.audible && !t.muted);
    node.classList.toggle('muted', !!t.muted);
    const title = t.start ? (U.settings.mode === 'sandbox' ? 'Isolierter Start' : 'Neuer Tab') : t.title;
    const ttl = node.querySelector('.ttl'); if (ttl.textContent !== title) ttl.textContent = title;
    const hst = node.querySelector('.hst'); const hv = t.start ? 'Startseite' : hostOf(t.url); if (hst.textContent !== hv) hst.textContent = hv;
    node.title = t.start ? title : `${t.title}\n${t.url}`;
    // Symbol nur neu setzen, wenn es sich geaendert hat
    const sig = (t.start ? 'start' : t.favicon ? 'img' + t.favicon.length : 'ltr' + hostOf(t.url)) + U.settings.mode;
    if (node.dataset.fav !== sig) { node.dataset.fav = sig; const fav = node.querySelector('.fav'); node.querySelector('.fi').innerHTML = favInner(t); fav.style.background = (!t.start && !t.favicon) ? avatar(hostOf(t.url) || '?').color : ''; }
    node.querySelector('.aud').innerHTML = t.muted ? ICON.speakerOff : t.audible ? ICON.speaker : '';
    while (cursor && cursor.classList.contains('leave')) cursor = cursor.nextElementSibling;
    if (cursor === node) cursor = cursor.nextElementSibling;
    else el.insertBefore(node, cursor || null);
  }
  renderBar();
}

// ---------- Werkzeugleiste ----------
const iconNow = {};
function setIcon(id, key) { if (iconNow[id] === key) return; iconNow[id] = key; $(id).innerHTML = ICON[key]; }

function renderBar() {
  const st = U.state, cur = st.tabs.find(t => t.id === st.active);
  if (cur) {
    $('back').disabled = !cur.canBack; $('fwd').disabled = !cur.canForward;
    setIcon('reload', cur.loading ? 'stop' : 'reload');
    $('load').classList.toggle('on', !!cur.loading);
    renderOmni(cur);
  }
  const wasOn = $('star').classList.contains('on');
  setIcon('star', st.bookmarked ? 'starOn' : 'star');
  $('star').classList.toggle('on', !!st.bookmarked);
  if (st.bookmarked && !wasOn) { const s = $('star'); s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); setTimeout(() => s.classList.remove('pop'), 600); }
  renderFx(cur);
  U.emit('tabs', st);
}

function renderOmni(cur) {
  const url = $('omni').querySelector('.url'), lock = $('omni').querySelector('.lock');
  if (cur.start) { url.className = 'url ph'; url.textContent = U.settings.mode === 'sandbox' ? 'Sicher suchen oder Adresse eingeben' : 'Suchen oder Adresse eingeben'; lock.setAttribute('class', 'i lock none'); lock.innerHTML = ICON.search.replace(/^<svg[^>]*>|<\/svg>$/g, ''); return; }
  let host = '', rest = '';
  try { const u = new URL(cur.url); host = u.hostname.replace(/^www\./, ''); rest = (u.pathname === '/' ? '' : u.pathname) + u.search; } catch { host = cur.url; }
  url.className = 'url';
  url.innerHTML = `<b>${esc(host)}</b><span>${esc(rest.length > 90 ? rest.slice(0, 90) + '…' : rest)}</span>`;
  const secure = cur.secure;
  lock.setAttribute('class', 'i lock' + (secure ? '' : ' warn'));
  lock.innerHTML = (secure ? ICON.lock : ICON.lockOpen).replace(/^<svg[^>]*>|<\/svg>$/g, '');
}

// ---------- Bluetenknopf: Entscheidung der lokalen KI ----------
const fxSeen = new Map();
let fxTimer = 0, lastActive = null;
const NOUN = { sakura: 'Blüten', snow: 'Schnee', leaves: 'Laub' };
const BY = { ai: 'KI', user: 'Du', regel: 'Regel' };
U.BY = BY; U.NOUN = NOUN;

function renderFx(cur) {
  const b = $('fxbtn'), f = cur && cur.fx;
  if (U.settings.mode === 'sandbox') return;
  const noun = NOUN[U.settings.fx] || 'Effekt';
  if (!b.dataset.ready) { b.dataset.ready = '1'; }
  if (U.settings.fx === 'off') {
    b.disabled = true; b.classList.add('fx-off'); b.classList.remove('thinking', 'open');
    b.title = 'Die Animation ist ausgeschaltet (Einstellungen → Erscheinung)';
    return;
  }
  b.disabled = !f || f.by === 'start';
  b.classList.toggle('fx-off', !!f && f.effect === 'hide' && !f.thinking);
  b.classList.toggle('thinking', !!(f && f.thinking));
  if (!f) { b.classList.remove('open'); b.title = 'Auf dieser Seite gibt es keine Animation'; return; }
  const label = b.querySelector('.lbl');
  const text = f.thinking ? '<b>KI</b> überlegt …' : `<b>${BY[f.by] || ''}</b> · ${noun} ${f.effect === 'show' ? 'bleiben' : 'aus'} · ${esc(f.reason)}`;
  b.title = f.thinking ? 'Die lokale KI entscheidet gerade' : `${noun} ${f.effect === 'show' ? 'sichtbar' : 'ausgeblendet'} – ${f.reason} (${BY[f.by] || 'Standard'}). Klick: umschalten · Rechtsklick: KI neu entscheiden lassen`;
  const prev = fxSeen.get(cur.id);
  const now = { host: f.host, thinking: !!f.thinking, effect: f.effect, by: f.by };
  fxSeen.set(cur.id, now);
  const changedTab = lastActive !== cur.id; lastActive = cur.id;
  if (f.by === 'start') { b.classList.remove('open'); return; }
  const same = prev && prev.host === now.host && prev.thinking === now.thinking && prev.effect === now.effect && prev.by === now.by;
  const event = now.thinking || (prev && prev.host === now.host && !same);
  if (event && !same) {
    label.innerHTML = text; clearTimeout(fxTimer); b.classList.add('open');
    if (!now.thinking) fxTimer = setTimeout(() => b.classList.remove('open'), 4200);
  } else if (changedTab || !prev || prev.host !== now.host) {
    clearTimeout(fxTimer); b.classList.toggle('open', now.thinking);
    if (now.thinking) label.innerHTML = text; else setTimeout(() => { label.innerHTML = text; }, 400);
  }
}
$('fxbtn').onclick = () => S.call('fx-toggle');
$('fxbtn').oncontextmenu = e => { e.preventDefault(); S.call('fx-reset'); };

$('back').onclick = () => S.call('back');
$('fwd').onclick = () => S.call('forward');
$('reload').onclick = () => S.call('reload');
$('star').onclick = () => S.call('bookmark');
$('newtab').onclick = () => { S.call('new-tab'); };
$('omni').onclick = () => U.openPalette(U.state.tabs.find(t => t.id === U.state.active)?.start ? '' : (U.state.tabs.find(t => t.id === U.state.active)?.url || ''));

S.on('tabs', s => { U.state = s; renderTabs(); renderFavs(); });
S.on('blocked', n => U.emit('blocked', n));
S.on('settings', s => { U.settings = s; applyTheme(); renderTabs(); U.emit('settings', s); });
S.on('bookmarks-changed', () => renderFavs());

// ---------- Favoriten ----------
async function renderFavs() {
  if (U.settings.mode === 'sandbox') return;
  const lists = await S.call('get-lists');
  const box = $('favs');
  const key = JSON.stringify(lists.bookmarks.map(b => b.url));
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  $('favhead').style.display = lists.bookmarks.length ? '' : 'none';
  for (const b of lists.bookmarks.slice(0, 16)) {
    const d = document.createElement('div');
    d.className = 'fav-tile'; d.title = `${b.title}\n${b.url}`;
    d.innerHTML = b.favicon ? `<img src="${b.favicon}" alt="">` : `<span style="font-weight:600">${esc(avatar(hostOf(b.url) || '?').letter)}</span>`;
    d.onclick = () => S.call('navigate', b.url);
    d.oncontextmenu = e => { e.preventDefault(); S.call('remove-bookmark', b.url); U.toast('Lesezeichen entfernt'); };
    box.appendChild(d);
  }
}

// ---------- Overlay: Befehlspalette und Dialoge liegen ueber einem unscharfen Standbild ----------
let overlayOpen = null, overlayBusy = false;
async function openOverlay(kind) {
  if (overlayOpen || overlayBusy) return false;
  overlayBusy = true;
  try {
    const snap = await S.call('snap');
    const img = $('snapimg');
    if (snap) { img.src = snap; try { await img.decode(); } catch {} }
    img.style.display = snap ? 'block' : 'none';
    await S.call('view-hide');
    $('overlay').classList.add('open'); $(kind).classList.add('on');
    overlayOpen = kind;
    return true;
  } finally { overlayBusy = false; }
}
async function closeOverlay() {
  if (!overlayOpen) return;
  const kind = overlayOpen; overlayOpen = null;
  $(kind).classList.remove('on'); $('overlay').classList.remove('open');
  await sleep(280);
  if (!overlayOpen) await S.call('view-show');
}
Object.assign(U, { openOverlay, closeOverlay, isOverlay: () => overlayOpen });
$('veil').onclick = () => closeOverlay();
$('snapbox').onclick = () => closeOverlay();

U.openModal = async (html, onMount) => {
  if (!(await openOverlay('modal'))) return;
  $('modal').innerHTML = html; U.hydrateIcons($('modal'));
  if (onMount) onMount($('modal'));
};

// ---------- Befehlspalette ----------
let palItems = [], palSel = 0, palSeq = 0;
const looksLikeUrl = q => /^(https?:\/\/\S+|[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?|localhost(:\d+)?(\/\S*)?)$/i.test(q.trim());

function commands() {
  const sb = U.settings.mode === 'sandbox';
  const list = [
    { label: 'Neuer Tab', sub: 'Strg T', ic: 'plus', run: () => S.call('new-tab') },
    { label: 'Seitenleiste ein- oder ausblenden', sub: 'Strg B', ic: 'sidebar', run: () => $('sidebtn').click() },
    { label: 'Einstellungen', sub: '', ic: 'gear', run: () => U.openPanel(sb ? 'shield' : 'menu') }
  ];
  if (!sb) list.push(
    { label: 'Orakel öffnen (KI)', sub: 'Strg J', ic: 'spark', run: () => U.openPanel('chat') },
    { label: 'Isolierten Modus starten', sub: 'Strg Umschalt N', ic: 'shieldlock', run: () => U.sandboxDialog() },
    { label: 'Lesezeichen setzen oder entfernen', sub: 'Strg D', ic: 'star', run: () => S.call('bookmark') },
    { label: 'Chronik der Aufgaben', sub: '', ic: 'scroll', run: () => U.openPanel('notes') });
  else list.push({ label: 'Alle Spuren jetzt vernichten', sub: '', ic: 'trash', run: () => U.wipe() });
  return list;
}

function buildItems(q, data) {
  const out = [];
  const sb = U.settings.mode === 'sandbox';
  q = q.trim();
  if (q) {
    if (looksLikeUrl(q)) out.push({ group: 'Gehe zu', ic: 'globe', title: q, sub: 'Seite öffnen', kbd: '↵', run: () => S.call('navigate', q) });
    out.push({ group: out.length ? '' : 'Suche', ic: 'search', title: q, sub: sb ? 'Suchen (DuckDuckGo, ohne Skripte)' : 'Im Web suchen', kbd: looksLikeUrl(q) ? '' : '↵', run: () => S.call('search', q) });
    if (!sb && q.length > 2) out.push({ group: '', ic: 'spark', title: `Orakel: „${q.length > 60 ? q.slice(0, 57) + '…' : q}“`, sub: 'Lokale KI fragen oder beauftragen', run: () => { U.openPanel('chat'); U.askAI(q); } });
  }
  const g = (name, arr, mk) => arr.forEach((x, i) => out.push({ group: i === 0 ? name : '', ...mk(x) }));
  g('Offene Tabs', data.tabs, t => ({ ic: 'tab', img: t.favicon, title: t.title, sub: hostOf(t.url), run: () => S.call('switch-tab', t.id) }));
  g('Lesezeichen', data.bookmarks, b => ({ ic: 'star', img: b.favicon, title: b.title, sub: hostOf(b.url), run: () => S.call('navigate', b.url) }));
  g('Verlauf', data.history, h => ({ ic: 'clock', title: h.title, sub: hostOf(h.url), run: () => S.call('navigate', h.url) }));
  const ql = q.toLowerCase();
  const cmds = commands().filter(c => !q || c.label.toLowerCase().includes(ql));
  cmds.forEach((c, i) => out.push({ group: i === 0 ? 'Befehle' : '', ic: c.ic, title: c.label, sub: '', kbd: c.sub, run: c.run }));
  return out;
}

function renderPalette() {
  const box = $('plist'); box.innerHTML = '';
  if (!palItems.length) { box.innerHTML = '<div class="empty" style="padding:16px">Nichts gefunden.</div>'; return; }
  palItems.forEach((it, i) => {
    if (it.group) { const g = document.createElement('div'); g.className = 'pgroup'; g.textContent = it.group; box.appendChild(g); }
    const d = document.createElement('div');
    d.className = 'pitem' + (i === palSel ? ' sel' : ''); d.dataset.i = i;
    d.innerHTML = `<div class="pi">${it.img ? `<img src="${it.img}" alt="">` : ICON[it.ic] || ''}</div><div class="pt"><b>${esc(it.title)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}`;
    d.onmouseenter = () => selectPal(i, false);
    d.onclick = () => runPal(i);
    box.appendChild(d);
  });
}
function selectPal(i, scroll = true) {
  palSel = Math.max(0, Math.min(palItems.length - 1, i));
  for (const n of $('plist').querySelectorAll('.pitem')) n.classList.toggle('sel', +n.dataset.i === palSel);
  if (scroll) $('plist').querySelector('.pitem.sel')?.scrollIntoView({ block: 'nearest' });
}
async function refreshPalette() {
  const q = $('pq').value, seq = ++palSeq;
  const data = await S.call('palette-query', q);
  if (seq !== palSeq) return;
  palItems = buildItems(q, data); palSel = 0; renderPalette();
}
async function runPal(i) {
  const it = palItems[i]; if (!it) return;
  await it.run();
  closeOverlay();
}
U.openPalette = async (prefill = '') => {
  if (overlayOpen === 'palette') { $('pq').focus(); $('pq').select(); return; }
  if (!(await openOverlay('palette'))) return;
  $('pq').value = prefill; refreshPalette();
  setTimeout(() => { $('pq').focus(); $('pq').select(); }, 60);
};
$('pq').oninput = () => refreshPalette();
$('pq').onkeydown = e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectPal(palSel + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectPal(palSel - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
};
S.on('palette', url => U.openPalette(url && !/start\.html/.test(url) ? url : ''));

// ---------- Tastenkuerzel ----------
document.addEventListener('keydown', e => {
  const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.key === 'Escape' && overlayOpen) { e.preventDefault(); closeOverlay(); return; }
  if (c && (k === 'k' || k === 'l')) { e.preventDefault(); const cur = U.state.tabs.find(t => t.id === U.state.active); U.openPalette(cur && !cur.start ? cur.url : ''); }
  else if (c && k === 'j') { e.preventDefault(); U.openPanel('chat', true); }
  else if (c && k === 'b') { e.preventDefault(); $('sidebtn').click(); }
  else if (c && e.shiftKey && k === 'n') { e.preventDefault(); U.sandboxDialog && U.sandboxDialog(); }
  else if (c && !e.shiftKey && k === 't') { e.preventDefault(); S.call('new-tab'); }
  else if (c && k === 'w') { e.preventDefault(); S.call('close-tab', U.state.active); }
});
S.on('toggle-ai', () => U.openPanel('chat', true));
S.on('sandbox-dialog', () => U.sandboxDialog && U.sandboxDialog());

// ---------- Start ----------
(async function init() {
  // Erst starten, wenn alle Skripte (auch panel.js) geladen sind und ihre Ereignisse angemeldet haben
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  U.CONST = await S.call('layout-consts');
  const C = U.CONST, r = document.documentElement.style;
  r.setProperty('--GAP', C.GAP + 'px'); r.setProperty('--RADIUS', C.RADIUS + 'px'); r.setProperty('--PANEL', C.PANEL_MAX + 'px');
  if (C.sandbox) document.documentElement.dataset.mode = 'sandbox';
  U.settings = await S.call('get-settings');
  applyTheme();
  sideOpen = U.settings.side !== false;
  lay.side = sideOpen ? C.SIDE_MAX : C.SIDE_MIN; lay.panel = 0; applyLay();
  U.emit('init', C);
  try { const ts = await S.call('get-tabs'); if (ts && ts.tabs && ts.tabs.length) { U.state = ts; renderTabs(); renderFavs(); } } catch {}
  U.ready = true;
  if (U.introFired) runIntro();
})();
