const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, dialog, systemPreferences, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { isBlocked } = require('./blocklist');
const fx = require('./effects');
const ai = require('./agent');
const sitefx = require('./sitefx');
const actions = require('./actions');
const mission = require('./mission');
const pageagent = require('./pageagent');
const worker = require('./worker');
const sandbox = require('./sandbox');
const compat = require('./compat');

// Google-eigene Domains gelten fuer Cookies als eine Partei (die Anmeldung wechselt zwischen google.com, youtube.com und gstatic.com)
const GOOGLE_GROUP = new Set(['google.com', 'youtube.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'ggpht.com', 'youtube-nocookie.com', 'google.de']);
const sameParty = (a, b) => a === b || (GOOGLE_GROUP.has(a) && GOOGLE_GROUP.has(b));

// Adressen, die als echtes Pop-up-Fenster bleiben duerfen (Anmeldungen per OAuth)
const OAUTH_POPUP = /^https:\/\/(accounts\.google\.com|accounts\.youtube\.com|appleid\.apple\.com|login\.microsoftonline\.com|login\.live\.com|id\.twitch\.tv|www\.facebook\.com\/(dialog|login|v[\d.]+\/dialog)|(api\.)?twitter\.com\/(oauth|i\/oauth2)|x\.com\/i\/oauth2|github\.com\/login|discord\.com\/oauth2|www\.paypal\.com\/signin|steamcommunity\.com\/openid)|^https:\/\/[^/]+\/(oauth2?|authorize|openid|sso)(\/|\?|$)/i;
const hostOfUrl = u => { try { return new URL(u).hostname; } catch { return 'Anmeldung'; } };
// Das Pop-up bekommt dieselbe Chrome-Kennung und zeigt die Adresse im Fenstertitel (es hat keine Adressleiste)
function hardenPopup(child) {
  const cwc = child.webContents;
  try { child.setMenu(null); } catch {}
  compat.applySafe(cwc);
  cwc.setWindowOpenHandler(() => ({ action: 'deny' }));
  cwc.on('page-title-updated', (e, title) => { e.preventDefault(); try { child.setTitle(`${hostOfUrl(cwc.getURL())} – ${title}`); } catch {} });
}

// ---------- Modus: normal oder isolierter Modus (eigener Prozess mit Wegwerf-Profil) ----------
const SB = sandbox.parseArgs(process.argv);
const IS_SANDBOX = SB.enabled;
const sbState = IS_SANDBOX ? sandbox.createState(SB) : null;
if (IS_SANDBOX) {
  for (const s of ['no-pings', 'disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-client-side-phishing-detection', 'disable-breakpad'])
    app.commandLine.appendSwitch(s);
  app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
}

// ---------- Layout-Konstanten (die Oberflaeche liest dieselben Werte per 'layout-consts') ----------
const L = {
  TOP: IS_SANDBOX ? 86 : 56,       // Hoehe von (Banner +) Werkzeugleiste
  GAP: 8,                          // Abstand rund um die Seitenkarte
  RADIUS: 14,                      // Ecken der Seitenkarte
  SIDE_MIN: 64, SIDE_MAX: 244,     // Seitenleiste eingeklappt / ausgeklappt
  PANEL_MAX: 404,                  // rechte Karte (Orakel / Schutzzentrale)
  CTRL_H: IS_SANDBOX ? 30 : 56     // Hoehe der Fenstertasten
};
let lay = { side: L.SIDE_MAX, panel: 0, hidden: false, intro: true };

let aiAbort = null;
let chatHistory = [];
const home = () => pathToFileURL(path.join(__dirname, IS_SANDBOX ? 'sandbox-start.html' : 'start.html')).href + (IS_SANDBOX ? '?lv=' + sbState.level : '?fx=' + data.settings.fx);
const SEARCH = IS_SANDBOX ? 'https://html.duckduckgo.com/html/?q=' : 'https://duckduckgo.com/?q=';

let win, ses;
let tabs = []; // { id, view, fx, fxHost, fxToken, noFx, favicon, entering, enterP }
let activeId = null;
let nextId = 1;
let blockedCount = 0;
let adblockOn = true;
let data = {
  bookmarks: [], history: [], notes: [],
  fx: {}, // Effekt-Entscheidungen pro Seite: host -> { effect: 'show'|'hide', reason, by: 'ai'|'user', t }
  settings: { fx: 'sakura', yt: 'kino', model: 'qwen2.5:3b', fxAuto: true, cursorMode: true, side: true }
};
let dataFile;

function loadData() {
  if (IS_SANDBOX) return; // der isolierte Modus speichert nichts
  try {
    const d = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    data = { ...data, ...d, fx: { ...d.fx }, settings: { ...data.settings, ...d.settings } };
  } catch {}
}
function saveData() {
  if (IS_SANDBOX) return;
  try { fs.writeFileSync(dataFile, JSON.stringify(data)); } catch {}
}

function toUrl(input) {
  input = String(input || '').trim();
  if (!input) return home();
  if (/^(https?|file|about):/i.test(input)) {
    if (IS_SANDBOX && /^(file|about):/i.test(input) && input !== 'about:blank') return home();
    return input;
  }
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(input) || /^localhost(:\d+)?/.test(input)) return 'https://' + input;
  return SEARCH + encodeURIComponent(input);
}

// ---------- Schutz im normalen Modus ----------
function setupPrivacy() {
  ses = session.fromPartition('persist:main');
  // Chrome-Kennung ohne "Electron" und mit gueltiger Sprachliste (ohne q-Werte, die setzt Chromium selbst)
  try { ses.setUserAgent(compat.uaString(), compat.acceptLanguages()); } catch {}

  ses.webRequest.onBeforeRequest((details, cb) => {
    try {
      const u = new URL(details.url);
      if (adblockOn && /^https?:$/.test(u.protocol) && isBlocked(u.hostname)) {
        blockedCount++;
        win?.webContents.send('blocked', blockedCount);
        return cb({ cancel: true });
      }
      // HTTP automatisch auf HTTPS hochstufen (ausser lokale Adressen)
      if (u.protocol === 'http:' && !/^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(u.hostname)) {
        u.protocol = 'https:';
        return cb({ redirectURL: u.toString() });
      }
    } catch {}
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    h['DNT'] = '1';
    h['Sec-GPC'] = '1';
    // Wie Chrome: bei HTTPS-Anfragen die Standard-Hinweise (Sec-CH-UA ...) mitsenden, falls der Tab sie nicht selbst liefert (z. B. Hintergrund-Skripte)
    if (/^https:/.test(details.url)) {
      const have = new Set(Object.keys(h).map(k => k.toLowerCase()));
      for (const [k, v] of Object.entries(compat.lowEntropyHints())) if (!have.has(k.toLowerCase())) h[k] = v;
    }
    // Referrer auf Herkunfts-Domain kuerzen, wenn die Seite wechselt
    if (h['Referer']) {
      try {
        const r = new URL(h['Referer']), t = new URL(details.url);
        if (r.origin !== t.origin) h['Referer'] = r.origin + '/';
      } catch {}
    }
    cb({ requestHeaders: h });
  });

  // Drittanbieter-Cookies entfernen
  ses.webRequest.onHeadersReceived((details, cb) => {
    const h = details.responseHeaders;
    try {
      const top = details.frame?.top?.url || details.referrer;
      if (top && details.resourceType !== 'mainFrame') {
        const a = sandbox.siteOf(new URL(top).hostname);
        const b = sandbox.siteOf(new URL(details.url).hostname);
        if (!sameParty(a, b)) for (const k of Object.keys(h)) if (k.toLowerCase() === 'set-cookie') delete h[k];
      }
    } catch {}
    cb({ responseHeaders: h });
  });

  // Berechtigungen (Kamera, Standort, Benachrichtigungen ...) standardmaessig verweigern
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  ses.setPermissionCheckHandler(() => false);
}

// ---------- Schutz im isolierten Modus ----------
let sbStatTimer = 0;
function setupSandbox() {
  ses = session.fromPartition('shield-sandbox'); // kein "persist:" = nur im Arbeitsspeicher
  const appDir = path.resolve(__dirname).toLowerCase();
  sandbox.setupSession(ses, sbState, {
    stat: () => { if (!sbStatTimer) sbStatTimer = setTimeout(() => { sbStatTimer = 0; win?.webContents.send('sb-stats', sbState.stats); }, 300); },
    toast: text => win?.webContents.send('toast', text),
    allowFile: url => { try { return require('url').fileURLToPath(url).toLowerCase().startsWith(appDir) && /sandbox-start\.html$/i.test(url.split('?')[0]); } catch { return false; } }
  });
  sandbox.applyProxy(ses, sbState);
  applyDoh();
}
// Verschluesseltes DNS: die Namensanfragen sieht nicht der Internetanbieter (gilt nur in dieser Instanz)
function applyDoh() {
  try {
    if (sbState.doh) app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode: 'secure', secureDnsServers: ['https://cloudflare-dns.com/dns-query'] });
    else app.configureHostResolver({ secureDnsMode: 'off' });
  } catch {}
}

