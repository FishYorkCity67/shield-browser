// Gemeinsame Bausteine fuer die Agenten: Seitenskripte, Cursor-Handgriffe, Navigation, Kopieren.
const { sleep, go, cursor, Aborted } = require('./agent');
const enc = encodeURIComponent;

// ---------- Bekannte Seiten mit Such-Adresse und Trefferlinks ----------
const SITES = {
  youtube:   { label: 'YouTube',     url: q => `https://www.youtube.com/results?search_query=${enc(q)}&sp=EgIQAQ%253D%253D`, ready: 'ytd-video-renderer', result: 'ytd-video-renderer a#video-title' },
  wikipedia: { label: 'Wikipedia',   url: q => `https://de.wikipedia.org/w/index.php?search=${enc(q)}&go=Go`, ready: '#firstHeading', result: '.mw-search-result-heading a' },
  web:       { label: 'DuckDuckGo',  url: q => `https://html.duckduckgo.com/html/?q=${enc(q)}`, ready: 'a.result__a', result: 'a.result__a' },
  images:    { label: 'Bildersuche', url: q => `https://duckduckgo.com/?q=${enc(q)}&iax=images&ia=images`, ready: null, result: null },
  maps:      { label: 'Karte',       url: q => `https://www.openstreetmap.org/search?query=${enc(q)}`, ready: null, result: null },
  github:    { label: 'GitHub',      url: q => `https://github.com/search?q=${enc(q)}&type=repositories`, ready: null, result: null },
  reddit:    { label: 'Reddit',      url: q => `https://www.reddit.com/search/?q=${enc(q)}`, ready: null, result: null },
  amazon:    { label: 'Amazon',      url: q => `https://www.amazon.de/s?k=${enc(q)}`, ready: '[data-component-type="s-search-result"]', result: '[data-component-type="s-search-result"] h2 a' },
  ebay:      { label: 'eBay',        url: q => `https://www.ebay.de/sch/i.html?_nkw=${enc(q)}`, ready: null, result: null },
  twitch:    { label: 'Twitch',      url: q => `https://www.twitch.tv/search?term=${enc(q)}`, ready: null, result: null },
  spotify:   { label: 'Spotify',     url: q => `https://open.spotify.com/search/${enc(q)}`, ready: null, result: null }
};

// ---------- Kleine Helfer ----------
const str = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
function normUrl(u) {
  u = String(u || '').trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; }
}
// Heikle Schaltflaechen (Kaufen, Senden, Loeschen ...) loesen eine Rueckfrage aus. Nur kurze Beschriftungen zaehlen.
const RISKY = /(kaufen|bestell|bezahl|zahlungspflichtig|buchen|löschen|loeschen|entfernen|abschicken|absenden|senden|veröffentlich|posten|überweis|ueberweis|abonnier|kündigen|kuendigen|zustimmen|akzeptieren|bestätigen|bestaetigen|buy|purchase|order|pay|checkout|delete|remove|submit|send|publish|post|subscribe|confirm|accept|agree)/i;
const isRisky = text => !!text && text.length <= 40 && RISKY.test(text);

const STOP = new Set(('der die das den dem des ein eine einen einem und oder aber mit von für fuer auf aus bei nach über ueber unter vor zu zum zur im in ist sind war wird wurde hat haben kann können koennen soll sollen bitte mir mich dir dich uns sich es sie er wir ihr ' +
  'kopiere kopier kopieren öffne oeffne öffnen suche such suchen seite seiten dieser diese dieses diesen schreib schreibe mach mache wie viel viele wer was wo wann warum welche welcher welches gib gebe nenne sage sag mir dann danach auch noch the and for with from this that what how many much open copy find get give').split(' '));
const keywords = text => [...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || []).filter(w => !STOP.has(w)))].slice(0, 12);

