// Isolierter Modus ("Quarantaene"): eigener Prozess mit Wegwerf-Profil, getrennte Sitzung nur im Arbeitsspeicher,
// Schutz vor Tracking und Fingerabdruecken, Sperre fuer Downloads, Berechtigungen und Popups.
// Ehrliche Grenzen: Ohne Proxy/Tor/VPN sieht die besuchte Seite weiterhin deine IP-Adresse. Es ersetzt keinen Virenscanner.
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { isBlocked } = require('./blocklist');
const compat = require('./compat');

const LEVELS = ['normal', 'strict', 'max'];

// ---------- Zustand ----------
function parseArgs(argv) {
  const get = k => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : ''; };
  const level = get('sandbox-level');
  return { enabled: argv.includes('--shield-sandbox'), level: LEVELS.includes(level) ? level : 'strict', proxy: get('sandbox-proxy') };
}

function createState({ level = 'strict', proxy = '' } = {}) {
  return {
    level: LEVELS.includes(level) ? level : 'strict',
    proxy: String(proxy || ''),
    scripts: level !== 'max',                      // JavaScript in den Seiten
    doh: true,                                     // verschluesseltes DNS
    seed: crypto.randomInt(1, 2 ** 31 - 1),        // nur fuer diese Sitzung
    stats: { trackers: 0, thirdParty: 0, downloads: 0, permissions: 0, popups: 0, cookies: 0, upgraded: 0 }
  };
}

// ---------- Seiten-Zuordnung (ohne Public-Suffix-Liste: gaengige Doppel-Endungen) ----------
const SLD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.cn', 'com.tr', 'co.nz', 'co.za', 'com.mx', 'com.ar', 'com.tw', 'com.hk', 'com.sg', 'co.in', 'co.kr', 'com.ua', 'com.pl', 'com.es', 'co.id', 'com.my', 'com.ph', 'com.vn']);
function siteOf(host) {
  host = String(host || '').toLowerCase();
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const p = host.split('.');
  if (p.length <= 2) return host;
  const last2 = p.slice(-2).join('.');
  return SLD.has(last2) ? p.slice(-3).join('.') : last2;
}
const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
const isLocalHost = h => /^(localhost|127\.|192\.168\.|10\.|\[::1\]$)/.test(h);

// Im Modus "streng" duerfen Drittanbieter nur Bilder, Stile, Schriften und Medien liefern (ohne Cookies und Herkunft)
const SOFT_TYPES = new Set(['image', 'stylesheet', 'font', 'media']);

// ---------- Erscheinungsbild des Browsers: ein ganz normaler, haeufiger Chrome unter Windows ----------
// Dieselbe Kennung wie im normalen Modus (stimmige Chrome-Marken), nur mit festem Platform-Stand
const makeUA = compat.uaString;
function uaMetadata() { return { ...compat.userAgentMetadata(), platformVersion: '10.0.0' }; }