// ---------- Layout ----------
function pageBounds() {
  const [w, h] = win.getContentSize();
  const x0 = lay.side + L.GAP;
  const x1 = w - L.GAP - (lay.panel > 0 ? lay.panel + L.GAP : 0);
  const y0 = L.TOP, y1 = h - L.GAP;
  let b = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  // Maximaler Schutz: Seitenflaeche in festen Stufen (200 x 100), damit die Fenstergroesse nichts verraet
  if (IS_SANDBOX && sbState.level === 'max' && b.width > 400 && b.height > 300) {
    const bw = Math.max(400, Math.floor(b.width / 200) * 200), bh = Math.max(300, Math.floor(b.height / 100) * 100);
    b = { x: b.x + Math.floor((b.width - bw) / 2), y: b.y + Math.floor((b.height - bh) / 2), width: bw, height: bh };
  }
  return b;
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const b = pageBounds();
  for (const t of tabs) {
    if (t.id !== activeId || lay.hidden || lay.intro) { t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); continue; }
    let r = b;
    if (t.fs) { const [w, h] = win.getContentSize(); r = { x: 0, y: 0, width: w, height: h }; } // Video im Vollbild: die Seite fuellt das ganze Fenster
    else if (t.entering) { const d = Math.round((1 - t.enterP) * 22); r = { x: b.x, y: b.y + d, width: b.width, height: Math.max(0, b.height - d) }; }
    t.view.setBounds(r);
  }
}

// ---------- Themes, YouTube-Look (nicht im isolierten Modus: dort wird nichts in Seiten eingeschleust) ----------
const accent = () => fx.ACCENTS[data.settings.fx] || fx.ACCENTS.off;
const isYouTube = wc => { try { return /(^|\.)youtube\.com$/.test(new URL(wc.getURL()).hostname); } catch { return false; } };
const ROW = { sakura: '#1b1026', snow: '#0c1326', leaves: '#1f1109', off: '#14161a', sandbox: '#11161b' };
const rowColor = () => (IS_SANDBOX ? ROW.sandbox : ROW[data.settings.fx] || ROW.off);

function applyLook(tab) {
  if (IS_SANDBOX) return;
  const wc = tab.view.webContents;
  if (wc.isDestroyed()) return;
  updateEffect(tab);
  if (isYouTube(wc)) wc.executeJavaScript(fx.ytScript(data.settings.yt, accent())).catch(() => {});
}

function broadcastSettings() {
  try { win?.setTitleBarOverlay({ color: rowColor(), symbolColor: IS_SANDBOX ? '#ffb02e' : '#e6dde9', height: L.CTRL_H }); win?.setBackgroundColor(rowColor()); } catch {}
  win?.webContents.send('settings', settingsPayload());
  if (IS_SANDBOX) return;
  for (const t of tabs) {
    const wc = t.view.webContents;
    if (/start\.html/.test(wc.getURL())) wc.loadURL(home());
    else applyLook(t);
  }
}
const settingsPayload = () => ({ ...data.settings, accent: IS_SANDBOX ? '#ffb02e' : accent(), mode: IS_SANDBOX ? 'sandbox' : 'normal' });

