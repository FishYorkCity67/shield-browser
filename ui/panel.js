'use strict';
// Shield – Oberflaeche, Teil 2: rechte Karte (Orakel, Chronik, Gemach, Schutzzentrale), Aufgaben-Karte, Dialoge.
// In eine Funktion gepackt, damit die Namen nicht mit denen aus core.js kollidieren (klassische Skripte teilen den globalen Bereich).
(function () {
const { S, $, esc, stagger, ICON, hostOf } = U;
const isSandbox = () => U.settings.mode === 'sandbox';

// ---------- Rechte Karte ----------
let panelOpen = false, curPane = 'chat', panes = [];

function buildPanes() {
  panes = isSandbox()
    ? [{ id: 'shield', label: 'Schutz', ic: 'shieldlock' }, { id: 'menu', label: 'Hilfe', ic: 'info' }]
    : [{ id: 'chat', label: 'Orakel', ic: 'spark' }, { id: 'notes', label: 'Chronik', ic: 'scroll' }, { id: 'menu', label: 'Gemach', ic: 'gear' }];
  $('ptabs').innerHTML = panes.map(p => `<button data-p="${p.id}">${ICON[p.ic]}<span>${p.label}</span></button>`).join('') + '<div id="ind"></div>';
  $('ptabs').querySelectorAll('button').forEach(b => b.onclick = () => showPane(b.dataset.p));
  curPane = panes[0].id;
}

function moveInd() {
  const b = $('ptabs').querySelector('button.on'), ind = $('ind');
  if (!b || !ind) return;
  ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px';
  if (!ind.classList.contains('ready')) requestAnimationFrame(() => ind.classList.add('ready'));
}

function showPane(name) {
  if (!panes.some(p => p.id === name)) name = panes[0].id;
  curPane = name;
  $('ptabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + name));
  moveInd();
  if (name === 'menu') isSandbox() ? renderHelp() : renderMenu();
  if (name === 'notes') S.call('notes-get').then(renderNotes);
  if (name === 'shield') renderShield();
  if (name === 'chat') setTimeout(() => $('q').focus(), 160);
}

U.openPanel = async (name, toggle) => {
  if (isSandbox() && name === 'chat') name = 'shield';
  if (toggle && panelOpen && curPane === name) return closePanel();
  $('panel').classList.add('open');
  showPane(name);
  if (!panelOpen) { panelOpen = true; await U.tweenLay({ panel: U.CONST.PANEL_MAX }, 460); }
};
async function closePanel() {
  panelOpen = false;
  await U.tweenLay({ panel: 0 }, 340);
  if (!panelOpen) $('panel').classList.remove('open');
}
$('ai').onclick = () => U.openPanel('chat', true);
$('menu').onclick = () => U.openPanel(isSandbox() ? 'shield' : 'menu', true);
$('sfset').onclick = () => U.openPanel(isSandbox() ? 'shield' : 'menu', true);

// ---------- Orakel (Chat, Recherche, Aktionen, Aufgaben) ----------
const MODES = [['auto', 'Auto'], ['chat', 'Chat'], ['research', 'Recherche'], ['action', 'Aktion'], ['page', 'Diese Seite'], ['mission', 'Ablauf'], ['worker', 'Abarbeiten']];
const PH = {
  auto: 'Frag etwas oder gib einen Befehl ...', chat: 'Frag etwas ...', research: 'Was soll ich recherchieren?',
  action: 'Was soll ich im Browser tun? (z. B. Öffne ein YouTube-Video über ...)', page: 'Was soll ich auf dieser Seite tun oder finden? (leer = zusammenfassen)',
  mission: 'Beschreibe den Ablauf in Schritten: 1. ... 2. ... 3. ...',
  worker: 'Welche Aufgaben soll ich bearbeiten? (z. B. Mach die Aufgaben in Duolingo)'
};
const SUGS = [
  ['Abarbeiten', 'Mach die Aufgaben in Duolingo'],
  ['Aktion', 'Öffne ein YouTube-Video über den Mount Fuji'],
  ['Aufgabe', '1. Öffne Wikipedia zum Mount Fuji und kopiere die Höhe. 2. Öffne Wikipedia zu Tokio und kopiere die Einwohnerzahl. 3. Schreib beides als Liste auf.'],
  ['Recherche', 'Recherchiere: Wie funktioniert ein Kernfusionsreaktor?'],
  ['Diese Seite', 'Fasse diese Seite zusammen und zeig mir die wichtigste Stelle']
];
let mode = 'auto', busy = false, curMsg = null, mis = null;

function buildChat() {
  $('modes').innerHTML = MODES.map(([k, l]) => `<button class="chip${k === mode ? ' on' : ''}" data-mode="${k}">${l}</button>`).join('')
    + `<label class="cursor-opt" title="Die KI arbeitet sichtbar mit einem virtuellen Cursor auf der Seite (klicken, tippen, markieren)"><span>Cursor</span><button class="switch ${U.settings.cursorMode !== false ? 'on' : ''}" id="curSwitch" role="switch" aria-label="Virtueller Cursor"></button></label>`;
  $('modes').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $('modes').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    $('q').placeholder = PH[mode];
  });
  $('curSwitch').onclick = e => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); S.call('set-setting', 'cursorMode', on); U.toast(on ? 'Cursor an: die KI arbeitet sichtbar auf der Seite' : 'Cursor aus: die KI antwortet nur mit Text'); };
  $('q').placeholder = PH[mode];
  if (!$('msgs').children.length) showHint();
}