// Waehlt aus dem langen Seitentext die Stellen, die zum Ziel passen (plus Anfang der Seite)
function buildExcerpt(full, goal, max = 2600) {
  const lines = String(full).split('\n').map(s => s.trim()).filter(Boolean).map(s => s.slice(0, 320));
  const head = []; let used = 0;
  for (const l of lines) { if (used > 600) break; head.push(l); used += l.length; }
  const kws = keywords(goal);
  const scored = [];
  lines.forEach((l, i) => { if (i < head.length) return; const low = l.toLowerCase(); const s = kws.reduce((a, k) => a + (low.includes(k) ? 1 : 0), 0); if (s) scored.push({ i, s }); });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const picked = new Set();
  for (const x of scored) {
    if (used > max) break;
    for (const j of [x.i - 1, x.i, x.i + 1]) if (j >= head.length && j < lines.length && !picked.has(j)) { picked.add(j); used += lines[j].length; }
  }
  const mid = [...picked].sort((a, b) => a - b).map(j => lines[j]);
  return head.join('\n') + (mid.length ? '\n…\n' + mid.join('\n') : '');
}

const RAF2 = 'await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));';
const VIS = `const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 6 && r.height > 6 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.right > 0 && r.left < innerWidth; };`;

// ---------- Bausteine, die in der Seite laufen ----------
const pickJs = (sel, n) => `(async () => {
  ${VIS}
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => vis(e) && !e.closest('ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,.result--ad,[data-ad]'));
  const a = els[${n - 1}];
  if (!a) return null;
  a.scrollIntoView({ block: 'center' });
  ${RAF2}
  const r = a.getBoundingClientRect();
  if (window.__shieldCursor) window.__shieldCursor.mark(a);
  return { x: r.left + Math.min(Math.max(r.width - 10, 10), 40 + Math.random() * 90), y: r.top + Math.min(r.height / 2, 20), href: a.href || '', text: (a.innerText || a.getAttribute('title') || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100) };
})()`;

const findByTextJs = text => `(async () => {
  ${VIS}
  const want = ${JSON.stringify(text.toLowerCase())};
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  let best = null, score = 0;
  for (const e of document.querySelectorAll('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],summary')) {
    if (!vis(e)) continue;
    const t = clean(e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title'));
    if (!t) continue;
    let s = 0;
    if (t === want) s = 100; else if (t.startsWith(want)) s = 80; else if (t.includes(want)) s = 60 - Math.min(40, t.length - want.length);
    if (s > score) { score = s; best = e; }
  }
  if (!best) return null;
  best.scrollIntoView({ block: 'center' });
  ${RAF2}
  const r = best.getBoundingClientRect();
  if (window.__shieldCursor) window.__shieldCursor.mark(best);
  const t = clean(best.innerText || best.value || best.getAttribute('aria-label') || best.getAttribute('title'));
  return { x: r.left + Math.min(Math.max(r.width / 2, 8), 120), y: r.top + r.height / 2, href: best.href || '', text: t.slice(0, 80), tag: best.tagName.toLowerCase() };
})()`;

const findInputJs = () => `(async () => {
  ${VIS}
  const els = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]),textarea')].filter(vis);
  const e = els.find(x => /search|such|query|q$/i.test((x.name || '') + ' ' + (x.id || '') + ' ' + (x.placeholder || '') + ' ' + (x.getAttribute('aria-label') || ''))) || els[0];
  if (!e) return null;
  e.scrollIntoView({ block: 'center' });
  ${RAF2}
  const r = e.getBoundingClientRect();
  if (window.__shieldCursor) window.__shieldCursor.mark(e);
  const type = (e.getAttribute('type') || '').toLowerCase(), ac = (e.getAttribute('autocomplete') || '').toLowerCase();
  return { x: r.left + Math.min(Math.max(r.width / 2, 10), 160), y: r.top + r.height / 2, secret: type === 'password' || /cc-|one-time-code|password/.test(ac), editable: true, submitLabel: '', isSearch: type === 'search' || /search|such|query/i.test((e.name || '') + ' ' + (e.id || '') + ' ' + (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '')) };
})()`;

const byIdJs = id => `(async () => {
  const e = document.querySelector('[data-shield-id="${id}"]');
  if (!e) return null;
  e.scrollIntoView({ block: 'center' });
  ${RAF2}
  const r = e.getBoundingClientRect();
  if (window.__shieldCursor) window.__shieldCursor.mark(e);
  const tag = e.tagName.toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase();
  const field = tag === 'input' || tag === 'textarea';
  const label = (field ? (e.getAttribute('aria-label') || e.placeholder || e.name || e.title || '') : (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '')) + '';
  const ac = (e.getAttribute('autocomplete') || '').toLowerCase();
  const sb = e.form && e.form.querySelector('button[type=submit],input[type=submit],button:not([type])');
  return { x: r.left + Math.min(Math.max(r.width / 2, 8), 160), y: r.top + r.height / 2, href: e.href || '', text: label.replace(/\\s+/g, ' ').trim().slice(0, 80), tag, type, editable: field || e.isContentEditable, secret: type === 'password' || /cc-|one-time-code|password/.test(ac), isSearch: type === 'search' || /search|such|query/i.test((e.name || '') + ' ' + (e.id || '') + ' ' + (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '')), submitLabel: sb ? ((sb.innerText || sb.value || sb.getAttribute('aria-label') || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 40) : '' };
})()`;