// ---------- KI entscheidet, ob der Partikel-Effekt auf einer Seite bleibt ----------
let fxQueue = Promise.resolve();
const pendingFx = new Map(); // host -> Promise<{effect, reason, by}>
const memFx = new Map();     // Regel-Entscheidungen (nur kurz gemerkt, damit die KI es spaeter erneut versucht)

function waitLoaded(wc, ms = 8000) {
  return new Promise(res => {
    if (wc.isDestroyed() || !wc.isLoading()) return res();
    const done = () => { clearTimeout(t); wc.removeListener('did-stop-loading', done); res(); };
    const t = setTimeout(done, ms);
    wc.once('did-stop-loading', done);
  });
}

function decideSite(host, wc) {
  if (pendingFx.has(host)) return pendingFx.get(host);
  const job = async () => {
    let feats = {};
    try {
      await waitLoaded(wc);
      await new Promise(r => setTimeout(r, 700)); // Single-Page-Seiten kurz aufbauen lassen
      if (!wc.isDestroyed()) feats = await wc.executeJavaScript(sitefx.FEATURES_JS);
    } catch {}
    try {
      if (!(await ai.ollamaUp())) throw new Error('Ollama offline');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      let r;
      try { r = await sitefx.classify(data.settings.model, host, feats, ctl.signal); } finally { clearTimeout(timer); }
      const d = { ...sitefx.finalize(host, feats, r), t: Date.now() };
      data.fx[host] = d; saveData();
      win?.webContents.send('fx-list-changed');
      return d;
    } catch {
      // KI nicht erreichbar: Regeln entscheiden, aber nur kurz merken, damit die KI es spaeter erneut versucht
      const d = { ...sitefx.finalize(host, feats, null), t: Date.now() };
      memFx.set(host, { ...d, until: Date.now() + 120000 });
      return d;
    }
  };
  const p = fxQueue.then(job);
  fxQueue = p.catch(() => {});
  pendingFx.set(host, p);
  p.then(() => pendingFx.delete(host), () => pendingFx.delete(host));
  return p;
}

async function updateEffect(tab) {
  const wc = tab.view.webContents;
  if (wc.isDestroyed()) return;
  const kind = data.settings.fx;
  const url = wc.getURL();
  const token = tab.fxToken = (tab.fxToken || 0) + 1;
  const run = effect => { if (!wc.isDestroyed()) wc.executeJavaScript(fx.particles(kind, effect === 'show')).catch(() => {}); };
  const set = (effect, reason, by, thinking = false) => { tab.fx = { effect, reason, by, thinking, host: tab.fxHost || '' }; pushTabs(); };

  if (/start\.html/.test(url)) { tab.fxHost = ''; set('show', 'Startseite', 'start'); run('show'); return; }
  if (!/^https?:/.test(url)) { tab.fxHost = ''; tab.fx = null; pushTabs(); return; }

  const host = tab.fxHost = sitefx.siteKey(url);
  if (tab.noFx) { set('hide', 'Recherche läuft', 'regel'); run('hide'); return; }
  if (kind === 'off') { set('hide', 'Animation ist aus', 'regel'); run('hide'); return; }

  const known = data.fx[host];
  if (known && (known.by === 'user' || data.settings.fxAuto)) { set(known.effect, known.reason, known.by); run(known.effect); return; }
  if (!data.settings.fxAuto) { set('show', 'KI-Auswahl ist aus', 'regel'); run('show'); return; }
  const mem = memFx.get(host);
  if (mem && mem.until > Date.now()) { set(mem.effect, mem.reason, mem.by); run(mem.effect); return; }

  // Unbekannte Seite: erst ausgeblendet lassen, die lokale KI entscheiden lassen, dann sanft ein- oder ausblenden
  set('hide', 'KI überlegt …', 'ai', true);
  run('hide');
  const d = await decideSite(host, wc);
  if (wc.isDestroyed() || tab.fxToken !== token) return; // Seite wurde inzwischen gewechselt
  set(d.effect, d.reason, d.by);
  run(d.effect);
}

function refreshHost(host) {
  for (const t of tabs) if (t.fxHost === host) updateEffect(t);
  win?.webContents.send('fx-list-changed');
}

// ---------- Tabs ----------
function tabInfo(t) {
  const wc = t.view.webContents;
  const url = wc.getURL();
  return {
    id: t.id, title: wc.getTitle() || 'Neuer Tab', url, loading: wc.isLoading(),
    canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(),
    fx: t.fx || null, favicon: t.favicon || '', audible: wc.isCurrentlyAudible(), muted: wc.isAudioMuted(),
    secure: /^https:/.test(url), start: /(start|sandbox-start)\.html/.test(url) || url === 'about:blank'
  };
}
function pushTabs() {
  win?.webContents.send('tabs', { active: activeId, tabs: tabs.map(tabInfo), bookmarked: isBookmarked() });
}
function isBookmarked() {
  const t = tabs.find(x => x.id === activeId);
  return !!t && data.bookmarks.some(b => b.url === t.view.webContents.getURL());
}