function showHint() {
  $('msgs').innerHTML = `<div class="hint"><h2>Dein Orakel</h2>Läuft komplett lokal auf deinem Rechner.<br><br>
    <b>Auto</b> erkennt selbst, ob du chatten, recherchieren, etwas im Browser tun oder eine mehrstufige Aufgabe starten willst. Mit <b>Cursor</b> siehst du der KI dabei live zu.
    <div class="sugs">${SUGS.map(([k, t]) => `<button class="sug" data-t="${esc(t)}" data-k="${esc(k)}"><small>${esc(k)}</small>${esc(t.length > 110 ? t.slice(0, 107) + '…' : t)}</button>`).join('')}</div></div>`;
  $('msgs').querySelectorAll('.sug').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    mode = { 'Aktion': 'action', 'Aufgabe': 'mission', 'Recherche': 'research', 'Diese Seite': 'page', 'Abarbeiten': 'worker' }[k] || 'auto';
    buildChat(); $('q').value = b.dataset.t; $('q').focus();
  });
}

function addMsg(cls, text) {
  const hint = $('msgs').querySelector('.hint'); if (hint) hint.remove();
  const d = document.createElement('div');
  d.className = 'm ' + cls; d.textContent = text;
  $('msgs').appendChild(d); $('msgs').scrollTo({ top: 1e9, behavior: 'smooth' });
  return d;
}
function setBusy(b) { busy = b; $('send').textContent = b ? 'Stopp' : 'Senden'; if (!b) $('status').textContent = ''; }

async function send(textOverride, modeOverride) {
  if (busy) { S.call('ai-stop'); return; }
  const text = (textOverride != null ? textOverride : $('q').value).trim();
  const m = modeOverride || mode;
  if (!text && m !== 'page') return;
  if (textOverride == null) $('q').value = '';
  addMsg('u', text || 'Diese Seite zusammenfassen');
  curMsg = addMsg('a', ''); curMsg.classList.add('typing'); curMsg.innerHTML = '<i></i><i></i><i></i>';
  mis = null;
  setBusy(true);
  S.call('ai-ask', { text, mode: m });
}
U.askAI = (text, m) => send(text, m);
$('send').onclick = () => send();
$('q').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

S.on('ai-chunk', t => {
  if (mis || !curMsg) return; // waehrend einer Aufgabe zeigt die Aufgaben-Karte den Stand
  curMsg.classList.remove('typing'); curMsg.textContent = t; $('msgs').scrollTop = 1e9;
});
S.on('ai-status', t => { $('status').textContent = t; });
S.on('ai-done', () => {
  if (curMsg && curMsg.classList.contains('typing')) { curMsg.classList.remove('typing'); curMsg.textContent = '(abgebrochen)'; }
  setBusy(false); mis = null;
});
S.on('ai-confirm', ({ id, q }) => {
  const d = document.createElement('div');
  d.className = 'confirm';
  d.innerHTML = `<div><b>Rückfrage</b><br>${esc(q)}</div><div class="btns"><button class="yes">Ja, ausführen</button><button class="no">Nein</button></div>`;
  const answer = yes => { S.call('ai-confirm-answer', id, yes); d.querySelector('.btns').innerHTML = `<span class="honest">${yes ? 'Bestätigt.' : 'Abgelehnt.'}</span>`; };
  d.querySelector('.yes').onclick = () => answer(true); d.querySelector('.no').onclick = () => answer(false);
  $('msgs').appendChild(d); $('msgs').scrollTo({ top: 1e9, behavior: 'smooth' });
});

