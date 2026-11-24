// Aktions-Planer: setzt kurze Wuensche wie "oeffne ein YouTube-Video ueber den Fuji" im Browser um
// (sichtbar mit simuliertem Cursor) und entscheidet im Auto-Modus, was der Nutzer will.
const { chat, sleep, cursor, Aborted } = require('./agent');
const T = require('./webtools');
const { isTaskRequest } = require('./worker');
const { SITES, str, normUrl, isRisky } = T;

const ALLOWED = ['search', 'open', 'click', 'type', 'scroll', 'media', 'tab', 'bookmark', 'wait'];
const MEDIA_CMDS = ['play', 'pause', 'mute', 'unmute', 'faster', 'slower', 'skip', 'rewind', 'louder', 'quieter', 'next'];
const TAB_CMDS = ['new', 'close', 'next_tab', 'prev_tab', 'back', 'forward', 'reload'];

// ---------- Planer: Wunsch -> Schritte ----------
const SYSTEM = `You control a web browser for the user. Turn the user's request into a JSON plan.
Reply ONLY with JSON: {"type":"actions" or "research" or "chat" or "tasks","say":"one short sentence in German about what you do","steps":[...]}.
type "actions": the request asks to open, play, search, go to, click, type, scroll, close or bookmark something in the browser.
type "research": the user wants information found and summarised from several web pages.
type "tasks": the user wants exercises, lessons, quizzes or homework on a website worked through (for example "do the tasks in Duolingo"); then "steps" is empty. NEVER answer such a request with a YouTube search.
type "chat": a plain question or conversation; then "steps" is empty.
Steps (use only these):
{"do":"search","site":"youtube|wikipedia|web|images|maps|github|reddit|amazon|ebay|twitch|spotify","query":"...","open":N}  (open N = open result number N, 0 = only show results; for YouTube the video is started)
{"do":"open","url":"https://..."}  (open a website)
{"do":"click","text":"visible text of a link or button on the current page"}
{"do":"type","text":"...","submit":true}  (type into the search or text field of the current page)
{"do":"scroll","dir":"down|up|top|bottom"}
{"do":"media","cmd":"play|pause|mute|unmute|faster|slower|skip|rewind|louder|quieter|next"}  (control the playing video; skip = 10 s forward, rewind = 10 s back, next = next video)
{"do":"tab","cmd":"new|close|next_tab|prev_tab|back|forward|reload"}
{"do":"bookmark"}
{"do":"wait","seconds":2}
Keep plans short (at most 5 steps). To play or open a video, search YouTube with open 1.`;

