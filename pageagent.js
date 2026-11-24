// Seiten-Agent: bedient die aktuelle Seite Schritt fuer Schritt (klicken, tippen, scrollen, kopieren, antworten)
// und zeigt dabei den simulierten Cursor. Wird von "Diese Seite" und vom Aufgaben-Modus benutzt.
const { chat, cursor, Aborted } = require('./agent');
const T = require('./webtools');
const { SITES, str, normUrl, isRisky } = T;

const SYSTEM = `You operate a web browser for the user and work step by step. Every turn you get the goal, the current page (a text excerpt and a numbered list of elements you can use) and what you did so far. Choose ONE next action.
Reply ONLY with JSON: {"thought":"short, in German","action":"...","id":0, ...fields}. Always include "id" (the element number, or 0 when no element is needed).
Actions:
- click: click the element number "id".
- type: type "text" into the input element "id"; set "submit" to true to press Enter afterwards (search boxes).
- scroll: scroll the page ("dir" = down, up, top or bottom).
- navigate: open the web address "url".
- search: search "site" (youtube, wikipedia, web, images, maps, github, reddit, amazon, ebay, twitch, spotify) for "query"; "open" = number of the result to open (0 = stay on the results).
- copy: copy information from the page. "text" = the exact words as they appear in the page text (a short snippet, for example a number with its unit, a name or one sentence), "label" = what it is.
- answer: the goal is a question; put the answer in "text" (German) and the exact page words that prove it in "evidence".
- done: the goal is reached; "text" = short German confirmation.
- fail: the goal cannot be reached; "text" = short German reason.
If the goal says to solve, fill in, select or do something on the page, DO it with click and type instead of only describing it. Never invent element numbers. Do not repeat an action that did not help. When the goal is reached, finish at once with done or answer. After you have copied what the goal asks for, finish with done.
Examples:
Goal "Kopiere die Höhe des Berges", page text contains "Höhe 3776 m" -> {"thought":"Die Höhe steht im Text.","action":"copy","text":"3776 m","label":"Höhe"}
Goal "Such nach Kirschblüte", search field is [4] -> {"thought":"Ich tippe in das Suchfeld.","action":"type","id":4,"text":"Kirschblüte","submit":true}
Goal "Wie heißt die Hauptstadt?", page text says "Hauptstadt: Canberra" -> {"thought":"Steht im Text.","action":"answer","text":"Die Hauptstadt ist Canberra.","evidence":"Hauptstadt: Canberra"}`;

const SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string' },
    action: { type: 'string', enum: ['click', 'type', 'scroll', 'navigate', 'search', 'copy', 'answer', 'done', 'fail'] },
    id: { type: 'integer' }, text: { type: 'string' }, label: { type: 'string' }, evidence: { type: 'string' },
    dir: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] }, url: { type: 'string' },
    site: { type: 'string', enum: Object.keys(SITES) }, query: { type: 'string' }, open: { type: 'integer' }, submit: { type: 'boolean' }
  },
  required: ['thought', 'action', 'id']
};

// Zeigt der KI die 40 passendsten Elemente: zum Ziel passende Texte und sichtbare zuerst
function pickElements(els, goal) {
  const kws = T.keywords(goal);
  const scored = els.map(e => {
    const low = e.text.toLowerCase();
    let s = e.inView ? 2 : 0;
    for (const k of kws) if (low.includes(k)) s += 3;
    if (e.kind.startsWith('input')) s += 2;
    return { e, s };
  });
  scored.sort((a, b) => b.s - a.s || a.e.top - b.e.top);
  return scored.slice(0, 40).map(x => x.e).sort((a, b) => a.id - b.id);
}

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ---------- Kopieren: Textstelle bestimmen, auf der Seite markieren, in die Zwischenablage ----------
const COPY_RE = /(^|[^\p{L}])(kopier|copy|übernimm|uebernimm|notier|merk)/iu;
const EXTRACT_SYSTEM = `You extract one piece of information from a web page for the user. Reply ONLY with JSON {"found":true or false,"label":"what it is (German, 1-3 words)","text":"..."}.
"text" must be copied exactly as it appears in the page text: short (a number with its unit, a name, a date or one sentence), never longer than 200 characters, never reworded.
If the page text does not contain it, reply {"found":false,"label":"","text":""}.
Example: Task "Kopiere die Höhe des Berges", page text "Höhe 3776,24 m T.P." -> {"found":true,"label":"Höhe","text":"3776,24 m"}`;
const EXTRACT_SCHEMA = { type: 'object', properties: { found: { type: 'boolean' }, label: { type: 'string' }, text: { type: 'string' } }, required: ['found', 'label', 'text'] };