// Beschreibt die Seite fuer die KI: kompletter Text plus durchnummerierte, bedienbare Elemente (bis 300)
const OBSERVE_JS = `(() => {
  ${VIS}
  document.querySelectorAll('[data-shield-id]').forEach(e => e.removeAttribute('data-shield-id'));
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const items = [];
  for (const e of document.querySelectorAll('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],input:not([type=hidden]),textarea,select,summary')) {
    if (items.length >= 300) break;
    if (!vis(e) || e.disabled || e.closest('[aria-hidden="true"]')) continue;
    const tag = e.tagName.toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase();
    const field = tag === 'input' || tag === 'textarea';
    const text = field ? clean(e.getAttribute('aria-label') || e.placeholder || e.name || e.title || e.id)
      : clean(e.innerText) || clean(e.getAttribute('aria-label')) || clean(e.getAttribute('title')) || clean((e.querySelector('img') || {}).alt);
    if (!text && !field) continue;
    const r = e.getBoundingClientRect();
    const kind = tag === 'a' ? 'link' : field ? (type === 'password' ? 'password-field' : 'input' + (type && type !== 'text' ? '(' + type + ')' : '')) : tag === 'select' ? 'dropdown' : 'button';
    const id = items.length + 1;
    e.setAttribute('data-shield-id', id);
    items.push({ id, kind, text: text.slice(0, 70), inView: r.top < innerHeight && r.bottom > 0, top: Math.round(r.top) });
  }
  const main = document.querySelector('main,article,[role=main]') || document.body;
  const full = (main.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 60000);
  return { title: document.title, url: location.href, full, els: items, scrollY: Math.round(scrollY), height: document.documentElement.scrollHeight, vh: innerHeight };
})()`;

// Sucht eine Textstelle auf der Seite (Leerzeichen/Gross-Kleinschreibung egal), scrollt hin und liefert die Rechtecke
const locateJs = (snippet, select) => `(async () => {
  const want = ${JSON.stringify(String(snippet))}.replace(/\\s+/g, ' ').trim().toLowerCase();
  if (!want) return null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => {
    const p = n.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
    const t = p.tagName; if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
    const cs = getComputedStyle(p); if (cs.visibility === 'hidden' || cs.display === 'none') return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT; } });
  let full = ''; const mn = [], mo = [];
  const add = (ch, node, off) => { full += ch; mn.push(node); mo.push(off); };
  let node;
  while ((node = walker.nextNode())) {
    const v = node.nodeValue;
    if (full.length && full[full.length - 1] !== ' ') add(' ', node, 0);
    for (let i = 0; i < v.length; i++) {
      const c = v[i];
      if (/\\s/.test(c)) { if (full.length && full[full.length - 1] !== ' ') add(' ', node, i); }
      else add(c.toLowerCase(), node, i);
    }
  }
  let idx = full.indexOf(want), len = want.length, approx = false;
  if (idx < 0 && want.length > 40) { idx = full.indexOf(want.slice(0, 40)); len = Math.min(want.length, full.length - idx); approx = true; }
  if (idx < 0 && want.length > 20) { idx = full.indexOf(want.slice(0, 20)); len = Math.min(want.length, full.length - idx); approx = true; }
  if (idx < 0) return null;
  const range = document.createRange();
  range.setStart(mn[idx], mo[idx]);
  const e = Math.min(idx + len - 1, mn.length - 1);
  range.setEnd(mn[e], Math.min(mo[e] + 1, mn[e].nodeValue.length));
  const host = range.startContainer.parentElement;
  if (host) host.scrollIntoView({ block: 'center' });
  ${RAF2}
  if (${select ? 'true' : 'false'}) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1).slice(0, 14).map(r => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  if (!rects.length) return null;
  const first = rects[0], last = rects[rects.length - 1];
  return { rects, x1: first.x + 2, y1: first.y + first.h / 2, x2: last.x + last.w - 2, y2: last.y + last.h / 2, text: range.toString().replace(/\\s+/g, ' ').trim().slice(0, 400), approx };
})()`;