// ---------- Aufgaben-Karte ----------
const CIRC = 100.5;
function missionCard(ev) {
  const card = document.createElement('div');
  card.className = 'mission';
  card.innerHTML = `<div class="mh"><h4>${esc(ev.title)}</h4>
    <svg class="ringp" viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/><text x="20" y="20">0/${ev.steps.length}</text></svg></div>
    <div class="steps">${ev.steps.map((s, i) => `<div class="mstep pending" data-i="${i}"><div class="ic">${i + 1}</div><div><div class="tt">${esc(s.title)}</div><div class="lg"></div></div></div>`).join('')}</div>
    <div class="report" style="display:none"></div>`;
  return card;
}
function missionProgress() {
  if (!mis) return;
  const done = mis.card.querySelectorAll('.mstep.done').length, n = mis.n;
  mis.card.querySelector('.fg').style.strokeDashoffset = String(CIRC * (1 - done / n));
  mis.card.querySelector('text').textContent = `${done}/${n}`;
}
S.on('mission', ev => {
  if (ev.ev === 'start') {
    if (curMsg) curMsg.remove();
    const card = missionCard(ev);
    $('msgs').appendChild(card); $('msgs').scrollTo({ top: 1e9, behavior: 'smooth' });
    mis = { card, n: ev.steps.length };
    return;
  }
  if (!mis) return;
  const step = i => mis.card.querySelector(`.mstep[data-i="${i}"]`);
  if (ev.ev === 'step') {
    const el = step(ev.i); if (!el) return;
    el.className = 'mstep ' + ev.status;
    const icon = el.querySelector('.ic');
    icon.innerHTML = ev.status === 'done' ? ICON.check : ev.status === 'failed' ? ICON.x : ev.status === 'running' ? '' : String(ev.i + 1);
    if (ev.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = ev.note; el.lastElementChild.appendChild(n); }
    if (ev.status === 'running') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    missionProgress();
  } else if (ev.ev === 'log') {
    const lg = step(ev.i)?.querySelector('.lg'); if (!lg) return;
    const d = document.createElement('div'); d.textContent = '• ' + ev.text; lg.appendChild(d);
    $('msgs').scrollTop = 1e9;
  } else if (ev.ev === 'copy') {
    const lg = step(ev.i)?.querySelector('.lg'); if (!lg) return;
    const c = document.createElement('div'); c.className = 'copychip';
    c.innerHTML = `${ICON.copy}<b>${esc(ev.label)}</b><span>${esc(ev.text.length > 160 ? ev.text.slice(0, 157) + '…' : ev.text)}</span>`;
    lg.appendChild(c); $('msgs').scrollTop = 1e9;
  } else if (ev.ev === 'final') {
    const rep = mis.card.querySelector('.report');
    rep.style.display = '';
    rep.innerHTML = `<pre></pre><div class="btns"><button class="chip" data-a="copy">${ev.aborted ? 'Zwischenbericht' : 'Bericht'} kopieren</button><button class="chip" data-a="notes">In der Chronik ansehen</button></div>`;
    rep.querySelector('pre').textContent = ev.report;
    rep.querySelector('[data-a=copy]').onclick = () => { S.call('clipboard-write', ev.report); U.toast('Bericht kopiert'); };
    rep.querySelector('[data-a=notes]').onclick = () => U.openPanel('notes');
    missionProgress();
    $('msgs').scrollTo({ top: 1e9, behavior: 'smooth' });
  }
});