async function extractCopy(goal, excerpt, title, ctx) {
  try {
    const raw = await chat(ctx.model, [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: `Task: ${goal}\nPage: ${title}\n\nPage text:\n${excerpt}` }
    ], { json: EXTRACT_SCHEMA, signal: ctx.signal });
    return JSON.parse(raw);
  } catch (e) { if (ctx.signal.aborted) throw new Aborted(); return null; }
}

// Findet die Stelle auf der Seite, markiert sie mit dem Cursor, legt sie in die Zwischenablage und merkt sie sich
async function copyOut(w, ctx, o, results, snippet, labelRaw, log) {
  const loc = await T.pointAtText(w, ctx, snippet, { select: true, ms: 5000 });
  if (!loc) return null;
  const copied = loc.text || snippet;
  ctx.clipboardWrite && ctx.clipboardWrite(copied);
  const item = { step: o.stepIndex, label: str(labelRaw, 60) || 'Text', text: copied, url: w.getURL(), title: w.getTitle() };
  results.push(item);
  ctx.onCopy && ctx.onCopy(item);
  log(`Kopiert (${item.label}): „${copied.length > 120 ? copied.slice(0, 117) + '…' : copied}“`);
  await w.executeJavaScript('getSelection().removeAllRanges()').catch(() => {});
  return item;
}