// Favicons werden ueber die Sitzung des Browsers geholt (Werbeblocker gilt) und als data-URL an die Oberflaeche gegeben
const faviconCache = new Map();
async function loadFavicon(tab, list) {
  if (IS_SANDBOX || !list || !list.length) return;
  const url = list.find(u => /\.(png|ico|svg)(\?|$)/i.test(u)) || list[0];
  try {
    if (faviconCache.has(url)) { tab.favicon = faviconCache.get(url); return pushTabs(); }
    const r = await ses.fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const type = (r.headers.get('content-type') || 'image/png').split(';')[0];
    if (!/^image\//.test(type)) return;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 120000) return;
    const dataUrl = `data:${type};base64,${buf.toString('base64')}`;
    faviconCache.set(url, dataUrl);
    tab.favicon = dataUrl;
    pushTabs();
  } catch {}
}

function newTab(url = home(), activate = true) {
  if (process.env.SHIELD_DEBUG) console.log('newTab', url, new Error().stack.split('\n').slice(2, 5).map(s => s.trim()).join(' | '));
  const prefs = IS_SANDBOX ? sandbox.tabPreferences(ses) : { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false };
  const view = new WebContentsView({ webPreferences: prefs });
  try { view.setBorderRadius(L.RADIUS); } catch {}
  const tab = { id: nextId++, view, favicon: '', entering: false, enterP: 1 };
  const wc = view.webContents;
  win.contentView.addChildView(view);
  tabs.push(tab);

  if (IS_SANDBOX) {
    let lastPopup = 0;
    wc.setWindowOpenHandler(({ url: u }) => {
      const now = Date.now();
      if (!/^https?:/.test(u) || now - lastPopup < 1500 || tabs.length >= 10) { sbState.stats.popups++; win?.webContents.send('sb-stats', sbState.stats); return { action: 'deny' }; }
      lastPopup = now; newTab(u); return { action: 'deny' };
    });
    // Keine Spruenge zu fremden Protokollen (file:, ftp:, mailto: ...)
    const guard = (e, u) => { if (!/^https?:/.test(u) && !/sandbox-start\.html/.test(u) && u !== 'about:blank') e.preventDefault(); };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
  } else {
    // Anmelde-Pop-ups ("Mit Google anmelden" auf fremden Seiten) muessen ein echtes Fenster mit Verbindung zum Opener bleiben,
    // sonst kann die Seite das Ergebnis nicht empfangen. Alles andere oeffnet als Tab.
    let lastOauthPopup = 0;
    wc.setWindowOpenHandler(({ url: u }) => {
      if (OAUTH_POPUP.test(u) && Date.now() - lastOauthPopup > 2500) {
        lastOauthPopup = Date.now();
        return { action: 'allow', overrideBrowserWindowOptions: { width: 500, height: 720, minWidth: 380, minHeight: 480, parent: win, autoHideMenuBar: true, backgroundColor: '#ffffff', title: hostOfUrl(u), webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      }
      newTab(u); return { action: 'deny' };
    });
    wc.on('did-create-window', child => hardenPopup(child));
    wc.on('dom-ready', () => applyLook(tab));
    wc.on('page-favicon-updated', (_e, list) => loadFavicon(tab, list));
    wc.on('did-navigate', (_e, u) => {
      if (/^https?:/.test(u)) {
        data.history.unshift({ url: u, title: wc.getTitle(), time: Date.now() });
        data.history = data.history.slice(0, 500);
        saveData();
      }
    });
    wc.on('page-title-updated', (_e, title) => {
      const h = data.history[0]; if (h && h.url === wc.getURL()) { h.title = title; saveData(); }
    });
  }
  for (const ev of ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'audio-state-changed'])
    wc.on(ev, pushTabs);
  // Vollbild einer Seite (z. B. YouTube-Video): Fenster geht ins Vollbild, die Seite deckt alles ab, ohne runde Ecken; danach alles zurueck
  wc.on('enter-html-full-screen', () => { tab.fs = true; try { view.setBorderRadius(0); } catch {} layout(); setTimeout(() => { layout(); if (process.env.SHIELD_DEBUG) console.log('fs view', JSON.stringify(view.getBounds()), JSON.stringify(win.getContentBounds())); }, 150); });
  wc.on('leave-html-full-screen', () => { tab.fs = false; try { view.setBorderRadius(L.RADIUS); } catch {} layout(); setTimeout(layout, 120); });
  wc.on('did-start-navigation', (_e, _u, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) tab.favicon = ''; });

  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.linkURL) items.push({ label: 'Link in neuem Tab öffnen', click: () => newTab(p.linkURL) }, { label: 'Link-Adresse kopieren', click: () => clipboard.writeText(p.linkURL) });
    if (p.selectionText) items.push({ role: 'copy', label: 'Kopieren' });
    if (p.isEditable) items.push({ role: 'paste', label: 'Einfügen' });
    items.push({ label: 'Zurück', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: 'Neu laden', click: () => wc.reload() });
    Menu.buildFromTemplate(items).popup();
  });

  const start = async () => {
    if (IS_SANDBOX) {
      // Erst eine leere Seite laden, dann absichern, erst dann die eigentliche Adresse. Klappt das Absichern nicht, wird nichts geladen.
      await wc.loadURL('about:blank').catch(() => {});
      const ok = !wc.isDestroyed() && await sandbox.hardenSafe(wc, sbState);
      if (!ok) {
        if (!wc.isDestroyed()) wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#0b1015;color:#e7eef2;font:16px system-ui;padding:12vh 10vw"><h2 style="color:#ffb02e">Schutz konnte nicht aktiviert werden</h2><p>Aus Sicherheitsgründen wurde die Seite nicht geladen. Starte den isolierten Modus bitte neu.</p></body>')).catch(() => {});
        return;
      }
    } else {
      // Normaler Modus: erst die Chrome-Kennung setzen (Client-Hints, window.chrome), dann laden. Klappt es nicht, wird trotzdem geladen.
      await wc.loadURL('about:blank').catch(() => {});
      if (!wc.isDestroyed()) await compat.applySafe(wc);
    }
    const target = toUrl(url);
    if (process.env.SHIELD_DEBUG) console.log('load', target);
    // Eine leere Seite ist schon geladen; nicht noch einmal laden (sonst wuerde eine inzwischen gestartete Navigation des Agenten ueberschrieben)
    if (target !== 'about:blank' && !wc.isDestroyed()) wc.loadURL(target).catch(e => { if (process.env.SHIELD_DEBUG) console.log('loadURL fehlgeschlagen:', e.message); });
  };
  // Agenten warten auf diese Zusage, bevor sie im Tab navigieren (sonst fehlt der erste Anfrage die Chrome-Kennung)
  wc.__ready = start();
  if (activate) { switchTab(tab.id); if (!lay.intro) animateIn(tab); } else layout();
  return tab;
}

// Die Seitenkarte gleitet beim Oeffnen sanft nach oben
function animateIn(tab) {
  if (!richMotion()) return;
  const t0 = Date.now(), dur = 280;
  tab.entering = true; tab.enterP = 0;
  const step = () => {
    if (tab.view.webContents.isDestroyed()) return;
    const p = Math.min(1, (Date.now() - t0) / dur);
    tab.enterP = 1 - Math.pow(1 - p, 3);
    if (p >= 1) tab.entering = false;
    layout();
    if (p < 1) setTimeout(step, 16);
  };
  step();
}