const SWEEP_JS = `(() => {
  ${VIS}
  const ps = [...document.querySelectorAll('p,li,h2,h3,td')].filter(e => { const r = e.getBoundingClientRect(); return vis(e) && r.width > 160 && r.height > 12 && r.top > 60 && r.bottom < innerHeight - 20 && (e.innerText || '').length > 25; });
  const e = ps[Math.floor(Math.random() * Math.min(ps.length, 6))];
  if (!e) return null;
  const r = e.getBoundingClientRect();
  if (window.__shieldCursor) window.__shieldCursor.mark(e);
  return { x: r.left + 20 + Math.random() * Math.min(r.width - 40, 320), y: r.top + Math.min(r.height / 2, 24) };
})()`;

// ---------- Cursor-Handgriffe ----------
async function moveTo(w, ctx, x, y) {
  await cursor(w, ctx.accent, `window.__shieldCursor.move(${x},${y})`);
  await sleep(ctx.cursorMs || 1000, ctx.signal); // beim Abarbeiten von Aufgaben fliegt der Cursor schneller
}
async function clickAt(w, ctx, x, y) {
  await cursor(w, ctx.accent, `window.__shieldCursor.click(${x},${y})`);
  const px = Math.round(x), py = Math.round(y);
  w.sendInputEvent({ type: 'mouseMove', x: px, y: py });
  await sleep(ctx.cursorMs ? 90 : 160, ctx.signal);
  w.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 });
  w.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
}
const setLabel = (w, ctx, label) => cursor(w, ctx.accent, `window.__shieldCursor.label(${JSON.stringify(label)})`);
const hud = (w, ctx, text, i, n) => cursor(w, ctx.accent, `window.__shieldCursor.hud(${JSON.stringify(text)}, ${i || 0}, ${n || 0})`);
const hideCursor = (w, ctx) => w && !w.isDestroyed() ? cursor(w, ctx.accent, 'window.__shieldCursor.hide(); window.__shieldCursor.hudHide();') : null;

// Faehrt zum Ziel, klickt echt und prueft, ob etwas passiert ist. true = Seite oder Tab hat gewechselt.
async function clickTarget(w, ctx, t, label) {
  const before = w.getURL();
  const tabsBefore = ctx.tabCount ? ctx.tabCount() : 0;
  await setLabel(w, ctx, label);
  await moveTo(w, ctx, t.x, t.y);
  await clickAt(w, ctx, t.x, t.y);
  // Im schnellen Modus (Aufgaben) bei Nicht-Links nur kurz hinsehen, ob die Seite gewechselt hat
  const quick = !!ctx.cursorMs;
  const tries = quick && !t.href ? 1 : 10, gap = quick ? 200 : 300;
  for (let i = 0; i < tries; i++) {
    await sleep(gap, ctx.signal);
    if (w.getURL() !== before || (ctx.tabCount && ctx.tabCount() > tabsBefore)) return true;
  }
  // Link ohne Wirkung: direkt zur Adresse gehen (nur echte Web-Links, keine Anker)
  if (t.href && /^https?:/.test(t.href) && t.href.split('#')[0] !== before.split('#')[0]) { await go(w, t.href, ctx.signal); return true; }
  return false;
}

function pressEnter(w) {
  w.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  w.sendInputEvent({ type: 'char', keyCode: 'Enter' });
  w.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
}

// Tippt in ein Feld (Ziel mit x/y), ersetzt vorhandenen Text. Fragt bei heiklen Formularen nach.
async function typeInto(w, ctx, t, text, submit) {
  if (t.secret) return { ok: false, why: 'Passwörter und Zahlungsdaten gebe ich nicht ein.' };
  if (submit && isRisky(t.submitLabel) && !(ctx.confirm && await ctx.confirm(`Soll ich das Formular mit „${t.submitLabel}“ abschicken?`))) submit = false;
  await setLabel(w, ctx, 'Tippe ...');
  await moveTo(w, ctx, t.x, t.y);
  await clickAt(w, ctx, t.x, t.y);
  await sleep(250, ctx.signal);
  w.selectAll();
  w.insertText(text);
  if (submit) { await sleep(500, ctx.signal); pressEnter(w); await settle(w, ctx); }
  return { ok: true };
}