// ---------- Abarbeiten-Karte (Aufgaben auf Webseiten, z. B. Duolingo) ----------
let workCard = null;
S.on('work', ev => {
  if (ev.ev === 'start') {
    if (curMsg) curMsg.remove();
    const card = document.createElement('div');
    card.className = 'workcard';
    card.innerHTML = `<div class="wh"><h4>Aufgaben · ${esc(ev.site)}</h4><span class="live">läuft</span></div>
      <div class="wstats">${[['answered', 'bearbeitet'], ['correct', 'richtig'], ['wrong', 'falsch'], ['skipped', 'übersprungen']].map(([k, l]) => `<div><b data-k="${k}">0</b><small>${l}</small></div>`).join('')}</div>
      <div class="wlive"><i class="pulse"></i><span>Ich lege los ...</span></div>
      <div class="wlog"></div><div class="report" style="display:none"></div>`;
    $('msgs').appendChild(card); $('msgs').scrollTo({ top: 1e9, behavior: 'smooth' });
    workCard = card; mis = { work: true };
    return;
  }
  if (!workCard) return;
  const set = (k, v) => { const el = workCard.querySelector(`[data-k="${k}"]`); if (el && el.textContent !== String(v)) { el.textContent = v; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } };
  if (ev.ev === 'tick') {
    for (const k of ['answered', 'correct', 'wrong', 'skipped']) set(k, ev[k]);
    if (ev.line) {
      workCard.querySelector('.wlive span').textContent = ev.line;
      const lg = workCard.querySelector('.wlog'), d = document.createElement('div');
      d.textContent = ev.line; lg.appendChild(d);
      while (lg.children.length > 7) lg.firstElementChild.remove();
      $('msgs').scrollTop = 1e9;
    }
  } else if (ev.ev === 'final') {
    for (const k of ['answered', 'correct', 'wrong', 'skipped']) set(k, ev[k]);
    workCard.classList.add('end');
    const live = workCard.querySelector('.live'); live.textContent = /gestoppt/.test(ev.reason) ? 'gestoppt' : 'fertig';
    workCard.querySelector('.wlive span').textContent = ev.reason || '';
    workCard.querySelector('.pulse').style.display = 'none';
    const rep = workCard.querySelector('.report');
    rep.style.display = '';
    rep.innerHTML = `<pre></pre><div class="btns"><button class="chip" data-a="copy">Bericht kopieren</button><button class="chip" data-a="notes">In der Chronik ansehen</button></div>`;
    rep.querySelector('pre').textContent = ev.report;
    rep.querySelector('[data-a=copy]').onclick = () => { S.call('clipboard-write', ev.report); U.toast('Bericht kopiert'); };
    rep.querySelector('[data-a=notes]').onclick = () => U.openPanel('notes');
    workCard = null;
    $('msgs').scrollTo({ top: 1e9, behavior: 'smooth' });
  }
});

// ---------- Chronik ----------
function renderNotes(list) {
  const el = $('notes');
  if (!list.length) { el.innerHTML = '<div class="empty">Noch keine Einträge. Recherchen und Aufgaben landen hier mit Quellen und Bericht.</div>'; stagger(el); return; }
  el.innerHTML = '<div class="tools"><button class="chip" id="nexp">Als Datei speichern</button><button class="chip danger" id="nclr">Alle löschen</button></div>' +
    list.map(n => `<div class="note"><button class="del" data-id="${n.id}" title="Löschen" aria-label="Löschen">&times;</button><b>${esc(n.title)}</b>${n.url ? `<a data-u="${esc(n.url)}">${esc(n.url)}</a>` : ''}<pre>${esc(n.text)}</pre><div class="tools" style="margin:8px 0 0"><button class="chip" data-copy="${n.id}">Kopieren</button></div></div>`).join('');
  stagger(el);
  el.querySelectorAll('.del').forEach(b => b.onclick = async () => renderNotes(await S.call('note-delete', +b.dataset.id)));
  el.querySelectorAll('[data-u]').forEach(a => a.onclick = () => S.call('new-tab', a.dataset.u));
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const n = list.find(x => x.id === +b.dataset.copy); if (n) { S.call('clipboard-write', n.text); U.toast('Kopiert'); } });
  $('nexp').onclick = () => S.call('notes-export');
  $('nclr').onclick = async () => renderNotes(await S.call('notes-clear'));
}
S.on('notes', n => { if (curPane === 'notes') renderNotes(n); });

// ---------- Gemach (Einstellungen) ----------
const THEMES = [['sakura', 'Kirschblüte', 'linear-gradient(160deg,#2a1636,#8a3d70)'], ['snow', 'Mitternacht', 'linear-gradient(160deg,#0a1230,#27447a)'], ['leaves', 'Herbst', 'linear-gradient(160deg,#2a1208,#92501c)'], ['off', 'Schlicht', 'linear-gradient(160deg,#14161a,#2a2d33)']];