function switchTab(id) {
  activeId = id;
  layout();
  const t = tabs.find(x => x.id === id);
  if (t) t.view.webContents.focus();
  pushTabs();
}

function closeTab(id) {
  if (process.env.SHIELD_DEBUG) console.log('closeTab', id, new Error().stack.split('\n').slice(2, 5).map(s => s.trim()).join(' | '));
  const i = tabs.findIndex(x => x.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  try { if (IS_SANDBOX && t.view.webContents.debugger.isAttached()) t.view.webContents.debugger.detach(); } catch {}
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (!tabs.length) return newTab(home());
  if (activeId === id) switchTab(tabs[Math.min(i, tabs.length - 1)].id);
  else pushTabs();
}

const active = () => tabs.find(t => t.id === activeId)?.view.webContents;
const activeTab = () => tabs.find(t => t.id === activeId);

// ---------- Fenster mit sanftem Einblenden ----------
const richMotion = () => { try { return !systemPreferences.getAnimationSettings().prefersReducedMotion; } catch { return true; } };

function showWithIntro() {
  if (!win || win.isDestroyed() || win.isVisible()) return;
  const rich = richMotion();
  if (rich) win.setOpacity(0);
  win.show();
  win.webContents.send('intro');
  setTimeout(endIntro, rich ? 1700 : 100); // Sicherheitsnetz, falls die Oberflaeche 'intro-done' nicht meldet
  if (!rich) return;
  const t0 = Date.now(), dur = 420;
  const iv = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(iv);
    const p = Math.min(1, (Date.now() - t0) / dur);
    win.setOpacity(1 - Math.pow(1 - p, 3));
    if (p >= 1) clearInterval(iv);
  }, 16);
}
function endIntro() {
  if (!lay.intro) return;
  lay.intro = false;
  layout();
  const t = activeTab(); if (t) animateIn(t);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 760, minHeight: 480, show: false,
    backgroundColor: rowColor(), title: IS_SANDBOX ? 'Shield – Isolierter Modus' : 'Shield',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: IS_SANDBOX ? '#ffb02e' : '#e6dde9', height: L.CTRL_H },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  win.loadFile('ui.html');
  win.once('ready-to-show', showWithIntro);
  setTimeout(showWithIntro, 3000); // Sicherheitsnetz
  win.on('resize', layout);
  win.on('maximize', layout); win.on('unmaximize', layout);
  // Browser-Vollbild (F11): die Kopfleiste braucht dann keinen Platz mehr fuer die Fenstertasten
  win.on('enter-full-screen', () => { win.webContents.send('fullscreen', true); layout(); });
  win.on('leave-full-screen', () => { win.webContents.send('fullscreen', false); layout(); });
  let started = false;
  win.webContents.on('did-finish-load', () => {
    if (started) return; // nur einmal starten
    started = true;
    if (!tabs.length) newTab(home());
    broadcastSettings();
  });

  // Tastenkuerzel auch dann, wenn eine Webseite den Fokus hat
  const handleKey = (e, input) => {
    if (input.type !== 'keyDown') return;
    const c = input.control || input.meta;
    const k = input.key.toLowerCase();
    if (c && !input.shift && k === 't') { e.preventDefault(); newTab(home()); win.webContents.send('palette', ''); }
    else if (c && k === 'w') { e.preventDefault(); closeTab(activeId); }
    else if (c && (k === 'l' || k === 'k')) { e.preventDefault(); win.webContents.focus(); win.webContents.send('palette', active()?.getURL() || ''); }
    else if (c && !input.shift && k === 'r' || input.key === 'F5') { e.preventDefault(); active()?.reload(); }
    else if (input.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }    else if (c && k === 'j') { e.preventDefault(); win.webContents.send('toggle-ai'); }
    else if (c && k === 'b') { e.preventDefault(); win.webContents.send('toggle-side'); }
    else if (c && input.shift && k === 'n') { e.preventDefault(); win.webContents.send('sandbox-dialog'); }
    else if (c && k === 'd') { e.preventDefault(); toggleBookmark(); }
    else if (input.alt && input.key === 'ArrowLeft') { e.preventDefault(); active()?.navigationHistory.goBack(); }
    else if (input.alt && input.key === 'ArrowRight') { e.preventDefault(); active()?.navigationHistory.goForward(); }
    else if (c && input.key === 'Tab') {
      e.preventDefault();
      const i = tabs.findIndex(t => t.id === activeId);
      switchTab(tabs[(i + (input.shift ? tabs.length - 1 : 1)) % tabs.length].id);
    } else if (c && /^[1-9]$/.test(k)) { e.preventDefault(); const t = tabs[k === '9' ? tabs.length - 1 : +k - 1]; if (t) switchTab(t.id); }
  };
  win.webContents.on('before-input-event', handleKey);
  app.on('web-contents-created', (_e, wc) => wc.on('before-input-event', handleKey));
}

function toggleBookmark() {
  if (IS_SANDBOX) return;
  const wc = active(); if (!wc) return;
  const url = wc.getURL();
  const i = data.bookmarks.findIndex(b => b.url === url);
  if (i >= 0) data.bookmarks.splice(i, 1);
  else if (/^https?:/.test(url)) data.bookmarks.push({ url, title: wc.getTitle() || url, favicon: activeTab()?.favicon || '' });
  saveData();
  pushTabs();
  win?.webContents.send('bookmarks-changed');
}