const SHOTS = [
  ['Öffne ein YouTube Video über den Mount Fuji', { type: 'actions', say: 'Ich suche auf YouTube nach Mount Fuji und starte das erste Video.', steps: [{ do: 'search', site: 'youtube', query: 'Mount Fuji', open: 1 }] }],
  ['Spiel lofi hip hop auf YouTube', { type: 'actions', say: 'Ich starte lofi hip hop auf YouTube.', steps: [{ do: 'search', site: 'youtube', query: 'lofi hip hop', open: 1 }] }],
  ['Öffne das zweite YouTube-Video zu Sushi', { type: 'actions', say: 'Ich öffne das zweite Sushi-Video.', steps: [{ do: 'search', site: 'youtube', query: 'Sushi', open: 2 }] }],
  ['Geh auf spiegel.de', { type: 'actions', say: 'Ich öffne spiegel.de.', steps: [{ do: 'open', url: 'https://www.spiegel.de' }] }],
  ['Such bei Wikipedia nach Kirschblüte und öffne den Artikel', { type: 'actions', say: 'Ich öffne den Wikipedia-Artikel zur Kirschblüte.', steps: [{ do: 'search', site: 'wikipedia', query: 'Kirschblüte', open: 1 }] }],
  ['Zeig mir Bilder von Katzen', { type: 'actions', say: 'Ich zeige dir Katzenbilder.', steps: [{ do: 'search', site: 'images', query: 'Katzen', open: 0 }] }],
  ['Such nach günstigen Kopfhörern bei Amazon', { type: 'actions', say: 'Ich suche bei Amazon nach Kopfhörern.', steps: [{ do: 'search', site: 'amazon', query: 'günstige Kopfhörer', open: 0 }] }],
  ['Pausiere das Video', { type: 'actions', say: 'Ich pausiere das Video.', steps: [{ do: 'media', cmd: 'pause' }] }],
  ['Mach das Video schneller', { type: 'actions', say: 'Ich erhöhe das Tempo.', steps: [{ do: 'media', cmd: 'faster' }] }],
  ['Spiel das Video weiter', { type: 'actions', say: 'Ich setze die Wiedergabe fort.', steps: [{ do: 'media', cmd: 'play' }] }],
  ['Spring zum nächsten Video', { type: 'actions', say: 'Ich springe zum nächsten Video.', steps: [{ do: 'media', cmd: 'next' }] }],
  ['Schalte den Ton aus', { type: 'actions', say: 'Ich schalte den Ton aus.', steps: [{ do: 'media', cmd: 'mute' }] }],
  ['Spul zehn Sekunden vor', { type: 'actions', say: 'Ich springe zehn Sekunden vor.', steps: [{ do: 'media', cmd: 'skip' }] }],
  ['Schließe diesen Tab und öffne einen neuen', { type: 'actions', say: 'Ich schließe den Tab und öffne einen neuen.', steps: [{ do: 'tab', cmd: 'close' }, { do: 'tab', cmd: 'new' }] }],
  ['Setz ein Lesezeichen und scrolle ein Stück runter', { type: 'actions', say: 'Ich setze ein Lesezeichen und scrolle nach unten.', steps: [{ do: 'bookmark' }, { do: 'scroll', dir: 'down' }] }],
  ['Mach die Aufgaben in Duolingo', { type: 'tasks', say: 'Ich bearbeite die Aufgaben auf Duolingo.', steps: [] }],
  ['Bearbeite die Übungen auf dieser Seite', { type: 'tasks', say: 'Ich bearbeite die Übungen auf dieser Seite.', steps: [] }],
  ['Was ist die Hauptstadt von Australien?', { type: 'chat', say: '', steps: [] }],
  ['Recherchiere die neuesten Entwicklungen bei Kernfusion', { type: 'research', say: '', steps: [] }]
];

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['actions', 'research', 'chat', 'tasks'] },
    say: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          do: { type: 'string', enum: ALLOWED },
          site: { type: 'string', enum: Object.keys(SITES) },
          query: { type: 'string' }, open: { type: 'integer' }, url: { type: 'string' }, text: { type: 'string' },
          submit: { type: 'boolean' }, dir: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] },
          cmd: { type: 'string', enum: [...MEDIA_CMDS, ...TAB_CMDS] }, seconds: { type: 'integer' }
        },
        required: ['do']
      }
    }
  },
  required: ['type', 'say', 'steps']
};

function cleanStep(s) {
  if (!s || !ALLOWED.includes(s.do)) return null;
  const o = { do: s.do };
  if (s.do === 'search') {
    o.site = SITES[s.site] ? s.site : 'web';
    o.query = str(s.query, 120);
    o.open = Number.isFinite(+s.open) ? Math.max(0, Math.min(10, Math.floor(+s.open))) : 0;
    if (!o.query) return null;
  } else if (s.do === 'open') {
    o.url = normUrl(s.url);
    if (!o.url) return null;
  } else if (s.do === 'click') {
    o.text = str(s.text, 80);
    if (!o.text) return null;
  } else if (s.do === 'type') {
    o.text = str(s.text, 200);
    o.submit = s.submit !== false;
    if (!o.text) return null;
  } else if (s.do === 'scroll') {
    o.dir = ['down', 'up', 'top', 'bottom'].includes(s.dir) ? s.dir : 'down';
  } else if (s.do === 'media') {
    if (!MEDIA_CMDS.includes(s.cmd)) return null;
    o.cmd = s.cmd;
  } else if (s.do === 'tab') {
    if (!TAB_CMDS.includes(s.cmd)) return null;
    o.cmd = s.cmd;
  } else if (s.do === 'wait') {
    o.seconds = Math.max(1, Math.min(10, Math.floor(+s.seconds) || 2));
  }
  return o;
}

