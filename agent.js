// Lokale KI (Ollama) + Recherche-Agent, der im Browser sichtbar mit simuliertem Cursor arbeitet.
const { spawn } = require('child_process');
const path = require('path');
const { cursorScript } = require('./effects');

const OLLAMA = 'http://127.0.0.1:11434';

class Aborted extends Error {}

async function ensureOllama() {
  const ok = async () => { try { return (await fetch(OLLAMA + '/api/tags')).ok; } catch { return false; } };
  if (await ok()) return true;
  try {
    const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
    spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { return false; }
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 750)); if (await ok()) return true; }
  return false;
}

// Schneller Check ohne Start-Versuch (fuer Hintergrund-Entscheidungen)
async function ollamaUp() {
  try { return (await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

async function models() {
  try { return (await (await fetch(OLLAMA + '/api/tags')).json()).models.map(m => m.name); } catch { return []; }
}

const stripThink = s => s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '');

// Streamt die Antwort; onChunk bekommt den bisherigen Gesamttext. Gibt den fertigen Text zurueck.
async function chat(model, messages, { onChunk, signal, json, temperature } = {}) {
  const body = { model, messages, stream: true, options: { num_ctx: 6144, temperature: temperature != null ? temperature : json ? 0.2 : 0.5 } };
  if (/^qwen3/.test(model)) body.think = false;
  if (json) body.format = json === true ? 'json' : json; // true = freies JSON, Objekt = JSON-Schema (erzwingt gueltige Felder)
  const res = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error('Ollama: ' + (await res.text()).slice(0, 200));
  const dec = new TextDecoder();
  let buf = '', full = '';
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (j.message?.content) { full += j.message.content; onChunk?.(stripThink(full)); }
      } catch {}
    }
  }
  return stripThink(full).trim();
}

async function pageText(wc) {
  return wc.executeJavaScript(`(()=>{const el=document.querySelector('article')||document.querySelector('main')||document.body;
    return {title:document.title,url:location.href,text:(el.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,6000)}})()`);
}

// ---------- Recherche ----------
const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) return rej(new Aborted());
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Aborted()); }, { once: true });
});

async function go(wc, url, signal) {
  if (wc.__ready) { try { await wc.__ready; } catch {} } // erst wenn der Tab fertig abgesichert ist
  const done = new Promise(res => { wc.once('did-stop-loading', res); setTimeout(res, 15000); });
  wc.loadURL(url).catch(() => {});
  await done;
  await sleep(700, signal);
}

async function cursor(wc, accent, fn) {
  try { await wc.executeJavaScript(cursorScript(accent)); return await wc.executeJavaScript(fn); }
  catch (e) { if (process.env.SHIELD_DEBUG) console.error('cursor-js:', String(e.message).slice(0, 200), '|', String(fn).slice(0, 80).replace(/\s+/g, ' ')); return null; }
}

// Cursor "liest" eine Seite: wandert ueber Absaetze, markiert sie und scrollt langsam.
async function readPage(wc, accent, signal, label) {
  await cursor(wc, accent, `window.__shieldCursor.label(${JSON.stringify(label)})`);
  for (let step = 0; step < 4; step++) {
    const pt = await cursor(wc, accent, `(()=>{
      const ps=[...document.querySelectorAll('p,li,h2,h3')].filter(e=>{const r=e.getBoundingClientRect();
        return r.width>180&&r.height>12&&r.top>70&&r.bottom<innerHeight-20});
      const e=ps[Math.floor(Math.random()*Math.min(ps.length,4))]; if(!e) return null;
      const r=e.getBoundingClientRect(); window.__shieldCursor.mark(e);
      return {x:r.left+20+Math.random()*Math.min(r.width-40,300),y:r.top+r.height/2};})()`);
    if (pt) {
      await cursor(wc, accent, `window.__shieldCursor.move(${pt.x},${pt.y})`);
      await sleep(1100, signal);
    }
    await cursor(wc, accent, `window.scrollBy({top:innerHeight*0.55,behavior:'smooth'})`);
    await sleep(1000, signal);
  }
}