// ---------- IPC: Tabs und Navigation ----------
ipcMain.handle('get-tabs', () => ({ active: activeId, tabs: tabs.map(tabInfo), bookmarked: isBookmarked() }));
ipcMain.handle('new-tab', (_e, url) => { newTab(url || home()); });
ipcMain.handle('close-tab', (_e, id) => closeTab(id));
ipcMain.handle('switch-tab', (_e, id) => switchTab(id));
ipcMain.handle('navigate', (_e, input) => { active()?.loadURL(toUrl(input)); active()?.focus(); });
ipcMain.handle('search', (_e, q) => { active()?.loadURL(SEARCH + encodeURIComponent(String(q || ''))); active()?.focus(); });
ipcMain.handle('back', () => active()?.navigationHistory.goBack());
ipcMain.handle('forward', () => active()?.navigationHistory.goForward());
ipcMain.handle('reload', () => { const wc = active(); wc?.isLoading() ? wc.stop() : wc?.reload(); });
ipcMain.handle('bookmark', toggleBookmark);
ipcMain.handle('get-lists', () => ({ bookmarks: data.bookmarks, history: data.history.slice(0, 100) }));
ipcMain.handle('remove-bookmark', (_e, url) => { data.bookmarks = data.bookmarks.filter(b => b.url !== url); saveData(); pushTabs(); win?.webContents.send('bookmarks-changed'); });
ipcMain.handle('adblock', (_e, on) => { if (!IS_SANDBOX) adblockOn = !!on; return adblockOn; });
ipcMain.handle('get-state', () => ({ blockedCount, adblockOn }));
ipcMain.handle('clear-data', async () => {
  await ses.clearStorageData(); await ses.clearCache();
  data.history = []; saveData();
});
// Nur Google- und YouTube-Anmeldedaten loeschen (wenn Google den Browser vorher als "unsicher" vermerkt hat, hilft ein frischer Start)
ipcMain.handle('clear-google', async () => {
  if (IS_SANDBOX) return 0;
  let n = 0;
  const re = /(^|\.)(google\.[a-z.]+|youtube\.com|youtube-nocookie\.com|gstatic\.com|googleusercontent\.com|ggpht\.com|googleapis\.com)$/i;
  for (const c of await ses.cookies.get({})) {
    const host = String(c.domain || '').replace(/^\./, '');
    if (!re.test(host)) continue;
    try { await ses.cookies.remove(`http${c.secure ? 's' : ''}://${host}${c.path || '/'}`, c.name); n++; } catch {}
  }
  for (const o of ['https://accounts.google.com', 'https://www.google.com', 'https://www.youtube.com', 'https://accounts.youtube.com', 'https://myaccount.google.com']) { try { await ses.clearStorageData({ origin: o }); } catch {} }
  return n;
});
ipcMain.handle('reorder-tabs', (_e, ids) => {
  if (!Array.isArray(ids)) return;
  const byId = new Map(tabs.map(t => [t.id, t]));
  const next = ids.map(i => byId.get(i)).filter(Boolean);
  if (next.length === tabs.length) { tabs = next; pushTabs(); }
});
ipcMain.handle('tab-menu', (_e, id) => {
  const t = tabs.find(x => x.id === id); if (!t) return;
  const wc = t.view.webContents;
  Menu.buildFromTemplate([
    { label: 'Neu laden', click: () => wc.reload() },
    { label: 'Duplizieren', click: () => newTab(wc.getURL()) },
    { label: wc.isAudioMuted() ? 'Ton einschalten' : 'Tab stummschalten', click: () => { wc.setAudioMuted(!wc.isAudioMuted()); pushTabs(); } },
    { type: 'separator' },
    { label: 'Schließen', click: () => closeTab(id) },
    { label: 'Andere Tabs schließen', enabled: tabs.length > 1, click: () => { for (const o of tabs.filter(x => x.id !== id)) closeTab(o.id); } }
  ]).popup();
});

// ---------- IPC: Layout, Schnappschuss fuer die Befehlspalette ----------
ipcMain.handle('layout-consts', () => ({ ...L, sandbox: IS_SANDBOX, level: sbState?.level || '' }));
ipcMain.on('layout', (_e, v) => {
  if (!v) return;
  lay.side = Math.max(L.SIDE_MIN, Math.min(L.SIDE_MAX, Number(v.side) || lay.side));
  lay.panel = Math.max(0, Math.min(L.PANEL_MAX, Number(v.panel) || 0));
  layout();
});
ipcMain.on('intro-done', endIntro);
ipcMain.handle('view-hide', () => { lay.hidden = true; layout(); });
ipcMain.handle('view-show', () => { lay.hidden = false; layout(); });
ipcMain.handle('snap', async () => {
  const wc = active(); if (!wc || wc.isDestroyed()) return null;
  try {
    const img = await wc.capturePage();
    const s = img.getSize(); if (!s.width) return null;
    const small = s.width > 1000 ? img.resize({ width: 1000, quality: 'good' }) : img;
    return 'data:image/jpeg;base64,' + small.toJPEG(72).toString('base64');
  } catch { return null; }
});
// Vorschlaege fuer die Befehlspalette
ipcMain.handle('palette-query', (_e, q) => {
  q = String(q || '').toLowerCase().trim();
  const hit = (...f) => !q || f.some(s => String(s || '').toLowerCase().includes(q));
  const seen = new Set();
  const out = { tabs: [], bookmarks: [], history: [] };
  for (const t of tabs) { const wc = t.view.webContents; if (hit(wc.getTitle(), wc.getURL())) out.tabs.push({ id: t.id, title: wc.getTitle() || 'Neuer Tab', url: wc.getURL(), favicon: t.favicon || '' }); }
  for (const b of data.bookmarks) if (hit(b.title, b.url)) out.bookmarks.push({ title: b.title, url: b.url, favicon: b.favicon || '' });
  for (const h of data.history) { if (seen.has(h.url) || !hit(h.title, h.url)) continue; seen.add(h.url); out.history.push({ title: h.title || h.url, url: h.url }); if (out.history.length >= 6) break; }
  out.tabs = out.tabs.slice(0, 5); out.bookmarks = out.bookmarks.slice(0, 5);
  return out;
});

// ---------- IPC: Einstellungen, Effekt-Entscheidungen, Notizen ----------
ipcMain.handle('get-settings', () => settingsPayload());
ipcMain.handle('set-setting', (_e, key, val) => {
  if (!['fx', 'yt', 'model', 'fxAuto', 'cursorMode', 'side'].includes(key)) return;
  data.settings[key] = (key === 'fxAuto' || key === 'cursorMode' || key === 'side') ? !!val : val;
  saveData(); broadcastSettings();
  if (key === 'fxAuto' && val && !IS_SANDBOX) ai.ensureOllama().catch(() => {});
});