async function scrollPage(w, ctx, dir) {
  await setLabel(w, ctx, 'Scrolle ...');
  await cursor(w, ctx.accent, 'window.__shieldCursor.move(innerWidth * 0.8, innerHeight * 0.5)');
  const js = {
    down: 'window.scrollBy({ top: innerHeight * 0.75, behavior: "smooth" })', up: 'window.scrollBy({ top: -innerHeight * 0.75, behavior: "smooth" })',
    top: 'window.scrollTo({ top: 0, behavior: "smooth" })', bottom: 'window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })'
  }[dir] || 'window.scrollBy({ top: innerHeight * 0.75, behavior: "smooth" })';
  await w.executeJavaScript(js).catch(() => {});
  await sleep(900, ctx.signal);
}

async function waitFor(w, sel, ms, signal) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await w.executeJavaScript(`!!document.querySelector(${JSON.stringify(sel)})`)) return true; } catch {}
    await sleep(350, signal);
  }
  return false;
}

// Cookie-/Einwilligungsabfragen: die datensparsamste Wahl (ablehnen) treffen
async function dismissConsent(w, ctx) {
  try {
    const clicked = await w.executeJavaScript(`(() => {
      const txt = ((document.body && document.body.innerText) || '').toLowerCase() + ' ' + location.hostname;
      if (!/consent|cookie|datenschutz|privacy/.test(txt)) return false;
      const re = /^(alle ablehnen|alles ablehnen|ablehnen|nur erforderliche( cookies)?|nur notwendige( cookies)?|reject all|decline all|deny all|alle cookies ablehnen)$/i;
      const b = [...document.querySelectorAll('button,[role=button],input[type=submit],a')].find(e => re.test(((e.innerText || e.value || e.getAttribute('aria-label') || '') + '').trim()));
      if (!b) return false;
      setTimeout(() => b.click(), 60);
      return true;
    })()`);
    if (clicked) await sleep(2200, ctx.signal);
    return !!clicked;
  } catch { return false; }
}

// Startet das Video und wartet, bis wirklich Bild laeuft ('playing'), es noch puffert ('loading') oder pausiert ist
async function ensurePlaying(w) {
  return w.executeJavaScript(`(async () => {
    const pick = () => [...document.querySelectorAll('video')].sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0];
    const v0 = pick();
    if (!v0) return 'none';
    try { if (v0.paused) await v0.play(); } catch (e) {}
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      const v = pick();
      if (v && !v.paused && v.currentTime > 0.3) return 'playing';
    }
    const v = pick();
    return v && !v.paused ? 'loading' : 'paused';
  })()`).catch(() => 'error');
}

async function settle(w, ctx) {
  await sleep(900, ctx.signal);
  const t0 = Date.now();
  while (w.isLoading() && Date.now() - t0 < 10000) await sleep(300, ctx.signal);
  await sleep(400, ctx.signal);
}
// Kurze Variante fuer schnelle Abfolgen (Aufgaben abarbeiten)
async function settleFast(w, ctx, ms = 350) {
  await sleep(ms, ctx.signal);
  const t0 = Date.now();
  while (w.isLoading() && Date.now() - t0 < 8000) await sleep(200, ctx.signal);
  await sleep(120, ctx.signal);
}

// Navigiert und raeumt Cookie-Abfragen weg
async function nav(w, ctx, url) {
  await go(w, url, ctx.signal);
  await dismissConsent(w, ctx);
  await setLabel(w, ctx, 'Schaue nach ...');
}

// Oeffnet das n-te Ergebnis einer Seitensuche mit dem Cursor. Gibt eine kurze Beschreibung zurueck.
async function openResult(w, ctx, siteKey, n, log) {
  const site = SITES[siteKey];
  if (!site || !site.result) { log('Ergebnisse angezeigt'); return false; }
  if (siteKey === 'wikipedia' && !/[?&]search=/.test(w.getURL())) { log('Artikel geöffnet: ' + w.getTitle().replace(/ – Wikipedia$/, '')); return true; }
  // Seiten wie YouTube bauen die Treffer erst nach dem Laden auf: bis zu ~10 s auf sichtbare Treffer warten
  let pick = null;
  for (let i = 0; i < 14 && !pick; i++) {
    pick = await cursor(w, ctx.accent, pickJs(site.result, n));
    if (!pick) await sleep(700, ctx.signal);
  }
  if (!pick) { log('Kein Treffer zum Öffnen gefunden'); return false; }
  log('Öffne: ' + pick.text);
  await clickTarget(w, ctx, pick, 'Öffne ...');
  if (siteKey === 'youtube') {
    await waitFor(w, 'video', 12000, ctx.signal);
    await sleep(800, ctx.signal);
    const st = await ensurePlaying(w);
    log(st === 'playing' ? 'Video läuft' : 'Video geöffnet');
  } else {
    await settle(w, ctx);
  }
  return true;
}

