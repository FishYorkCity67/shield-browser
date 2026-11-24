// Aufgaben-Modus: mehrstufige Auftraege ("1. oeffne X und kopiere Y, 2. oeffne Z und kopiere W, 3. ...")
// werden in Schritte zerlegt, nacheinander im Browser ausgefuehrt (sichtbar, mit Cursor) und am Ende berichtet.
const { chat, sleep, Aborted } = require('./agent');
const T = require('./webtools');
const { agentLoop, COPY_RE } = require('./pageagent');
const { SITES, str, normUrl } = T;

const SYSTEM = `You split the user's task into ordered steps for a browser assistant. Reply ONLY with JSON:
{"title":"short German title","steps":[{"title":"short German step title","start":{"type":"search|open|none","site":"...","query":"...","url":"...","open":N},"goal":"what to do on that page, in German","compose":false}]}
- "start" is where the step begins: search = search a site (youtube, wikipedia, web, images, maps, github, reddit, amazon, ebay, twitch, spotify) and open result number N (0 = stay on the results); open = open a web address; none = continue on the page that is already open.
- "goal" says what to do there, for example "Kopiere die Höhe des Berges." or "Klicke auf Kontakt." Use the word "Kopiere" whenever something has to be copied.
- "compose": true only for a final step that needs no browsing and writes an answer, list or text from the copied values.
Keep every step small and concrete. At most 8 steps.`;

const SHOTS = [
  ['1. Öffne die Wikipedia-Seite zum Mount Fuji und kopiere die Höhe. 2. Öffne die Wikipedia-Seite zu Tokio und kopiere die Einwohnerzahl. 3. Schreib mir beides als Liste auf.',
    { title: 'Fuji und Tokio', steps: [
      { title: 'Höhe des Fuji kopieren', start: { type: 'search', site: 'wikipedia', query: 'Fuji', open: 1 }, goal: 'Kopiere die Höhe des Berges.', compose: false },
      { title: 'Einwohner von Tokio kopieren', start: { type: 'search', site: 'wikipedia', query: 'Tokio', open: 1 }, goal: 'Kopiere die Einwohnerzahl.', compose: false },
      { title: 'Beides als Liste aufschreiben', start: { type: 'none' }, goal: 'Schreibe die kopierten Werte als kurze Liste auf.', compose: true }] }],
  ['Öffne spiegel.de und kopiere die erste Schlagzeile, dann geh zu bbc.com und kopiere dort auch die erste Schlagzeile',
    { title: 'Schlagzeilen sammeln', steps: [
      { title: 'Schlagzeile von spiegel.de', start: { type: 'open', url: 'https://www.spiegel.de' }, goal: 'Kopiere die erste Schlagzeile.', compose: false },
      { title: 'Schlagzeile von bbc.com', start: { type: 'open', url: 'https://www.bbc.com' }, goal: 'Kopiere die erste Schlagzeile.', compose: false }] }],
  ['Such bei YouTube nach lofi, öffne das erste Video und sag mir den Titel des Videos',
    { title: 'Lofi-Video öffnen', steps: [
      { title: 'Lofi-Video starten', start: { type: 'search', site: 'youtube', query: 'lofi', open: 1 }, goal: 'Kopiere den Titel des Videos.', compose: false }] }]
];

const START_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['search', 'open', 'none'] },
    site: { type: 'string', enum: Object.keys(SITES) }, query: { type: 'string' }, url: { type: 'string' }, open: { type: 'integer' }
  },
  required: ['type']
};
const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, start: START_SCHEMA, goal: { type: 'string' }, compose: { type: 'boolean' } }, required: ['title', 'start', 'goal', 'compose'] } }
  },
  required: ['title', 'steps']
};

function cleanMission(j, text) {
  const steps = (Array.isArray(j && j.steps) ? j.steps : []).slice(0, 8).map((s, i) => {
    const st = s && s.start || { type: 'none' };
    const start = { type: 'none' };
    if (st.type === 'search' && str(st.query, 120)) Object.assign(start, { type: 'search', site: SITES[st.site] ? st.site : 'web', query: str(st.query, 120), open: Math.max(0, Math.min(10, Math.floor(+st.open) || 0)) });
    else if (st.type === 'open' && normUrl(st.url)) Object.assign(start, { type: 'open', url: normUrl(st.url) });
    return { title: str(s && s.title, 80) || `Schritt ${i + 1}`, start, goal: str(s && s.goal, 300), compose: !!(s && s.compose) };
  }).filter(s => s.goal || s.start.type !== 'none');
  return { title: str(j && j.title, 80) || str(text, 60), steps };
}