ipcMain.handle('fx-toggle', () => {
  const tab = activeTab(); if (!tab?.fxHost) return;
  const effect = tab.fx?.effect === 'show' ? 'hide' : 'show';
  data.fx[tab.fxHost] = { effect, reason: 'Von dir gesetzt', by: 'user', t: Date.now() };
  saveData(); refreshHost(tab.fxHost);
});
ipcMain.handle('fx-reset', (_e, host) => {
  host = host || activeTab()?.fxHost; if (!host) return;
  delete data.fx[host]; memFx.delete(host);
  saveData(); refreshHost(host);
});
ipcMain.handle('fx-flip', (_e, host) => {
  const cur = data.fx[host]; if (!cur) return;
  data.fx[host] = { effect: cur.effect === 'show' ? 'hide' : 'show', reason: 'Von dir gesetzt', by: 'user', t: Date.now() };
  saveData(); refreshHost(host);
});
ipcMain.handle('fx-list', () => Object.entries(data.fx).map(([host, v]) => ({ host, ...v })).sort((a, b) => b.t - a.t).slice(0, 80));
ipcMain.handle('fx-clear', () => {
  data.fx = {}; memFx.clear(); saveData();
  for (const t of tabs) updateEffect(t);
  win?.webContents.send('fx-list-changed');
});