// Liest die Seite "sichtbar": der Cursor wandert ueber Absaetze, solange die KI nachdenkt
function startSweep(w, ctx, label = 'Lese ...') {
  let stop = false;
  const nap = ms => new Promise(r => setTimeout(r, ms));
  const p = (async () => {
    await setLabel(w, ctx, label);
    let round = 0;
    while (!stop && !ctx.signal.aborted && !w.isDestroyed()) {
      const pt = await cursor(w, ctx.accent, SWEEP_JS);
      if (stop) break;
      if (pt) await cursor(w, ctx.accent, `window.__shieldCursor.move(${pt.x},${pt.y})`);
      await nap(1150);
      if (!stop && ++round % 3 === 0) await cursor(w, ctx.accent, 'window.scrollBy({ top: innerHeight * 0.35, behavior: "smooth" })');
    }
    if (!w.isDestroyed()) await cursor(w, ctx.accent, 'window.__shieldCursor.unmark()');
  })().catch(() => {});
  return { stop: async () => { stop = true; await p; } };
}

// Markiert eine Fundstelle mit dem Cursor (und optional echt auswaehlen, um sie zu kopieren)
async function pointAtText(w, ctx, snippet, { select = false, ms = 4500 } = {}) {
  const loc = await cursor(w, ctx.accent, locateJs(snippet, select));
  if (!loc) return null;
  await setLabel(w, ctx, select ? 'Kopiere ...' : 'Hier steht es ...');
  await moveTo(w, ctx, loc.x1, loc.y1);
  if (select) {
    await cursor(w, ctx.accent, `window.__shieldCursor.click(${loc.x1},${loc.y1})`);
    await cursor(w, ctx.accent, `window.__shieldCursor.move(${loc.x2},${loc.y2})`);
    await sleep(900, ctx.signal);
  }
  await cursor(w, ctx.accent, `window.__shieldCursor.highlight(${JSON.stringify(loc.rects)}, ${ms})`);
  return loc;
}

const cursorFind = (w, ctx, id) => cursor(w, ctx.accent, byIdJs(id));