// o: { goal, ctx, getTab(), log(line), results[], maxSteps, stepIndex, stepNo, stepTotal, hudText }
// Gibt { status: 'done' | 'failed' | 'limit', text } zurueck.
async function agentLoop(o) {
  const { goal, ctx, getTab, log } = o;
  const results = o.results || [];
  const maxSteps = o.maxSteps || 7;
  const { signal, model } = ctx;
  const history = [];
  let lastSig = '';
  let copiedHere = 0; // wie oft in diesem Auftrag schon etwas kopiert wurde
  let submittedHere = false; // ob schon etwas eingetippt und abgeschickt wurde
  let extractedUrl = ''; // fuer welche Seite der Kopier-Schritt schon versucht wurde

  for (let step = 1; step <= maxSteps; step++) {
    if (signal.aborted) throw new Aborted();
    const w = getTab();
    if (!w || w.isDestroyed()) return { status: 'failed', text: 'Der Tab wurde geschlossen.' };
    ctx.send('ai-status', `${o.hudText || 'Seite bearbeiten'} – Schritt ${step}/${maxSteps}`);
    await T.hud(w, ctx, o.hudText || 'Ich arbeite auf dieser Seite', o.stepNo, o.stepTotal);

    let obs = await w.executeJavaScript(T.OBSERVE_JS).catch(() => null);
    if (!obs) { await T.settle(w, ctx); obs = await w.executeJavaScript(T.OBSERVE_JS).catch(() => null); }
    if (!obs) return { status: 'failed', text: 'Die Seite lässt sich nicht lesen.' };

    const summary = /(zusammen|überblick|ueberblick|worum geht)/i.test(goal);
    const excerpt = T.buildExcerpt(obs.full, goal, summary ? 4500 : 2600);
    const elems = pickElements(obs.els, goal).map(e => `[${e.id}] ${e.kind}${e.inView ? '' : ' (further down)'}: ${e.text}`).join('\n');
    const got = results.length ? results.map(r => `- ${r.label}: ${r.text}`).join('\n') : '(nothing yet)';
    const prompt = `Goal: ${goal}\nPage: ${obs.title} (${obs.url})\nScroll position: ${obs.scrollY} of ${obs.height}\n\nPage text (excerpt):\n${excerpt}\n\nElements:\n${elems || '(none)'}\n\nCollected so far:\n${got}\n\nActions so far:\n${history.length ? history.join('\n') : '(none)'}`;

    // "Kopiere ...": erst gezielt die Textstelle bestimmen lassen (fuer kleine Modelle viel verlaesslicher als eine freie Entscheidung)
    if (COPY_RE.test(goal) && copiedHere === 0 && extractedUrl !== obs.url) {
      extractedUrl = obs.url;
      const sw = T.startSweep(w, ctx, 'Suche die Stelle ...');
      let ex = null;
      try { ex = await extractCopy(goal, excerpt, obs.title, ctx); } finally { await sw.stop(); }
      if (ex && ex.found && ex.text) {
        const item = await copyOut(w, ctx, o, results, ex.text, ex.label, log);
        if (item) {
          copiedHere++;
          history.push(`copied "${item.text.slice(0, 80)}" as ${item.label}.`);
          // Ein einzelner Kopier-Auftrag ist damit erledigt; bei "A und B" geht die Schleife weiter
          if (!/(\bund\b|,|\bsowie\b|\bauch\b)/i.test(goal)) return { status: 'done', text: 'Erledigt.' };
          continue;
        }
      }
    }

    // Waehrend die KI nachdenkt, "liest" der Cursor die Seite
    const sweep = T.startSweep(w, ctx, 'Lese ...');
    let d;
    try {
      const raw = await chat(model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], { json: SCHEMA, signal });
      d = JSON.parse(raw);
    } catch (e) {
      await sweep.stop();
      if (signal.aborted) throw new Aborted();
      return { status: 'failed', text: 'Ich konnte keine Entscheidung treffen.' };
    }
    await sweep.stop();

    const sig = `${d.action}|${d.id}|${d.dir}|${d.url}|${d.query}|${(d.text || '').slice(0, 40)}`;
    if (sig === lastSig && !['answer', 'done', 'fail'].includes(d.action)) {
      // Wiederholt das Modell dieselbe Aktion, nachdem schon etwas kopiert oder eine Suche abgeschickt wurde, ist das Ziel erreicht
      if (copiedHere > 0 || submittedHere) return { status: 'done', text: 'Erledigt.' };
      return { status: 'failed', text: 'Ich komme hier nicht weiter.' };
    }
    lastSig = sig;

    switch (d.action) {
      case 'answer': {
        const ev = str(d.evidence, 300);
        if (ev) await T.pointAtText(w, ctx, ev, { select: false, ms: 6000 });
        return { status: 'done', text: str(d.text, 1500) || 'Dazu steht auf der Seite nichts.', answered: true };
      }
      case 'done': return { status: 'done', text: str(d.text, 500) || 'Erledigt.' };
      case 'fail': return { status: 'failed', text: str(d.text, 300) || 'Das ging nicht.' };

      case 'scroll': {
        const dir = ['down', 'up', 'top', 'bottom'].includes(d.dir) ? d.dir : 'down';
        await T.scrollPage(w, ctx, dir);
        log({ down: 'Nach unten gescrollt', up: 'Nach oben gescrollt', top: 'Zum Seitenanfang', bottom: 'Zum Seitenende' }[dir]);
        history.push(`scrolled ${dir}`);
        break;
      }

      case 'navigate': {
        const url = normUrl(d.url);
        if (!url) { history.push(`"${d.url}" is not a valid web address`); break; }
        log('Öffne ' + hostOf(url));
        await T.nav(w, ctx, url);
        history.push(`opened ${hostOf(url)} -> the page is now "${w.getTitle()}". If the goal is reached, finish with done.`);
        break;
      }

      case 'search': {
        const siteKey = SITES[d.site] ? d.site : 'web';
        const q = str(d.query, 120);
        if (!q) { history.push('search needs a query'); break; }
        const site = SITES[siteKey];
        log(`Suche auf ${site.label}: ${q}`);
        await T.nav(w, ctx, site.url(q));
        if (site.ready) await T.waitFor(w, site.ready, 10000, signal);
        const n = Math.max(0, Math.min(10, Math.floor(+d.open) || 0));
        if (n > 0) await T.openResult(w, ctx, siteKey, n, log);
        history.push(`searched ${site.label} for "${q}"${n > 0 ? ` and opened result ${n}` : ''} -> the page is now "${w.getTitle()}". If the goal is reached, finish with done.`);
        break;
      }

      case 'copy': {
        const snippet = str(d.text, 400);
        if (!snippet) { history.push('copy needs the exact text from the page'); break; }
        const item = await copyOut(w, ctx, o, results, snippet, d.label, log);
        if (!item) { history.push(`could not find "${snippet.slice(0, 60)}" on the page; copy the exact words as they appear`); log('Textstelle nicht gefunden'); break; }
        copiedHere++;
        history.push(`copied "${item.text.slice(0, 80)}" as ${item.label}. If the goal is now fulfilled, finish with done.`);
        break;
      }

      case 'click': {
        const id = Math.floor(+d.id);
        let t = id > 0 ? await T.cursorFind(w, ctx, id) : null;
        if (!t && d.text) t = await cursor(w, ctx.accent, T.findByTextJs(str(d.text, 80))); // ohne gueltige Nummer: nach dem Text suchen
        if (!t) { history.push(`element ${d.id} does not exist`); log('Das Element habe ich nicht gefunden'); break; }
        if (isRisky(t.text) && !(ctx.confirm && await ctx.confirm(`Soll ich „${t.text}“ wirklich anklicken?`))) {
          log('Übersprungen – nicht bestätigt');
          return { status: 'failed', text: `„${t.text}“ habe ich nicht angeklickt (nicht bestätigt).` };
        }
        log(`Klicke „${t.text || t.tag}“`);
        await T.clickTarget(w, ctx, t, 'Klicke ...');
        await T.settle(w, ctx);
        history.push(`clicked [${id}] "${t.text}" -> the page is now "${w.getTitle()}" (${w.getURL()}). If the goal is reached, finish with done.`);
        break;
      }

      case 'type': {
        const id = Math.floor(+d.id);
        let t = id > 0 ? await T.cursorFind(w, ctx, id) : null;
        if (!t) t = await cursor(w, ctx.accent, T.findInputJs()); // ohne gueltige Nummer: das passendste Eingabefeld nehmen
        if (!t) { history.push(`element ${d.id} does not exist`); log('Ein Eingabefeld habe ich nicht gefunden'); break; }
        if (!t.editable) { history.push(`[${id}] is not an input field`); log('Das ist kein Eingabefeld'); break; }
        const value = str(d.text, 200);
        if (!value) { history.push('type needs text'); break; }
        // In Suchfeldern wird bei einem Such-Auftrag automatisch mit Enter abgeschickt
        const submit = !!d.submit || (!!t.isSearch && /(such|search|find)/i.test(goal));
        const r = await T.typeInto(w, ctx, t, value, submit);
        if (!r.ok) { log(r.why); return { status: 'failed', text: r.why }; }
        log(`Getippt: „${value}“`);
        if (submit) submittedHere = true;
        history.push(`typed "${value}" into [${id}]${submit ? ` and pressed Enter -> the page is now "${w.getTitle()}" (${w.getURL()})` : ''}. If the goal is reached, finish with done.`);
        break;
      }
    }
  }
  return { status: 'limit', text: 'Ich habe es in der vorgesehenen Zahl von Schritten nicht geschafft.' };
}

// "Diese Seite" mit Cursor: bedient die aktive Seite und berichtet
async function interact(goal, ctx) {
  const lines = [];
  const log = line => { lines.push('• ' + line); ctx.send('ai-chunk', lines.join('\n')); };
  const w = ctx.active();
  if (!w || !/^https?:/.test(w.getURL())) { ctx.send('ai-chunk', 'Hier ist keine Webseite geöffnet, die ich bedienen könnte.'); return null; }
  ctx.send('ai-chunk', '…');
  let r;
  try {
    r = await agentLoop({ goal, ctx, getTab: () => ctx.active(), log, hudText: 'Ich bearbeite diese Seite' });
  } finally {
    await T.hideCursor(ctx.active(), ctx);
  }
  const head = lines.length ? lines.join('\n') + '\n\n' : '';
  const text = r.status === 'done' ? (r.text || 'Erledigt.') : r.text;
  ctx.send('ai-chunk', (head + (r.status === 'done' ? '' : '⚠ ') + text).trim());
  return { status: r.status, text };
}

module.exports = { agentLoop, interact, COPY_RE };