// ---------- Schutz vor Fingerabdruecken (laeuft vor allen Seiten-Skripten) ----------
function fingerprintScript(seed, level) {
  const fn = (seed, level) => {
    const def = (o, k, v) => { try { Object.defineProperty(o, k, { get: () => v, configurable: true, enumerable: true }); } catch (e) {} };
    const hash = (a, b) => { let h = (a ^ b) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; };
    let oh = 0; for (const c of String(location.hostname)) oh = (Math.imul(oh, 31) + c.charCodeAt(0)) >>> 0;
    const s = (seed ^ oh) >>> 0;                         // pro Seite stabil, zwischen Seiten verschieden

    // Navigator: ueberall dieselben, haeufigen Werte
    const N = Navigator.prototype;
    def(N, 'hardwareConcurrency', 4); def(N, 'deviceMemory', 8); def(N, 'language', 'en-US');
    def(N, 'languages', Object.freeze(['en-US', 'en'])); def(N, 'platform', 'Win32'); def(N, 'maxTouchPoints', 0);
    def(N, 'doNotTrack', '1'); def(N, 'globalPrivacyControl', true); def(N, 'connection', undefined);
    try { delete N.getBattery; } catch (e) {}
    try { delete N.keyboard; } catch (e) {}

    // Bildschirm: Standardgroesse, Fenstergroesse = Seitengroesse
    const S = Screen.prototype;
    def(S, 'width', 1920); def(S, 'height', 1080); def(S, 'availWidth', 1920); def(S, 'availHeight', 1040); def(S, 'colorDepth', 24); def(S, 'pixelDepth', 24);
    try { Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true }); Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight, configurable: true }); } catch (e) {}
    def(window, 'screenX', 0); def(window, 'screenY', 0);

    // Canvas: winziges, pro Seite stabiles Rauschen (verhindert eindeutige Zeichen-Fingerabdruecke)
    const noisy = id => { const d = id.data; for (let i = 0; i < d.length; i += 4) { const h = hash(s, i >> 2); if ((h & 31) === 0) { d[i] ^= 1; d[i + 1] ^= (h >> 8) & 1; d[i + 2] ^= (h >> 9) & 1; } } return id; };
    try {
      const gid = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...a) { const id = gid.apply(this, a); try { return noisy(id); } catch (e) { return id; } };
      const copyNoisy = c => { if (!(c.width * c.height > 0) || c.width * c.height > 4e6) return null; const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); x.putImageData(noisy(gid.call(x, 0, 0, t.width, t.height)), 0, 0); return t; };
      const tdu = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...a) { try { const t = copyNoisy(this); if (t) return tdu.apply(t, a); } catch (e) {} return tdu.apply(this, a); };
      const tb = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...a) { try { const t = copyNoisy(this); if (t) return tb.call(t, cb, ...a); } catch (e) {} return tb.call(this, cb, ...a); };
    } catch (e) {}

    // WebGL: allgemeine Grafikkarten-Angaben
    const patchGL = proto => { const gp = proto.getParameter; proto.getParameter = function (p) { if (p === 37445) return 'Google Inc. (Intel)'; if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'; return gp.call(this, p); }; };
    try { if (window.WebGLRenderingContext) patchGL(WebGLRenderingContext.prototype); if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext.prototype); } catch (e) {}

    // Audio: kaum hoerbares Rauschen
    try {
      const seen = new WeakSet(), gcd = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function (...a) { const d = gcd.apply(this, a); if (!seen.has(d)) { seen.add(d); for (let i = 0; i < d.length; i += 97) d[i] += ((hash(s, i) % 7) - 3) * 1e-7; } return d; };
      const gfd = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function (arr) { gfd.call(this, arr); for (let i = 0; i < arr.length; i += 7) arr[i] += ((hash(s, i) % 5) - 2) * 1e-4; };
    } catch (e) {}

    // Geraete und Sprachausgabe: keine Auflistung
    try { if (navigator.mediaDevices) { navigator.mediaDevices.enumerateDevices = async () => []; navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); } } catch (e) {}
    try { if (window.speechSynthesis) window.speechSynthesis.getVoices = () => []; } catch (e) {}

    // Zeitmessung gröber (erschwert Zeit-Angriffe)
    try { const pn = Performance.prototype.now, step = level === 'max' ? 10 : 1; Performance.prototype.now = function () { return Math.floor(pn.call(this) / step) * step; }; } catch (e) {}

    // Maximal: kein WebRTC (verraet sonst lokale Adressen)
    if (level === 'max') for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate']) { try { delete window[k]; } catch (e) {} try { window[k] = undefined; } catch (e) {} }
  };
  return `(${fn})(${seed | 0}, ${JSON.stringify(level)})`;
}