// ---------- Uebungsseiten: was ist im sichtbaren Bereich zu sehen und anzuklicken? ----------
// Liefert den sichtbaren Text und nummerierte Elemente in Lesereihenfolge. Erkennt auch Antwortkarten und Wortkacheln,
// die keine echten Knoepfe sind (Zeiger-Cursor), und benutzt data-test-Hinweise (z. B. "challenge-choice").
const WORK_OBSERVE_JS = `(() => {
  const vh = innerHeight, vw = innerWidth;
  const cs = e => getComputedStyle(e);
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const inView = r => r.width > 3 && r.height > 3 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const shown = e => { const r = e.getBoundingClientRect(); if (!inView(r)) return false; const s = cs(e); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  document.querySelectorAll('[data-shield-id]').forEach(e => e.removeAttribute('data-shield-id'));
  const dtOf = e => clean(e.getAttribute('data-test') || e.getAttribute('data-testid') || '').slice(0, 40);
  const labelOf = e => {
    const tag = e.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return clean(e.getAttribute('aria-label') || e.placeholder || e.name || e.title || e.id);
    return clean(e.innerText) || clean(e.getAttribute('aria-label')) || clean(e.getAttribute('title')) || clean(e.alt) || clean((e.querySelector('img') || {}).alt) || clean(e.value);
  };
  const kindOf = (e, dt) => {
    const tag = e.tagName.toLowerCase(), role = (e.getAttribute('role') || '').toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase();
    if (/hint/i.test(dt)) return 'hint'; // Woerter im Aufgabentext, die beim Darueberfahren eine Uebersetzung zeigen: keine Antwort-Bausteine
    if (tag === 'input' || tag === 'textarea' || e.isContentEditable) {
      // Anmelde- und Zahlungsfelder (Passwort, E-Mail, Telefon, Karte): dort tippe ich nie
      const hint = ((e.getAttribute('autocomplete') || '') + ' ' + (e.name || '') + ' ' + (e.id || '') + ' ' + (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase();
      if (type === 'password' || /(current-password|new-password|passwor)/.test(hint)) return 'password-field';
      if (type === 'email' || type === 'tel' || /(username|cc-number|cc-csc|e-?mail|benutzername|kreditkarte|card number|iban)/.test(hint)) return 'secret-field';
      return (type === 'checkbox' || type === 'radio') ? 'choice' : 'input';
    }
    if (/radio|option|checkbox/.test(role) || /choice|option|answer/i.test(dt)) return 'choice';
    if (/token|tile|word|bank/i.test(dt)) return 'tile';
    if (/(^|[\\s_-])(tile|token|chip|wordbank|word-bank)([\\s_-]|$)/i.test(typeof e.className === 'string' ? e.className : '')) return 'tile';
    if (tag === 'a') return 'link';
    if (tag === 'button' || role === 'button' || type === 'submit') return 'button';
    return 'clickable';
  };
  const items = [], used = new Set();
  const add = (e, forced) => {
    if (used.has(e) || e.closest('[data-shield-ui]') || !shown(e)) return;
    for (const u of used) if (u !== e && u.contains(e) && !/^(input|textarea|select)$/i.test(e.tagName)) return; // Teil eines schon erfassten Elements (z. B. der Text in einem Knopf)
    const tag = e.tagName.toLowerCase(), dt = dtOf(e), label = labelOf(e);
    const field = tag === 'input' || tag === 'textarea' || e.isContentEditable;
    if (!label && !field && !dt) return;
    if (label.length > 140) return; // ganze Container auslassen
    used.add(e);
    // Liegt ein Fenster (Angebot, Hinweis) darueber, ist das Element nicht klickbar
    const rr = e.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, rr.left + rr.width / 2)), Math.min(vh - 1, Math.max(0, rr.top + rr.height / 2)));
    const covered = !!hit && !(hit === e || e.contains(hit) || hit.contains(e));
    items.push({ e, kind: forced || kindOf(e, dt), text: label.slice(0, 70), dt, disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true' || covered, r: rr });
  };
  document.querySelectorAll('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=radio],[role=option],[role=checkbox],input:not([type=hidden]),textarea,select,summary,[contenteditable=true],[data-test*=choice],[data-test*=token],[data-test*=option],[data-test*=answer],[data-test*=skip],[data-test*=next]').forEach(e => add(e));
  // Anklickbare Flaechen ohne echte Knopf-Auszeichnung: Raster abtasten und den aeussersten Zeiger-Cursor-Traeger nehmen
  const cur = x => cs(x).cursor === 'pointer';
  const picks = new Set();
  for (let y = 10; y < vh; y += 26) for (let x = 10; x < vw; x += 26) {
    const e = document.elementFromPoint(x, y);
    if (!e || e.closest('[data-shield-ui]') || !cur(e)) continue;
    let b = e; while (b.parentElement && cur(b.parentElement)) b = b.parentElement;
    picks.add(b);
  }
  for (const b of picks) {
    if (used.has(b)) continue;
    let covered = false; for (const x of used) { if (x === b || x.contains(b) || b.contains(x)) { covered = true; break; } }
    if (covered) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 24 || r.height < 18 || r.width > vw * 0.9 || r.height > vh * 0.6) continue;
    add(b, 'clickable');
  }
  items.sort((a, b) => (Math.abs(a.r.top - b.r.top) < 12 ? a.r.left - b.r.left : a.r.top - b.r.top));
  const els = items.slice(0, 70).map((it, i) => { it.e.setAttribute('data-shield-id', i + 1); return { id: i + 1, kind: it.kind, text: it.text, dt: it.dt, disabled: it.disabled, top: Math.round(it.r.top), cx: Math.round(it.r.left + it.r.width / 2) }; });
  // Hinweise der Seite selbst (Duolingo & Co. beschriften ihre Bausteine mit data-test): Aufgabentyp, Rueckmeldung, Lektionsende
  const chEl = document.querySelector('[data-test~="challenge"]');
  const challenge = chEl ? ((chEl.getAttribute('data-test') || '').split(/\\s+/).find(t => /^challenge-/.test(t)) || 'challenge') : '';
  const blame = document.querySelector('[data-test*="blame-incorrect"]') ? 'incorrect' : document.querySelector('[data-test*="blame-correct"]') ? 'correct' : '';
  const complete = !!document.querySelector('[data-test*="session-complete"],[data-test*="lesson-complete"]');
  // Sichtbarer Text (nur was im Fenster zu sehen ist)
  const lines = []; let total = 0;
  const merged = []; // Elemente, deren Text schon als Ganzes uebernommen wurde (Seiten, die Saetze Buchstabe fuer Buchstabe animieren)
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode()) && total < 2400) {
    let t = clean(n.nodeValue); if (!t) continue;
    const p = n.parentElement; if (!p || p.closest('[data-shield-ui]')) continue;
    const tg = p.tagName; if (tg === 'SCRIPT' || tg === 'STYLE' || tg === 'NOSCRIPT') continue;
    if (!shown(p)) continue;
    if (merged.some(m => m.contains(p))) continue;
    if (t.length <= 2) {
      let a = p;
      for (let i = 0; i < 6 && a.parentElement && a.parentElement !== document.body && clean(a.innerText).length < 14; i++) {
        const up = a.parentElement;
        if (up.querySelector('button,a,input,textarea,[role=button]')) break;
        a = up;
      }
      const whole = clean(a.innerText);
      if (whole.length > t.length) { merged.push(a); t = whole; }
    }
    if (lines.length && lines[lines.length - 1] === t) continue;
    lines.push(t); total += t.length + 1;
  }
  return { title: document.title, url: location.href, view: lines.join('\\n').slice(0, 2000), els, challenge, blame, complete, scrollY: Math.round(scrollY), height: document.documentElement.scrollHeight, vh };
})()`;