// Rueckfall, falls die KI kein brauchbares JSON liefert: die haeufigsten Wuensche per Regel
function fallbackPlan(text) {
  const low = text.toLowerCase();
  const query = str(text.replace(/(^|\s)(öffne|oeffne|spiel|spiele|starte|zeig|zeige|mir|ein|eine|einen|das|den|die|bitte|auf|bei|in|video|videos|clip|über|ueber|zu|von|youtube|wikipedia|nach|suche|such|und|mach|mache)(?=\s|$)/gi, ' '), 120);
  if (/youtube/.test(low) && query) return { type: 'actions', say: 'Ich suche auf YouTube und starte das erste Video.', steps: [{ do: 'search', site: 'youtube', query, open: 1 }] };
  if (/wikipedia/.test(low) && query) return { type: 'actions', say: 'Ich öffne den Wikipedia-Artikel.', steps: [{ do: 'search', site: 'wikipedia', query, open: 1 }] };
  const dom = text.match(/\b((?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)/);
  const url = dom && normUrl(dom[1]);
  if (url) return { type: 'actions', say: 'Ich öffne die Seite.', steps: [{ do: 'open', url }] };
  if (/^\s*(such|suche)/i.test(text) && query) return { type: 'actions', say: 'Ich suche im Web.', steps: [{ do: 'search', site: 'web', query, open: 0 }] };
  return null;
}

async function plan(model, text, signal) {
  const messages = [{ role: 'system', content: SYSTEM }];
  for (const [u, p] of SHOTS) messages.push({ role: 'user', content: u }, { role: 'assistant', content: JSON.stringify(p) });
  messages.push({ role: 'user', content: text });
  let raw;
  try { raw = await chat(model, messages, { json: PLAN_SCHEMA, signal }); }
  catch (e) { if (signal && signal.aborted) throw new Aborted(); try { raw = await chat(model, messages, { json: true, signal }); } catch { raw = ''; } }
  let p = null;
  try {
    const j = JSON.parse(raw);
    const steps = (Array.isArray(j.steps) ? j.steps : []).map(cleanStep).filter(Boolean).slice(0, 6);
    p = { type: ['actions', 'research', 'chat', 'tasks'].includes(j.type) ? j.type : 'chat', say: str(j.say, 200), steps };
  } catch {}
  if (!p || (p.type === 'actions' && !p.steps.length)) return fallbackPlan(text) || p || { type: 'chat', say: '', steps: [] };
  return p;
}

// ---------- Ausfuehrung ----------
const describeStep = s => ({
  search: () => `Suche auf ${SITES[s.site].label}: ${s.query}`, open: () => 'Seite öffnen', click: () => `Klicke „${s.text}“`, type: () => `Tippe „${s.text}“`,
  scroll: () => 'Scrollen', media: () => 'Video steuern', tab: () => 'Tab', bookmark: () => 'Lesezeichen', wait: () => 'Warten'
}[s.do]());

async function run(p, ctx) {
  const { signal, accent, send } = ctx;
  let text = p.say ? p.say + '\n' : '';
  const push = line => { text += '• ' + line + '\n'; send('ai-chunk', text.trimEnd()); };
  const status = t => send('ai-status', t);
  if (text) send('ai-chunk', text.trimEnd());

  let w = null; // der Tab, den die KI fuer diesen Auftrag geoeffnet hat
  const agentTab = () => { if (!w || w.isDestroyed()) w = ctx.openTab('about:blank'); return w; };
  const cur = () => (w && !w.isDestroyed() ? w : ctx.active());

  const STEPS = {
    async search(s) {
      const site = SITES[s.site];
      status(`${site.label}: ${s.query}`);
      push(`Suche auf ${site.label}: ${s.query}`);
      const t = agentTab();
      await T.nav(t, ctx, site.url(s.query));
      if (site.ready) await T.waitFor(t, site.ready, 10000, signal);
      if (s.open > 0) await T.openResult(t, ctx, s.site, s.open, push);
    },
    async open(s) {
      const host = new URL(s.url).hostname;
      status('Öffne ' + host);
      push('Öffne ' + host);
      await T.nav(agentTab(), ctx, s.url);
    },
    async click(s) {
      const t = cur(); if (!t) return;
      const target = await cursor(t, accent, T.findByTextJs(s.text));
      if (!target) { push(`„${s.text}“ nicht gefunden`); return; }
      if (isRisky(target.text) && !(ctx.confirm && await ctx.confirm(`Soll ich „${target.text}“ wirklich anklicken?`))) { push('Übersprungen – nicht bestätigt'); return; }
      push('Klicke: ' + target.text);
      await T.clickTarget(t, ctx, target, 'Klicke ...');
      await T.settle(t, ctx);
    },
    async type(s) {
      const t = cur(); if (!t) return;
      const f = await cursor(t, accent, T.findInputJs());
      if (!f) { push('Kein Eingabefeld gefunden'); return; }
      const r = await T.typeInto(t, ctx, f, s.text, s.submit);
      push(r.ok ? 'Getippt: ' + s.text : r.why);
    },
    async scroll(s) {
      const t = cur(); if (!t) return;
      await T.scrollPage(t, ctx, s.dir);
      push({ down: 'Nach unten gescrollt', up: 'Nach oben gescrollt', top: 'Zum Seitenanfang', bottom: 'Zum Seitenende' }[s.dir]);
    },
    async media(s) {
      const t = cur(); if (!t) return;
      const ops = {
        play: 'v.play()', pause: 'v.pause()', mute: 'v.muted = true', unmute: 'v.muted = false',
        faster: 'v.playbackRate = Math.min(4, v.playbackRate + 0.25)', slower: 'v.playbackRate = Math.max(0.25, v.playbackRate - 0.25)',
        skip: 'v.currentTime += 10', rewind: 'v.currentTime -= 10',
        louder: 'v.muted = false; v.volume = Math.min(1, v.volume + 0.2)', quieter: 'v.volume = Math.max(0, v.volume - 0.2)'
      };
      const names = { play: 'Wiedergabe', pause: 'Pause', mute: 'Ton aus', unmute: 'Ton an', faster: 'Schneller', slower: 'Langsamer', skip: '10 Sekunden vor', rewind: '10 Sekunden zurück', louder: 'Lauter', quieter: 'Leiser', next: 'Nächstes Video' };
      const r = s.cmd === 'next'
        ? await t.executeJavaScript(`(() => { const b = document.querySelector('.ytp-next-button'); if (!b) return 'kein Video'; b.click(); return 'ok'; })()`).catch(() => 'Fehler')
        : await t.executeJavaScript(`(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0]; if (!v) return 'kein Video'; ${ops[s.cmd]}; return 'ok'; })()`).catch(() => 'Fehler');
      push(r === 'ok' ? names[s.cmd] : 'Kein Video gefunden');
    },
    async tab(s) {
      const t = cur();
      const map = {
        new: () => ctx.newTab(), close: () => ctx.closeActive(), next_tab: () => ctx.cycleTab(1), prev_tab: () => ctx.cycleTab(-1),
        back: () => t && t.navigationHistory.goBack(), forward: () => t && t.navigationHistory.goForward(), reload: () => t && t.reload()
      };
      map[s.cmd]();
      push({ new: 'Neuer Tab', close: 'Tab geschlossen', next_tab: 'Nächster Tab', prev_tab: 'Vorheriger Tab', back: 'Zurück', forward: 'Vor', reload: 'Neu geladen' }[s.cmd]);
      await sleep(500, signal);
    },
    async bookmark() { ctx.bookmark(); push('Lesezeichen gesetzt'); },
    async wait(s) { push(`Warte ${s.seconds} s`); await sleep(s.seconds * 1000, signal); }
  };

  try {
    for (let i = 0; i < p.steps.length; i++) {
      const s = p.steps[i];
      if (signal.aborted) throw new Aborted();
      const t = cur();
      if (t) await T.hud(t, ctx, describeStep(s), i + 1, p.steps.length);
      try { await STEPS[s.do](s); }
      catch (e) { if (e instanceof Aborted || signal.aborted) throw new Aborted(); push('Schritt fehlgeschlagen: ' + e.message); }
    }
  } finally {
    await T.hideCursor(w, ctx);
  }
  send('ai-chunk', (text + '\n✓ Fertig').trim());
  return text.trim();
}

// ---------- Auto-Modus: was will der Nutzer? ----------
const W = (...words) => new RegExp('(^|[^\\p{L}])(' + words.join('|') + ')', 'iu');
const PAGE_REF = /(diese[rnms]? seite|dieser seite|auf der seite|auf dieser|hier auf)/i;
const RESEARCH = W('recherchier', 'finde heraus', 'finde mir heraus', 'vergleiche', 'was gibt es neues', 'informier');
const ACTION = W('öffne', 'oeffne', 'starte', 'spiel', 'zeig', 'geh ', 'gehe', 'navigier', 'such', 'schließ', 'schliess', 'scroll', 'pausier', 'stopp', 'setz', 'lade', 'neuer tab', 'neuen tab', 'klick', 'tipp', 'spul', 'lösch', 'wechsel', 'mach das (video|lied)', 'lauter', 'leiser');
const QUESTION = W('wer', 'was', 'wie', 'warum', 'wieso', 'weshalb', 'wann', 'wo', 'welche', 'kannst', 'kann', 'erklär', 'fass', 'übersetze', 'schreib', 'nenne', 'berechne');

// Mehrere Schritte nacheinander? ("1. ... 2. ...", Aufzaehlung oder "dann/danach" mit mehreren Verben)
function isMission(t) {
  const lines = (t.match(/(^|\n)\s*(\d+\s*[.):]|schritt\s*\d+|[-•*])\s*\S/gi) || []).length;
  if (lines >= 2) return true;
  const nums = [...t.matchAll(/(^|[\s,;.])([1-9])[.):]?\s+(?=[\p{L}])/gu)].map(m => +m[2]);
  if (nums.length >= 2 && nums[1] === nums[0] + 1) return true;
  const connectors = (t.match(/(^|[^\p{L}])(dann|danach|anschließend|anschliessend|als nächstes|zuerst|zum schluss|im anschluss)(?=[^\p{L}]|$)/giu) || []).length;
  const verbs = (t.match(/(^|[^\p{L}])(öffne|oeffne|geh|gehe|such|kopier|klick|schreib|vergleich|speicher|fass|lies|hol|nimm|füge|trag|sammle|notier)/giu) || []).length;
  return connectors >= 1 && verbs >= 2;
}

function routeMode(text) {
  const t = text.trim();
  if (isMission(t)) return 'mission';
  if (isTaskRequest(t)) return 'worker'; // "Mach die Aufgaben in Duolingo": Aufgaben abarbeiten, nicht YouTube raten
  if (PAGE_REF.test(t)) return 'page';
  if (RESEARCH.test(t)) return 'research';
  const asks = /\?\s*$/.test(t);
  if (ACTION.test(t) || (/youtube|spotify|twitch|wikipedia|amazon/i.test(t) && !asks)) return 'action';
  if (asks || QUESTION.test(t)) return 'chat';
  return 'action'; // kurze Befehle: der Planer entscheidet und kann auch "chat" liefern
}

module.exports = { plan, run, routeMode, isMission };