// ---------- Netzwerkregeln der isolierten Sitzung ----------
// hooks: { stat(), toast(text), allowFile(url) }
function setupSession(ses, st, hooks) {
  const UA = makeUA();
  const topHost = d => { try { return d.webContents ? hostOf(d.webContents.getURL()) : ''; } catch { return ''; } };
  const isThird = (d, host) => { const top = topHost(d); return !!top && d.resourceType !== 'mainFrame' && siteOf(top) !== siteOf(host); };
  const bump = k => { st.stats[k]++; hooks.stat && hooks.stat(); };

  try { ses.setUserAgent(UA, 'en-US,en'); } catch {}

  ses.webRequest.onBeforeRequest((d, cb) => {
    let u;
    try { u = new URL(d.url); } catch { return cb({ cancel: true }); }
    const p = u.protocol;
    if (p === 'data:' || p === 'blob:') return cb({});
    if (p === 'file:') return cb({ cancel: !(hooks.allowFile && hooks.allowFile(d.url)) });
    const isWs = p === 'ws:' || p === 'wss:';
    if (!isWs && p !== 'http:' && p !== 'https:') return cb({ cancel: true });            // keine fremden Protokolle (ftp:, mailto:, ...)
    if (isBlocked(u.hostname)) { bump('trackers'); return cb({ cancel: true }); }
    if (p === 'http:' && !isLocalHost(u.hostname)) { u.protocol = 'https:'; bump('upgraded'); return cb({ redirectURL: u.toString() }); }   // nur HTTPS
    if (isWs && st.level === 'max') { bump('thirdParty'); return cb({ cancel: true }); }
    if (st.level !== 'normal' && isThird(d, u.hostname)) {
      if (st.level === 'max' || !SOFT_TYPES.has(d.resourceType)) { bump('thirdParty'); return cb({ cancel: true }); }
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    const h = d.requestHeaders;
    const del = k => { for (const key of Object.keys(h)) if (key.toLowerCase() === k.toLowerCase()) delete h[key]; };
    del('User-Agent'); h['User-Agent'] = UA;
    del('Accept-Language'); h['Accept-Language'] = 'en-US,en;q=0.9';
    h['DNT'] = '1'; h['Sec-GPC'] = '1';
    let host = ''; try { host = new URL(d.url).hostname; } catch {}
    // Herkunft nur innerhalb derselben Seite mitsenden
    const ref = Object.keys(h).find(k => k.toLowerCase() === 'referer');
    if (ref && siteOf(hostOf(h[ref])) !== siteOf(host)) delete h[ref];
    if (st.level === 'max' || isThird(d, host)) del('Cookie');
    cb({ requestHeaders: h });
  });

  ses.webRequest.onHeadersReceived((d, cb) => {
    const h = d.responseHeaders || {};
    let host = ''; try { host = new URL(d.url).hostname; } catch {}
    if (st.level === 'max' || isThird(d, host)) {
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'set-cookie') { delete h[k]; bump('cookies'); }
    }
    cb({ responseHeaders: h });
  });

  // Nichts darf auf Geraete oder Daten zugreifen
  ses.setPermissionRequestHandler((_wc, _perm, cb) => { bump('permissions'); cb(false); });
  ses.setPermissionCheckHandler(() => false);
  if (ses.setDevicePermissionHandler) ses.setDevicePermissionHandler(() => false);
  try { ses.setSpellCheckerEnabled(false); } catch {}

  // Keine Downloads
  ses.on('will-download', (e, item) => { e.preventDefault(); bump('downloads'); hooks.toast && hooks.toast('Download blockiert: ' + item.getFilename()); });
}

async function applyProxy(ses, st) {
  try {
    if (st.proxy) await ses.setProxy({ proxyRules: st.proxy });
    else await ses.setProxy({ mode: 'direct' });
  } catch {}
}

// ---------- Pro Tab: Erscheinungsbild vereinheitlichen, Skripte, WebRTC ----------
// Der Tab muss schon eine (leere) Seite geladen haben, sonst antwortet der Debugger nicht.
// Gibt true zurueck, wenn die wichtigen Schutzschritte geklappt haben (sonst wird nichts geladen).
async function hardenWebContents(wc, st) {
  try { wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch {}
  try { wc.setUserAgent(makeUA()); } catch {}
  const dbg = !!process.env.SHIELD_DEBUG;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const send = (m, p) => wc.debugger.sendCommand(m, p).catch(e => { if (dbg) console.log('cdp ERR', m, String(e && e.message).slice(0, 120)); return null; });
    await send('Page.enable');
    const ua = await send('Emulation.setUserAgentOverride', { userAgent: makeUA(), acceptLanguage: 'en-US,en', platform: 'Win32', userAgentMetadata: uaMetadata() });
    await send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    await send('Emulation.setLocaleOverride', { locale: 'en-US' });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    if (wc.__fpScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: wc.__fpScript });
    const sc = await send('Page.addScriptToEvaluateOnNewDocument', { source: fingerprintScript(st.seed, st.level), runImmediately: true });
    wc.__fpScript = sc && sc.identifier;
    if (!wc.__chromeStub) { const cs = await send('Page.addScriptToEvaluateOnNewDocument', { source: compat.chromeStubScript(), runImmediately: true }); wc.__chromeStub = cs && cs.identifier; }
    await send('Emulation.setScriptExecutionDisabled', { value: !st.scripts });
    return !!(ua && sc && sc.identifier);
  } catch (e) { if (dbg) console.log('harden failed', e.message); return false; }
}

