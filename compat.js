// Chrome-kompatible Kennung: Shield soll sich gegenueber Webseiten (z. B. der Google-Anmeldung) wie ein ganz normaler Chrome
// verhalten. Dazu gehoert ein stimmiger User-Agent, die passenden Client-Hints-Marken (Sec-CH-UA), ein gueltiger Sprach-Header
// und das kleine window.chrome-Geruest, das jeder Chrome auf normalen Seiten mitbringt.
const os = require('os');
const { app } = require('electron');

const GREASE = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];

function versions() {
  const full = String(process.versions.chrome || '124.0.0.0');
  return { full, major: parseInt(full.split('.')[0], 10) || 124 };
}

// Reduzierter Chrome-User-Agent (so sendet ihn Chrome seit Version 101)
function uaString() {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versions().major}.0.0.0 Safari/537.36`;
}

// Markenliste nach dem Muster von Chromium: Fuellmarke "Not?A_Brand", Chromium und Google Chrome in versionsabhaengiger Reihenfolge
function brandLists(majorOverride, fullOverride) {
  const v = versions();
  const major = majorOverride || v.major, full = fullOverride || v.full;
  const gBrand = `Not${GREASE[major % 11]}A${GREASE[(major + 1) % 11]}Brand`;
  const gVer = ['8', '99', '24'][major % 3];
  const order = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]][major % 6];
  const items = [[gBrand, gVer, gVer + '.0.0.0'], ['Chromium', String(major), full], ['Google Chrome', String(major), full]];
  const brands = [], fullList = [];
  items.forEach(([b, v, f], i) => { brands[order[i]] = { brand: b, version: v }; fullList[order[i]] = { brand: b, version: f }; });
  return { brands, fullVersionList: fullList };
}

function platformVersion() {
  const build = parseInt(String(os.release()).split('.')[2], 10) || 0;
  return build >= 26100 ? '19.0.0' : build >= 22631 ? '15.0.0' : build >= 22621 ? '14.0.0' : build >= 22000 ? '13.0.0' : '10.0.0';
}

// Fuer den Debugger-Befehl Emulation.setUserAgentOverride
function userAgentMetadata() {
  const l = brandLists();
  return { brands: l.brands, fullVersionList: l.fullVersionList, platform: 'Windows', platformVersion: platformVersion(), architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false };
}

// Sprachliste ohne q-Werte (Chromium erzeugt die Gewichtung selbst), z. B. "de-DE,de,en-US,en"
function acceptLanguages() {
  let prefs = [];
  try { prefs = app.getPreferredSystemLanguages(); } catch {}
  if (!prefs.length) prefs = [app.getLocale() || 'en-US'];
  const out = [];
  for (const l of prefs) { if (!out.includes(l)) out.push(l); const b = l.split('-')[0]; if (!out.includes(b)) out.push(b); }
  return out.slice(0, 6).join(',');
}

// Die drei Standard-Hinweise, die Chrome bei jeder HTTPS-Anfrage mitschickt
function lowEntropyHints() {
  const q = l => l.brands.map(b => `"${b.brand}";v="${b.version}"`).join(', ');
  return { 'Sec-CH-UA': q(brandLists()), 'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Platform': '"Windows"' };
}

// window.chrome wie in einem normalen Chrome (loadTimes, csi, app); in Electron ist das Objekt leer
function chromeStubScript() {
  const fn = () => {
    const c = window.chrome || {};
    if (c.loadTimes && c.csi && c.app) return;
    const t = () => performance.timing;
    c.loadTimes = function () {
      const p = t(), s = p.navigationStart / 1000;
      return { requestTime: s, startLoadTime: s, commitLoadTime: p.responseStart / 1000, finishDocumentLoadTime: p.domContentLoadedEventEnd / 1000, finishLoadTime: p.loadEventEnd / 1000, firstPaintTime: p.domContentLoadedEventEnd / 1000, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' };
    };
    c.csi = function () { const p = t(); return { onloadT: p.loadEventEnd, startE: p.navigationStart, pageT: Date.now() - p.navigationStart, tran: 15 }; };
    c.app = {
      isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails() { return null; }, getIsInstalled() { return false; }, installState(cb) { if (cb) cb('not_installed'); }, runningState() { return 'cannot_run'; }
    };
    try { Object.defineProperty(window, 'chrome', { value: c, writable: true, configurable: true, enumerable: true }); } catch (e) { window.chrome = c; }
  };
  return `(${fn})()`;
}

// Setzt die Kennung fuer einen Tab (er muss schon eine leere Seite geladen haben, sonst antwortet der Debugger nicht).
// Gibt true zurueck, wenn es geklappt hat.
async function apply(wc, opts = {}) {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const send = (m, p) => wc.debugger.sendCommand(m, p).catch(() => null);
    await send('Page.enable');
    const ua = await send('Emulation.setUserAgentOverride', { userAgent: uaString(), acceptLanguage: opts.langs || acceptLanguages(), platform: 'Win32', userAgentMetadata: userAgentMetadata() });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: chromeStubScript(), runImmediately: true });
    return !!ua;
  } catch { return false; }
}

// Mit Zeitlimit: haengt der Debugger, wird die Seite trotzdem geladen (im normalen Modus ist das kein Sicherheitsrisiko)
const applySafe = (wc, opts, ms = 3000) => Promise.race([apply(wc, opts), new Promise(r => setTimeout(() => r(false), ms))]);

module.exports = { uaString, brandLists, userAgentMetadata, acceptLanguages, lowEntropyHints, chromeStubScript, apply, applySafe };