// Sucht einen sichtbaren, aktiven Knopf, dessen Beschriftung auf den regulaeren Ausdruck passt (unterster Treffer = Fussleiste)
const findPrimaryJs = reSource => `(() => {
  const re = new RegExp(${JSON.stringify(reSource)}, 'i');
  const vh = innerHeight;
  const clean = s => (s || '').replace(/\\s+/g, ' ').replace(/[.!…›»]+$/, '').trim();
  let best = null;
  for (const e of document.querySelectorAll('button,[role=button],a,input[type=submit],[data-test*=next],[data-test*=continue],[data-test*=submit],[data-test*=check],[data-test*=start]')) {
    if (e.closest('[data-shield-ui]')) continue;
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > vh || s.visibility === 'hidden' || s.display === 'none') continue;
    if (e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
    const t = clean(e.innerText || e.value || e.getAttribute('aria-label') || '');
    if (!t || t.length > 40 || !re.test(t)) continue;
    if (!best || r.top > best.r.top) best = { e, r, t };
  }
  if (!best) return null;
  if (window.__shieldCursor) window.__shieldCursor.mark(best.e);
  return { x: best.r.left + best.r.width / 2, y: best.r.top + best.r.height / 2, text: best.t, href: best.e.href || '' };
})()`;

// Der Haupt-Knopf der Fussleiste von Lern-Seiten (Duolingo: data-test="player-next", beschriftet je nach Schritt "Weiter", "Ich schaffe das!" ...)
const findNextJs = () => `(() => {
  const vh = innerHeight;
  for (const e of document.querySelectorAll('[data-test="player-next"],[data-test="player-continue"]')) {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > vh || s.visibility === 'hidden' || s.display === 'none') continue;
    if (e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
    const t = (e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    if (window.__shieldCursor) window.__shieldCursor.mark(e);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: t, href: e.href || '' };
  }
  return null;
})()`;

module.exports = {
  SITES, str, normUrl, isRisky, keywords, buildExcerpt,
  pickJs, findByTextJs, findInputJs, byIdJs, OBSERVE_JS, WORK_OBSERVE_JS, findPrimaryJs, findNextJs, locateJs, cursorFind,
  moveTo, clickAt, setLabel, hud, hideCursor, clickTarget, pressEnter, typeInto, scrollPage,
  waitFor, dismissConsent, ensurePlaying, settle, settleFast, nav, openResult, startSweep, pointAtText,
  Aborted
};