// Rueckfall, falls die KI kein brauchbares JSON liefert: nach Nummern oder "dann/danach" zerlegen
function fallbackMission(text) {
  let parts = text.split(/(?:^|\s)(?:\d+\s*[.):]?\s+(?=[\p{L}]))|\n\s*[-•*]\s*|\s+(?:und )?(?:dann|danach|anschließend|anschliessend)\s+/iu).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = [text];
  const steps = parts.slice(0, 8).map((p, i) => {
    const dom = p.match(/\b((?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)/);
    const wiki = /wikipedia/i.test(p);
    const q = str(p.replace(/(öffne|oeffne|geh|gehe|auf|bei|zu|die|das|den|seite|wikipedia|und|kopiere|kopier|ab|ein|eine|von|mit)/gi, ' '), 100);
    const start = dom && normUrl(dom[1]) ? { type: 'open', url: normUrl(dom[1]) } : wiki && q ? { type: 'search', site: 'wikipedia', query: q, open: 1 } : { type: 'none' };
    return { title: str(p, 60), start, goal: p, compose: /(schreib|liste|zusammenfass|fass .* zusammen)/i.test(p) && i === parts.length - 1 };
  });
  return { title: str(text, 60), steps };
}

async function planMission(model, text, signal) {
  const messages = [{ role: 'system', content: SYSTEM }];
  for (const [u, p] of SHOTS) messages.push({ role: 'user', content: u }, { role: 'assistant', content: JSON.stringify(p) });
  messages.push({ role: 'user', content: text });
  let raw;
  try { raw = await chat(model, messages, { json: SCHEMA, signal }); }
  catch (e) { if (signal && signal.aborted) throw new Aborted(); try { raw = await chat(model, messages, { json: true, signal }); } catch { raw = ''; } }
  let m = null;
  try { m = cleanMission(JSON.parse(raw), text); } catch {}
  if (!m || !m.steps.length) m = cleanMission(fallbackMission(text), text);
  return m;
}

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function compose(model, task, goal, results, signal) {
  const data = results.map((r, i) => `${i + 1}. ${r.label}: ${r.text} (Quelle: ${hostOf(r.url)})`).join('\n');
  return chat(model, [
    { role: 'system', content: 'Du schreibst das Ergebnis einer Browser-Aufgabe. Verwende ausschließlich die gesammelten Werte, erfinde nichts. Antworte auf Deutsch, knapp und klar.' },
    { role: 'user', content: `Aufgabe: ${task}\nSchritt: ${goal}\n\nGesammelte Werte:\n${data || '(keine)'}` }
  ], { signal });
}

const STATUS = { done: 'erledigt', failed: 'nicht geschafft', stopped: 'abgebrochen', skipped: 'übersprungen' };

function buildReport(title, steps, results, composed, aborted) {
  const ok = steps.filter(s => s.status === 'done').length;
  let t = `Aufgabe: ${title}\n${aborted ? 'Abgebrochen – ' : ''}${ok} von ${steps.length} Schritten erledigt.\n\n`;
  steps.forEach((s, i) => {
    t += `${i + 1}. ${s.title} – ${STATUS[s.status] || s.status}\n`;
    for (const l of s.lines) t += `   • ${l}\n`;
    if (s.note) t += `   ! ${s.note}\n`;
  });
  if (results.length) t += '\nKopierte Werte:\n' + results.map(r => `• ${r.label}: ${r.text}  (${hostOf(r.url)})`).join('\n');
  if (composed) t += '\n\nErgebnis:\n' + composed;
  return t.trim();
}