// Absichern mit Zeitlimit: haengt der Debugger, gilt der Tab als nicht abgesichert
async function hardenSafe(wc, st, ms = 6000) {
  return Promise.race([hardenWebContents(wc, st), new Promise(r => setTimeout(() => r(false), ms))]);
}

// Skripte an/aus fuer einen schon offenen Tab
async function setScripts(wc, on) {
  try { if (wc.debugger.isAttached()) await wc.debugger.sendCommand('Emulation.setScriptExecutionDisabled', { value: !on }); } catch {}
}

function tabPreferences(session) {
  return {
    session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, webSecurity: true,
    allowRunningInsecureContent: false, enableWebSQL: false, plugins: false, navigateOnDragDrop: false,
    safeDialogs: true, disableDialogs: true, autoplayPolicy: 'document-user-activation-required', webviewTag: false
  };
}

// ---------- Spuren vernichten ----------
async function wipe(ses) {
  try { await ses.clearStorageData(); } catch {}
  try { await ses.clearCache(); } catch {}
  try { await ses.clearAuthCache(); } catch {}
  try { await ses.clearHostResolverCache(); } catch {}
  try { await ses.closeAllConnections(); } catch {}
}

// ---------- Start einer isolierten Instanz (eigener Prozess, eigenes Wegwerf-Profil) ----------
function rmDir(dir, tries = 8) {
  const attempt = n => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch { if (n > 0) setTimeout(() => attempt(n - 1), 1500); }
  };
  attempt(tries);
}

function launch(app, opts) {
  const dir = path.join(os.tmpdir(), 'shield-sandbox-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  const args = app.isPackaged ? [] : [app.getAppPath()];
  args.push('--shield-sandbox', `--sandbox-level=${LEVELS.includes(opts.level) ? opts.level : 'strict'}`, `--user-data-dir=${dir}`);
  if (opts.proxy) args.push(`--sandbox-proxy=${opts.proxy}`);
  if (opts.debugPort) args.push(`--remote-debugging-port=${opts.debugPort}`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, args, { stdio: 'ignore', env, windowsHide: false });
  try { fs.writeFileSync(path.join(dir, 'shield-owner.pid'), String(child.pid)); } catch {} // damit spaetere Aufraeumlaeufe laufende Instanzen nicht anfassen
  child.on('exit', () => setTimeout(() => rmDir(dir), 2000));
  child.on('error', () => rmDir(dir));
  return { pid: child.pid, dir, child };
}

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Aeltere, liegengebliebene Wegwerf-Profile aufraeumen (z. B. nach einem Absturz)
function cleanupStale(currentDir) {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith('shield-sandbox-')) continue;
      const full = path.join(os.tmpdir(), name);
      if (currentDir && path.resolve(full) === path.resolve(currentDir)) continue;
      // Gehoert die Mappe noch einer laufenden isolierten Instanz, bleibt sie unberuehrt
      try { const pid = parseInt(fs.readFileSync(path.join(full, 'shield-owner.pid'), 'utf8'), 10); if (pid && pidAlive(pid)) continue; } catch {}
      let age = 0; try { age = Date.now() - fs.statSync(full).mtimeMs; } catch { continue; }
      if (age > 30 * 60 * 1000) rmDir(full, 2);
    }
  } catch {}
}

module.exports = { LEVELS, parseArgs, createState, siteOf, makeUA, setupSession, applyProxy, hardenWebContents, hardenSafe, setScripts, tabPreferences, wipe, launch, cleanupStale, rmDir };