async function renderFxList() {
  const box = $('fxlist'); if (!box) return;
  const list = await S.call('fx-list');
  const noun = U.NOUN[U.settings.fx] || 'Effekt';
  box.innerHTML = list.length ? list.map(x => `
      <div class="fxrow"><div class="info"><span class="h">${esc(x.host)}</span><small>${esc(x.reason)} · ${U.BY[x.by] || ''}</small></div>
        <span class="badge ${x.effect}">${x.effect === 'show' ? 'An' : 'Aus'}</span>
        <button class="mini" data-flip="${esc(x.host)}" title="Umschalten">${ICON.flip}</button>
        <button class="mini" data-del="${esc(x.host)}" title="Vergessen – die KI entscheidet neu">${ICON.x}</button></div>`).join('')
    : `<div class="empty">Noch nichts entschieden. Besuche Seiten – die KI entscheidet, wo die ${noun} bleiben.</div>`;
  box.querySelectorAll('[data-flip]').forEach(b => b.onclick = () => S.call('fx-flip', b.dataset.flip));
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => S.call('fx-reset', b.dataset.del));
}
S.on('fx-list-changed', () => { if (curPane === 'menu' && panelOpen) renderFxList(); });

async function renderMenu() {
  const [lists, st, set, models] = await Promise.all([S.call('get-lists'), S.call('get-state'), S.call('get-settings'), S.call('ai-models')]);
  U.settings = set;
  const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${!!on}"></button>`;
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const bm = lists.bookmarks.map(b => `<button class="item" data-u="${esc(b.url)}">${esc(b.title)}<small>${esc(b.url)}</small></button>`).join('') || '<div class="empty">Noch keine Lesezeichen</div>';
  const hi = lists.history.slice(0, 30).map(h => `<button class="item" data-u="${esc(h.url)}">${esc(h.title || h.url)}<small>${esc(h.url)}</small></button>`).join('') || '<div class="empty">Verlauf ist leer</div>';
  const modelOpts = (models.length ? models : [set.model]).map(m => `<option value="${esc(m)}" ${m === set.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
  $('menupane').innerHTML = `
    <div><h3>Erscheinung</h3>
      <div class="themes">${THEMES.map(([k, l, g]) => `<div class="theme ${set.fx === k ? 'on' : ''}" data-theme="${k}" style="background:${g}" title="${l}"><span>${l}</span></div>`).join('')}</div></div>
    <div><h3>Fallende Animation</h3>
      <div class="row"><span>KI entscheidet pro Seite</span>${sw('s-auto', set.fxAuto)}</div>
      <div class="empty" style="padding-top:0">Die lokale KI prüft jede neue Seite. Auf Lese-Seiten wie Wikipedia bleibt die Animation, bei Videos (z. B. YouTube) wird sie ausgeblendet. Läuft irgendwo ein großes Video, verschwindet sie sofort.</div>
      <div id="fxlist"></div>
      <div class="tools" style="margin-top:8px"><button class="chip danger" id="fxclr">Alle Entscheidungen vergessen</button></div></div>
    <div><h3>YouTube-Look</h3><div class="row"><span>Stil</span>${seg('s-yt', [['kino', 'Kino'], ['fokus', 'Fokus'], ['off', 'Aus']], set.yt)}</div></div>
    <div><h3>Orakel</h3>
      <div class="row"><span>Lokales Modell</span><select id="s-model">${modelOpts}</select></div>
      <div class="row"><span>KI arbeitet sichtbar mit Cursor</span>${sw('s-cursor', set.cursorMode !== false)}</div></div>
    <div><h3>Schutz</h3>
      <div class="row"><span>Werbe- &amp; Trackerblocker</span>${sw('s-ab', st.adblockOn)}</div>
      <div class="empty">${st.blockedCount} Anfragen abgewehrt. Aktiv: HTTPS-Upgrade, Do-Not-Track, keine Drittanbieter-Cookies, gekürzter Referrer, Berechtigungen verweigert.</div>
      <div class="tools"><button class="chip" id="s-iso">${ICON.shieldlock.replace('class="i"', 'class="i" style="width:14px;height:14px;vertical-align:-2px"')} Isolierten Modus starten</button></div></div>
    <div><h3>Lesezeichen</h3>${bm}</div>
    <div><h3>Verlauf</h3>${hi}</div>
    <div><h3>Daten</h3>
      <button class="item" id="clear-g" title="Löscht nur Google- und YouTube-Anmeldedaten, z. B. wenn Google die Anmeldung vorher abgelehnt hat">Google-Anmeldung zurücksetzen</button>
      <button class="item danger" id="clear">Cookies, Cache &amp; Verlauf löschen</button></div>`;
  stagger($('menupane'));
  const pane = $('menupane');
  pane.querySelectorAll('.theme').forEach(t => t.onclick = () => { S.call('set-setting', 'fx', t.dataset.theme); pane.querySelectorAll('.theme').forEach(x => x.classList.toggle('on', x === t)); });
  const toggle = (id, key, extra) => { const b = $(id); b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); S.call(extra || 'set-setting', ...(extra ? [on] : [key, on])); }; };
  toggle('s-auto', 'fxAuto'); toggle('s-cursor', 'cursorMode'); toggle('s-ab', null, 'adblock');
  $('s-yt').querySelectorAll('button').forEach(b => b.onclick = () => { S.call('set-setting', 'yt', b.dataset.v); $('s-yt').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $('s-model').onchange = e => S.call('set-setting', 'model', e.target.value);
  $('fxclr').onclick = () => S.call('fx-clear');
  $('s-iso').onclick = () => U.sandboxDialog();
  $('clear').onclick = async () => { await S.call('clear-data'); U.toast('Cookies, Cache und Verlauf gelöscht'); renderMenu(); };
  $('clear-g').onclick = async () => { const n = await S.call('clear-google'); U.toast(n ? `Google-Anmeldedaten zurückgesetzt (${n} Einträge)` : 'Keine Google-Anmeldedaten gefunden'); };
  pane.querySelectorAll('[data-u]').forEach(b => b.onclick = () => S.call('navigate', b.dataset.u));
  renderFxList();
}

// ---------- Isolierter Modus: Start-Dialog (im normalen Browser) ----------
const LEVELS = {
  normal: ['Normal', 'Getrennte Sitzung, Tracker und Drittanbieter-Cookies gesperrt, Fingerabdruck-Schutz, keine Downloads. Seiten funktionieren fast immer.'],
  strict: ['Streng', 'Zusätzlich: Drittanbieter dürfen nur Bilder, Stile und Schriften liefern – keine Skripte, Rahmen oder Hintergrundverbindungen. Empfohlen.'],
  max: ['Maximal', 'Skripte aus, alles von Drittanbietern gesperrt, kein WebRTC, Cookies aus, Seitengröße in festen Stufen. Viele Seiten sehen dann schlicht aus.']
};
U.sandboxDialog = () => {
  if (isSandbox()) return;
  let level = 'strict';
  U.openModal(`<h2>Isolierter Modus</h2>
    <p>Öffnet ein <b>eigenes Fenster in einem getrennten Prozess</b> mit einem Wegwerf-Profil. Cookies, Verlauf und Speicher liegen nur im Arbeitsspeicher und verschwinden beim Schließen. Die KI ist dort bewusst aus, und nichts davon berührt deinen normalen Browser.</p>
    <div class="lvl" id="lvls">${Object.entries(LEVELS).map(([k, [n, d]]) => `<button data-l="${k}" class="${k === level ? 'on' : ''}"><b>${n}${k === 'strict' ? '<span style="color:var(--gold);font-weight:500">empfohlen</span>' : ''}</b><small>${d}</small></button>`).join('')}</div>
    <h3>Proxy oder Tor (optional)</h3>
    <div class="pxrow"><input id="px" placeholder="socks5://127.0.0.1:9050" spellcheck="false" autocomplete="off"><button class="chip" data-px="socks5://127.0.0.1:9050">Tor-Dienst</button><button class="chip" data-px="socks5://127.0.0.1:9150">Tor Browser</button></div>
    <div class="callout" style="margin-top:14px"><b>Ehrlich gesagt:</b> Ohne Proxy, Tor oder VPN sieht die besuchte Seite weiterhin deine IP-Adresse. Der Modus schützt vor Tracking, Fingerabdrücken und Spuren auf deinem PC – er ersetzt weder einen Virenscanner noch macht er dich anonym. Gib dort keine echten Passwörter oder Zahlungsdaten ein.</div>
    <div class="btns"><button class="btn" id="m-cancel">Abbrechen</button><button class="btn primary" id="m-go">Isolierten Modus starten</button></div>`, m => {
    m.querySelectorAll('#lvls button').forEach(b => b.onclick = () => { level = b.dataset.l; m.querySelectorAll('#lvls button').forEach(x => x.classList.toggle('on', x === b)); });
    m.querySelectorAll('[data-px]').forEach(b => b.onclick = () => { $('px').value = b.dataset.px; });
    $('m-cancel').onclick = () => U.closeOverlay();
    $('m-go').onclick = async () => {
      const r = await S.call('sandbox-launch', { level, proxy: $('px').value.trim() });
      if (r && r.ok) { U.closeOverlay(); U.toast('Isoliertes Fenster wird geöffnet …'); }
      else U.toast((r && r.error) || 'Start fehlgeschlagen', 4200);
    };
  });
};
$('isobtn').onclick = () => U.sandboxDialog();

// ---------- Isolierter Modus: Schutzzentrale ----------
let sbData = null;
const STAT_LABELS = [['trackers', 'Tracker'], ['thirdParty', 'Drittanbieter'], ['cookies', 'Cookies'], ['downloads', 'Downloads'], ['permissions', 'Zugriffe'], ['popups', 'Popups']];

function renderBanner() {
  if (!sbData) return;
  $('bn-level').innerHTML = `<b style="color:var(--gold)">${LEVELS[sbData.level][0]}</b>${sbData.proxy ? ' · Proxy an' : ''}`;
  const s = sbData.stats;
  $('bn-stats').textContent = `Tracker ${s.trackers} · Drittanbieter ${s.thirdParty} · Downloads ${s.downloads}`;
}

async function renderShield() {
  sbData = await S.call('sb-get'); if (!sbData) return;
  renderBanner();
  const cur = U.state.tabs.find(t => t.id === U.state.active);
  let site = '';
  if (cur && !cur.start) {
    const host = hostOf(cur.url), puny = /xn--/.test(host);
    site = `<div><h3>Aktuelle Seite</h3><div class="callout"><b>${esc(host)}</b><br>${cur.secure ? 'Verschlüsselte Verbindung (HTTPS).' : 'Unverschlüsselt – Inhalte können mitgelesen werden.'}${puny ? '<br><b>Achtung:</b> Die Adresse enthält Sonderzeichen-Kodierung (xn--). Das wird oft für täuschend ähnliche Fälschungen genutzt.' : ''}<br><span class="honest">Gib hier keine echten Passwörter oder Zahlungsdaten ein.</span></div></div>`;
  }
  const s = sbData.stats;
  $('shieldpane').innerHTML = `
    <div><h3>Schutzstufe</h3><div class="lvl" id="lvls2">${Object.entries(LEVELS).map(([k, [n, d]]) => `<button data-l="${k}" class="${sbData.level === k ? 'on' : ''}"><b>${n}</b><small>${d}</small></button>`).join('')}</div></div>
    ${site}
    <div><h3>Abgewehrt in dieser Sitzung</h3><div class="stats" id="stats">${STAT_LABELS.map(([k, l]) => `<div class="stat"><b data-s="${k}">${s[k]}</b><small>${l}</small></div>`).join('')}</div></div>
    <div><h3>Verbindung</h3>
      <div class="row"><span>Skripte (JavaScript)</span><button class="switch ${sbData.scripts ? 'on' : ''}" id="sw-js" role="switch"></button></div>
      <div class="row"><span title="Namensanfragen laufen verschlüsselt, dein Internetanbieter sieht nicht, welche Seiten du aufrufst">Verschlüsseltes DNS</span><button class="switch ${sbData.doh ? 'on' : ''}" id="sw-doh" role="switch"></button></div>
      <div class="pxrow"><input id="px2" value="${esc(sbData.proxy)}" placeholder="Proxy, z. B. socks5://127.0.0.1:9050" spellcheck="false" autocomplete="off"><button class="chip" id="px-set">Übernehmen</button></div>
      <div class="tools" style="margin-top:8px"><button class="chip" id="ipchk">Meine sichtbare IP zeigen</button><button class="chip" id="torchk">Tor-Test</button></div>
      <div class="honest" style="margin-top:6px">Ohne Proxy/Tor/VPN sieht jede Seite deine echte IP-Adresse. Mit Proxy gehen alle Verbindungen darüber; ist er nicht erreichbar, bricht der Modus ab statt direkt zu verbinden.</div></div>
    <div><h3>Aufräumen</h3><button class="item danger" id="wipe2">${ICON.trash.replace('class="i"', 'class="i" style="width:15px;height:15px;vertical-align:-3px"')} Alle Spuren jetzt vernichten und neu beginnen</button></div>`;
  stagger($('shieldpane'));
  const pane = $('shieldpane');
  pane.querySelectorAll('#lvls2 button').forEach(b => b.onclick = async () => { await S.call('sb-set-level', b.dataset.l); U.toast(`Schutzstufe: ${LEVELS[b.dataset.l][0]} – Seiten werden neu geladen`); renderShield(); });
  $('sw-js').onclick = async e => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); await S.call('sb-set-scripts', on); };
  $('sw-doh').onclick = async e => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); await S.call('sb-set-doh', on); U.toast(on ? 'Verschlüsseltes DNS an' : 'Verschlüsseltes DNS aus'); };
  $('px-set').onclick = async () => { const r = await S.call('sb-set-proxy', $('px2').value); if (r && r.ok) { U.toast(r.proxy ? 'Proxy gesetzt' : 'Direkte Verbindung'); sbData.proxy = r.proxy; renderBanner(); } else U.toast((r && r.error) || 'Ungültig', 4000); };
  $('ipchk').onclick = () => S.call('new-tab', 'https://api64.ipify.org/');
  $('torchk').onclick = () => S.call('new-tab', 'https://check.torproject.org/');
  $('wipe2').onclick = () => U.wipe();
}

U.wipe = async () => {
  await S.call('sb-wipe');
  U.toast('Alle Spuren vernichtet – frische Sitzung');
  if (curPane === 'shield') renderShield();
};
$('wipebtn').onclick = () => U.wipe();
S.on('sb-stats', st => {
  if (!sbData) return;
  sbData.stats = st; renderBanner();
  for (const [k] of STAT_LABELS) { const el = document.querySelector(`#stats [data-s="${k}"]`); if (el) el.textContent = st[k]; }
});
$('banner').addEventListener('click', e => { if (!e.target.closest('.stripe')) U.openPanel('shield'); });