// ctx: { model, accent, signal, send, openTab, active, confirm, tabCount, clipboardWrite, saveNote }
async function runMission(text, ctx) {
  const { send, signal } = ctx;
  const emit = p => send('mission', p);
  send('ai-status', 'Plane die Aufgabe ...');
  const mp = await planMission(ctx.model, text, signal);
  const n = mp.steps.length;
  emit({ ev: 'start', title: mp.title, steps: mp.steps.map(s => ({ title: s.title, goal: s.goal })) });
  send('ai-chunk', `Aufgabe: ${mp.title}`);

  let w = null; // ein Tab fuer die ganze Aufgabe
  const getTab = () => (w && !w.isDestroyed() ? w : ctx.active());
  const ensureTab = () => { if (!w || w.isDestroyed()) w = ctx.openTab('about:blank'); return w; };
  const results = [];
  const done = steps => steps;
  const rep = mp.steps.map(s => ({ title: s.title, status: 'pending', lines: [], note: '' }));
  let composed = '';
  let aborted = false;

  try {
    for (let i = 0; i < n; i++) {
      const s = mp.steps[i];
      if (signal.aborted) throw new Aborted();
      emit({ ev: 'step', i, status: 'running' });
      const lines = rep[i].lines;
      const log = line => { lines.push(line); emit({ ev: 'log', i, text: line }); };
      let status = 'done', note = '';
      try {
        const hudText = `${s.title}`;
        if (s.compose) {
          send('ai-status', 'Schreibe das Ergebnis ...');
          composed = await compose(ctx.model, mp.title, s.goal, results, signal);
          log('Ergebnis aus den kopierten Werten geschrieben');
        } else {
          // Startpunkt des Schritts
          if (s.start.type === 'search') {
            const site = SITES[s.start.site];
            const t = ensureTab();
            await T.hud(t, ctx, hudText, i + 1, n);
            log(`Suche auf ${site.label}: ${s.start.query}`);
            send('ai-status', `${site.label}: ${s.start.query}`);
            await T.nav(t, ctx, site.url(s.start.query));
            if (site.ready) await T.waitFor(t, site.ready, 10000, signal);
            if (s.start.open > 0) await T.openResult(t, ctx, s.start.site, s.start.open, log);
          } else if (s.start.type === 'open') {
            const t = ensureTab();
            await T.hud(t, ctx, hudText, i + 1, n);
            log('Öffne ' + hostOf(s.start.url));
            send('ai-status', 'Öffne ' + hostOf(s.start.url));
            await T.nav(t, ctx, s.start.url);
          }
          // Ziel des Schritts auf der Seite
          if (s.goal) {
            const before = results.length;
            const r = await agentLoop({
              goal: s.goal, ctx: { ...ctx, onCopy: item => emit({ ev: 'copy', i, label: item.label, text: item.text, url: item.url }) },
              getTab, log, results, stepIndex: i, stepNo: i + 1, stepTotal: n, hudText
            });
            if (r.status === 'failed') { status = 'failed'; note = r.text; }
            else if (r.status === 'limit') { if (results.length > before) status = 'done'; else { status = 'failed'; note = r.text; } }
            else if (r.text) { log(r.text); if (r.answered && results.length === before) { results.push({ step: i, label: 'Antwort', text: r.text, url: (getTab() && getTab().getURL()) || '', title: '' }); } }
            // Ein Schritt mit "Kopiere ..." gilt nur als erledigt, wenn auch wirklich etwas kopiert wurde
            if (status === 'done' && COPY_RE.test(s.goal) && results.length === before) { status = 'failed'; note = 'Die gesuchte Stelle habe ich auf der Seite nicht gefunden.'; }
          }
        }
      } catch (e) {
        if (e instanceof Aborted || signal.aborted) { rep[i].status = 'stopped'; emit({ ev: 'step', i, status: 'stopped' }); throw new Aborted(); }
        status = 'failed'; note = e.message;
      }
      rep[i].status = status; rep[i].note = note;
      emit({ ev: 'step', i, status, note });
    }
  } catch (e) {
    if (e instanceof Aborted || signal.aborted) aborted = true; else throw e;
  } finally {
    await T.hideCursor(w, ctx);
  }

  for (const r of rep) if (r.status === 'pending') r.status = 'skipped';
  const report = buildReport(mp.title, rep, results, composed, aborted);
  if (ctx.saveNote) ctx.saveNote({ title: 'Aufgabe: ' + mp.title, url: '', text: report });
  emit({ ev: 'final', report, result: composed, ok: rep.filter(s => s.status === 'done').length, total: n, aborted });
  send('ai-chunk', report);
  if (aborted) throw new Aborted();
  return report;
}

module.exports = { runMission, planMission, buildReport };