ipcMain.handle('ai-models', async () => { if (IS_SANDBOX) return []; await ai.ensureOllama(); return ai.models(); });
ipcMain.handle('notes-get', () => data.notes);
ipcMain.handle('note-delete', (_e, id) => { data.notes = data.notes.filter(n => n.id !== id); saveData(); return data.notes; });
ipcMain.handle('notes-clear', () => { data.notes = []; saveData(); return data.notes; });
ipcMain.handle('notes-export', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'recherche-notizen.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, data.notes.map(n => `## ${n.title}\n${n.url}\n\n${n.text}\n`).join('\n'), 'utf8');
  return true;
});
ipcMain.handle('clipboard-write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('ai-stop', () => { aiAbort?.abort(); });
ipcMain.handle('ai-reset', () => { chatHistory = []; });

// ---------- KI-Auftraege: Chat, Recherche, Aktionen, Seite bedienen, mehrstufige Aufgaben ----------
// Rueckfrage bei heiklen Klicks (Kaufen, Senden, Loeschen ...): die Oberflaeche zeigt Ja/Nein, die Antwort kommt hierher
let pendingConfirm = null;
let confirmSeq = 0;
ipcMain.handle('ai-confirm-answer', (_e, id, yes) => {
  if (pendingConfirm && pendingConfirm.id === id) { const r = pendingConfirm.res; pendingConfirm = null; r(!!yes); }
});

// Alles, was die Agenten im Browser tun duerfen
function agentContext(send, signal, model) {
  const agentTabs = [];
  return {
    model, accent: accent(), send, signal,
    openTab: url => { const t = newTab(url, true); t.noFx = true; agentTabs.push(t); return t.view.webContents; },
    active: () => active(),
    newTab: () => newTab(home(), true),
    closeActive: () => closeTab(activeId),
    cycleTab: d => { const i = tabs.findIndex(t => t.id === activeId); if (i >= 0 && tabs.length) switchTab(tabs[(i + d + tabs.length) % tabs.length].id); },
    bookmark: () => { const wc = active(); if (wc && /^https?:/.test(wc.getURL()) && !data.bookmarks.some(b => b.url === wc.getURL())) toggleBookmark(); },
    tabCount: () => tabs.length,
    clipboardWrite: text => clipboard.writeText(String(text)),
    saveNote: n => { data.notes.unshift({ id: Date.now(), ...n }); saveData(); send('notes', data.notes); },
    confirm: question => new Promise(resolve => {
      const id = ++confirmSeq;
      pendingConfirm = { id, res: resolve };
      send('ai-confirm', { id, q: question });
      signal.addEventListener('abort', () => { if (pendingConfirm && pendingConfirm.id === id) { pendingConfirm = null; resolve(false); } }, { once: true });
    }),
    release: () => { for (const t of agentTabs) { t.noFx = false; if (!t.view.webContents.isDestroyed()) updateEffect(t); } agentTabs.length = 0; }
  };
}

const remember = (user, assistant) => { chatHistory.push({ role: 'user', content: user }, { role: 'assistant', content: String(assistant || '').slice(0, 1500) }); chatHistory = chatHistory.slice(-8); };

ipcMain.handle('ai-ask', async (_e, { text, mode }) => {
  const send = (ch, p) => win?.webContents.send(ch, p);
  if (IS_SANDBOX) { send('ai-chunk', 'Im isolierten Modus ist die KI aus. Seiten, denen du nicht traust, sollen keinen Zugriff auf einen Assistenten bekommen.'); send('ai-done'); return; }
  aiAbort?.abort();
  aiAbort = new AbortController();
  const signal = aiAbort.signal;
  let model = data.settings.model;
  try {
    send('ai-status', 'Starte lokale KI ...');
    if (!(await ai.ensureOllama())) { send('ai-chunk', 'Ollama läuft nicht und ließ sich nicht starten.'); return; }
    // Steht noch das Standardmodell (3b) und ist ein groesseres Qwen installiert, nimmt der Assistent das (viel klueger bei Aufgaben)
    if (model === 'qwen2.5:3b') { const big = (await ai.models()).find(n => /^qwen2\.5:(7|14)b$/.test(n)); if (big) model = big; }
  } catch {}
  const ctx = agentContext(send, signal, model);
  try {
    if (!(await ai.ensureOllama())) { send('ai-chunk', 'Ollama läuft nicht und ließ sich nicht starten.'); return; }
    if (mode === 'auto') mode = actions.routeMode(text);

    if (mode === 'mission') { const report = await mission.runMission(text, ctx); remember(text, report); return; }

    // Aufgaben abarbeiten (Duolingo, Quizze, Hausaufgaben ...): laeuft, bis nichts mehr uebrig ist
    if (mode === 'worker' || (mode === 'page' && worker.isTaskRequest(text))) {
      const report = await worker.runWorker(text, ctx);
      if (report) remember(text, report);
      return;
    }

    if (mode === 'action') {
      send('ai-status', 'Plane Schritte ...');
      const plan = await actions.plan(model, text, signal);
      if (plan.type === 'tasks') { const report = await worker.runWorker(text, ctx); if (report) remember(text, report); return; }
      if (plan.type === 'research') mode = 'research';
      else if (plan.type === 'chat' || !plan.steps.length) mode = 'chat';
      else { const summary = await actions.run(plan, ctx); remember(text, summary); return; }
    }

    if (mode === 'page' && data.settings.cursorMode !== false) {
      // Mit Cursor: die KI bedient die Seite sichtbar (klicken, tippen, kopieren) und zeigt Fundstellen
      const r = await pageagent.interact(text || 'Fasse diese Seite kurz zusammen.', ctx);
      if (r) remember(text || 'Seite zusammenfassen', r.text);
      return;
    }

    if (mode === 'research') {
      await ai.research(text, { ...ctx, addNote: n => { data.notes.unshift(n); saveData(); send('notes', data.notes); } });
      return;
    }

    // Chat (und "Diese Seite" ohne Cursor: nur antworten)
    let content = text;
    if (mode === 'page') {
      const wc = active();
      const p = wc && /^https?:/.test(wc.getURL()) ? await ai.pageText(wc) : null;
      if (!p) { send('ai-chunk', 'Auf dieser Seite gibt es nichts zu lesen.'); return; }
      content = `${text || 'Fasse diese Seite kurz zusammen.'}\n\nSeite: ${p.title}\n\n${p.text}`;
    }
    chatHistory.push({ role: 'user', content });
    chatHistory = chatHistory.slice(-8);
    send('ai-status', 'Denke nach ...');
    const answer = await ai.chat(model, [{ role: 'system', content: 'Du bist Shield, ein hilfreicher Assistent im Browser. Antworte auf Deutsch, kurz und klar.' }, ...chatHistory], { signal, onChunk: t => send('ai-chunk', t) });
    chatHistory.push({ role: 'assistant', content: answer });
    send('ai-chunk', answer);
  } catch (err) {
    if (!(err instanceof ai.Aborted) && !signal.aborted) send('ai-chunk', 'Fehler: ' + err.message);
  } finally {
    ctx.release();
    send('ai-done');
  }
});

// ---------- IPC: Isolierter Modus ----------
const sbChildren = [];
ipcMain.handle('sandbox-launch', (_e, opts) => {
  if (IS_SANDBOX) return { ok: false };
  try {
    const level = sandbox.LEVELS.includes(opts && opts.level) ? opts.level : 'strict';
    const proxy = typeof (opts && opts.proxy) === 'string' ? opts.proxy.trim() : '';
    if (proxy && !/^(socks5h?|socks4|https?):\/\/[\w.\-\[\]:]+$/i.test(proxy)) return { ok: false, error: 'Proxy-Adresse ungültig (Beispiel: socks5://127.0.0.1:9050)' };
    const r = sandbox.launch(app, { level, proxy, debugPort: opts && opts.debugPort });
    sbChildren.push(r);
    return { ok: true, pid: r.pid };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('sb-get', () => (IS_SANDBOX ? { level: sbState.level, proxy: sbState.proxy, scripts: sbState.scripts, doh: sbState.doh, stats: sbState.stats } : null));
ipcMain.handle('sb-set-doh', async (_e, on) => {
  if (!IS_SANDBOX) return null;
  sbState.doh = !!on; applyDoh();
  try { await ses.clearHostResolverCache(); } catch {}
  return sbState.doh;
});
ipcMain.handle('sb-set-level', (_e, level) => {
  if (!IS_SANDBOX || !sandbox.LEVELS.includes(level)) return null;
  sbState.level = level; sbState.scripts = level !== 'max';
  if (level === 'max') ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }).catch(() => {}); // schon gesetzte Spuren wegraeumen
  for (const t of tabs) { sandbox.hardenSafe(t.view.webContents, sbState).then(ok => { try { if (ok) t.view.webContents.reload(); } catch {} }); }
  layout(); broadcastSettings();
  return { level: sbState.level, scripts: sbState.scripts };
});
ipcMain.handle('sb-set-scripts', async (_e, on) => {
  if (!IS_SANDBOX) return null;
  sbState.scripts = !!on;
  for (const t of tabs) { await sandbox.setScripts(t.view.webContents, sbState.scripts); try { t.view.webContents.reload(); } catch {} }
  return sbState.scripts;
});
ipcMain.handle('sb-set-proxy', async (_e, proxy) => {
  if (!IS_SANDBOX) return null;
  proxy = String(proxy || '').trim();
  if (proxy && !/^(socks5h?|socks4|https?):\/\/[\w.\-\[\]:]+$/i.test(proxy)) return { ok: false, error: 'Proxy-Adresse ungültig (Beispiel: socks5://127.0.0.1:9050)' };
  sbState.proxy = proxy;
  await sandbox.applyProxy(ses, sbState);
  return { ok: true, proxy };
});
// Alles vernichten: Tabs zu, Speicher leeren, neue Kennung
ipcMain.handle('sb-wipe', async () => {
  if (!IS_SANDBOX) return false;
  for (const t of [...tabs]) { try { if (t.view.webContents.debugger.isAttached()) t.view.webContents.debugger.detach(); } catch {} win.contentView.removeChildView(t.view); t.view.webContents.close(); }
  tabs = []; activeId = null;
  await sandbox.wipe(ses);
  sbState.seed = require('crypto').randomInt(1, 2 ** 31 - 1);
  for (const k of Object.keys(sbState.stats)) sbState.stats[k] = 0;
  win?.webContents.send('sb-stats', sbState.stats);
  newTab(home());
  return true;
});

app.whenReady().then(() => {
  dataFile = path.join(app.getPath('userData'), 'shield-data.json');
  loadData();
  if (IS_SANDBOX) { setupSandbox(); sandbox.cleanupStale(app.getPath('userData')); } else setupPrivacy();
  createWindow();
  if (!IS_SANDBOX && data.settings.fxAuto) ai.ensureOllama().catch(() => {}); // lokale KI vorwaermen, damit Seitenentscheidungen schnell kommen
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (IS_SANDBOX && ses) { try { ses.clearStorageData(); ses.clearCache(); } catch {} }
});