// ctx: { model, accent, send(channel,payload), openTab(url) -> webContents, addNote(note), signal }
async function research(question, ctx) {
  const { model, accent, send, signal } = ctx;
  const status = t => send('ai-status', t);
  let queries = [question];

  status('Plane Suchanfragen ...');
  try {
    const out = await chat(model, [
      { role: 'system', content: 'Du erzeugst Suchanfragen. Antworte NUR als JSON: {"queries":["...","..."]} mit 1-2 kurzen, guten Suchanfragen (Sprache passend zur Frage).' },
      { role: 'user', content: question }
    ], { signal, json: true });
    const q = JSON.parse(out).queries;
    if (Array.isArray(q) && q.length) queries = q.filter(x => typeof x === 'string').slice(0, 2);
  } catch (e) { if (signal.aborted) throw new Aborted(); }

  const wc = ctx.openTab('about:blank');
  const links = [];
  for (const q of queries) {
    status('Suche: ' + q);
    await go(wc, 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), signal);
    await cursor(wc, accent, 'window.__shieldCursor.label("Suche ...")');
    const found = await cursor(wc, accent, `[...document.querySelectorAll('a.result__a')].slice(0,6).map(a=>{
      let h=a.getAttribute('href')||''; const m=h.match(/uddg=([^&]+)/); if(m) h=decodeURIComponent(m[1]);
      const r=a.getBoundingClientRect(); return {url:h,title:a.textContent.trim(),x:r.left+30,y:r.top+r.height/2};})`);
    for (const f of found || []) {
      if (/^https?:/.test(f.url) && !links.some(l => l.url === f.url) && !/\.pdf($|\?)/i.test(f.url)) links.push(f);
    }
    // Cursor faehrt ueber die Treffer
    for (const f of (found || []).slice(0, 3)) {
      await cursor(wc, accent, `window.__shieldCursor.move(${f.x},${f.y})`);
      await sleep(700, signal);
    }
  }
  if (!links.length) { send('ai-chunk', 'Ich habe keine Suchergebnisse bekommen (evtl. blockiert DuckDuckGo gerade). Versuch es gleich nochmal.'); return; }

  const notes = [];
  for (const l of links.slice(0, 3)) {
    status('Lese: ' + l.title.slice(0, 60));
    await cursor(wc, accent, `window.__shieldCursor.click(${l.x},${l.y})`);
    await sleep(400, signal);
    await go(wc, l.url, signal);
    await readPage(wc, accent, signal, 'Ich lese ...');
    let page;
    try { page = await pageText(wc); } catch { continue; }
    if (!page || page.text.length < 200) continue;
    status('Schreibe Notizen: ' + page.title.slice(0, 50));
    const text = await chat(model, [
      { role: 'system', content: 'Du machst Recherche-Notizen. Antworte auf Deutsch mit 3-5 knappen Stichpunkten (je Zeile mit "- "), nur Fakten, die zur Frage passen. Wenn nichts Relevantes drinsteht, antworte nur mit "-".' },
      { role: 'user', content: `Frage: ${question}\n\nSeite: ${page.title}\n\n${page.text}` }
    ], { signal });
    if (text && text.trim() !== '-') {
      const note = { id: Date.now() + notes.length, title: page.title || l.title, url: page.url, text, question };
      notes.push(note);
      ctx.addNote(note);
    }
  }
  await cursor(wc, accent, 'window.__shieldCursor.hide()');
  if (!notes.length) { send('ai-chunk', 'Ich habe Seiten besucht, aber nichts Brauchbares gefunden. Formuliere die Frage mal anders.'); return; }

  status('Fasse zusammen ...');
  const ctxText = notes.map((n, i) => `[${i + 1}] ${n.title} (${n.url})\n${n.text}`).join('\n\n');
  const answer = await chat(model, [
    { role: 'system', content: 'Beantworte die Frage auf Deutsch, klar und kompakt, ausschliesslich anhand der Notizen. Nenne Quellen als [1], [2]. Erfinde nichts.' },
    { role: 'user', content: `Frage: ${question}\n\nNotizen:\n${ctxText}` }
  ], { signal, onChunk: t => send('ai-chunk', t) });
  send('ai-chunk', answer + '\n\nQuellen:\n' + notes.map((n, i) => `[${i + 1}] ${n.url}`).join('\n'));
}

module.exports = { ensureOllama, ollamaUp, models, chat, research, pageText, Aborted, sleep, go, cursor };