function renderHelp() {
  $('menupane').innerHTML = `
    <div><h3>Was der Modus macht</h3><ul class="honest">
      <li>Eigener Prozess und ein Wegwerf-Profil, das beim Schließen gelöscht wird.</li>
      <li>Sitzung nur im Arbeitsspeicher: Cookies, Verlauf, Cache und Speicher bleiben nicht auf dem PC.</li>
      <li>Tracker und Werbung gesperrt, nur HTTPS, gekürzte Herkunft, keine Drittanbieter-Cookies.</li>
      <li>Fingerabdruck-Schutz: einheitliches Browserbild, Zeitzone UTC, Standard-Bildschirm, Rauschen bei Canvas/Audio.</li>
      <li>Downloads, Kamera, Mikrofon, Standort, Benachrichtigungen und Popups sind gesperrt.</li>
      <li>Kein WebRTC-Leck, verschlüsseltes DNS, keine KI und keine Lesezeichen.</li></ul></div>
    <div><h3>Was er nicht kann</h3><ul class="honest">
      <li><b>Deine IP-Adresse verstecken:</b> Das geht nur mit Proxy, Tor oder VPN.</li>
      <li>Kein Ersatz für Virenscanner. Ein Fehler im Browser selbst bleibt möglich – darum gilt: Programme nie öffnen, nichts installieren.</li>
      <li>Wer sich einloggt, ist für die Seite erkennbar. Echte Passwörter und Zahlungsdaten gehören hier nicht hin.</li>
      <li>Ein Windows-Sandbox-Fenster (echte virtuelle Maschine) gibt es unter Windows Home nicht.</li></ul></div>`;
  stagger($('menupane'));
}

// ---------- Start ----------
U.on('init', () => {
  buildPanes();
  if (!isSandbox()) buildChat();
  U.emit('panel-ready');
  if (isSandbox()) {
    renderShield();
    setTimeout(() => U.openPanel('shield'), 2600); // einmal zeigen, welche Schutzfunktionen laufen
  }
});
U.on('settings', () => { if (panes.length && (isSandbox() !== (panes[0].id === 'shield'))) { buildPanes(); showPane(panes[0].id); } if (!isSandbox() && $('modes').children.length) buildChat(); });
U.on('tabs', () => { if (isSandbox() && curPane === 'shield' && panelOpen) renderShield(); });
})();
