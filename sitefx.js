// Entscheidet mit der lokalen KI (Ollama), ob der Partikel-Effekt (Bluetenblaetter usw.) auf einer Seite bleibt.
// Die KI ordnet die Seite einer Art zu (Video, Lexikon, Code ...); daraus folgt die Entscheidung.
// Ein kleines Sicherheitsnetz korrigiert eindeutige Fehlgriffe (z. B. Leseseiten mit eingebettetem Video).
const { chat } = require('./agent');

// Schluessel pro Seite: Hostname ohne www./m. (Subdomains wie music.youtube.com bleiben getrennt)
function siteKey(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  } catch { return ''; }
}

// Arten, bei denen der Effekt ausgeblendet wird, und Arten, bei denen er bleibt
const HIDE = {
  video: 'Videoseite', music: 'Musik und Audio', game: 'Spiel', map: 'Karte', app: 'Arbeits-App',
  code: 'Code und Entwicklung', mail_chat: 'E-Mail oder Chat', finance: 'Bank und Zahlung', form: 'Formular oder Login'
};
const SHOW = {
  article: 'Artikel zum Lesen', reference: 'Nachschlagewerk zum Lesen', news: 'Nachrichten zum Lesen', blog: 'Blog zum Lesen',
  recipe: 'Rezept zum Lesen', shopping: 'Entspanntes Stöbern', social: 'Soziales Netzwerk', search: 'Suchergebnisse', leisure: 'Entspannte Seite'
};
const LABEL = { ...HIDE, ...SHOW };
const KINDS = Object.keys(LABEL);

// Bekannte Seiten, die die KI-Antwort nicht kippen darf
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|twitch\.tv|netflix\.com|primevideo\.com|disneyplus\.com|vimeo\.com|dailymotion\.com|tiktok\.com|crunchyroll\.com|arte\.tv|zdf\.de\/mediathek|ardmediathek\.de|joyn\.de|rtl\.de\/tvnow)$/;
const APP_HOSTS = /(^|\.)(maps\.google\.[a-z.]+|docs\.google\.com|mail\.google\.com|drive\.google\.com|outlook\.(live|office)\.com|github\.com|gitlab\.com|figma\.com|notion\.so|slack\.com|discord\.com|web\.whatsapp\.com|zoom\.us|chatgpt\.com|claude\.ai|codepen\.io|replit\.com|trello\.com|miro\.com|canva\.com|spotify\.com|soundcloud\.com)$/;

const SYSTEM = `You look at a website and say what kind of page it is, so a decorative falling-petals animation can be switched off on pages where it would disturb.
Choose exactly one "kind":
video = watching videos or live streams; music = music or audio players; game = games; map = maps and navigation; app = web apps and tools (documents, spreadsheets, design, dashboards, admin); code = code hosting, editors, programming tools; mail_chat = email, messaging, chat; finance = banking, payments, trading; form = login, sign-up, checkout, long forms;
article = articles and long reading; reference = encyclopedias, documentation, dictionaries; news = news sites; blog = blogs and magazines; recipe = cooking and food; shopping = browsing shops and products; social = social networks and forums; search = search engines and result pages; leisure = travel, art, hobbies, portfolios, relaxed browsing.
Embedded videos or search boxes inside a long text page do NOT make it a video or app page.
"reason": at most 6 words, in German.`;

const describe = (host, f) => [
  `site: ${host}`,
  `title: ${f.title || '-'}`,
  `description: ${f.desc || '-'}`,
  `large video players: ${f.videos || 0}`,
  `visible text inputs: ${f.inputs || 0}`,
  `large canvases: ${f.canvases || 0}`,
  `long paragraphs: ${f.paragraphs || 0}`,
  `words of text: ${f.words || 0}`
].join('\n');

const SHOTS = [
  ['youtube.com', { title: 'YouTube', desc: 'Videos ansehen und teilen', videos: 0, inputs: 1, canvases: 0, paragraphs: 0, words: 270 }, { kind: 'video', reason: 'Videoplattform' }],
  ['de.wikipedia.org', { title: 'Fudschijama – Wikipedia', desc: '', videos: 1, inputs: 9, canvases: 0, paragraphs: 62, words: 5200 }, { kind: 'reference', reason: 'Lexikon zum Lesen' }],
  ['github.com', { title: 'owner/project: A fast toolkit', desc: 'Contribute to project development', videos: 0, inputs: 3, canvases: 0, paragraphs: 6, words: 950 }, { kind: 'code', reason: 'Code und Entwicklung' }],
  ['spiegel.de', { title: 'Politik – DER SPIEGEL', desc: 'Nachrichten und Analysen', videos: 0, inputs: 1, canvases: 0, paragraphs: 24, words: 1900 }, { kind: 'news', reason: 'Nachrichten zum Lesen' }],
  ['mail.google.com', { title: 'Posteingang (12) – Mail', desc: '', videos: 0, inputs: 3, canvases: 0, paragraphs: 0, words: 420 }, { kind: 'mail_chat', reason: 'E-Mail braucht Ruhe' }],
  ['kochblog.example', { title: 'Cremige Kürbissuppe – Rezept', desc: 'So gelingt die Suppe', videos: 0, inputs: 2, canvases: 0, paragraphs: 14, words: 1300 }, { kind: 'recipe', reason: 'Rezept zum Lesen' }],
  ['twitch.tv', { title: 'Twitch', desc: 'Live-Streams ansehen', videos: 1, inputs: 1, canvases: 0, paragraphs: 0, words: 310 }, { kind: 'video', reason: 'Live-Streams' }],
  ['openstreetmap.org', { title: 'OpenStreetMap', desc: '', videos: 0, inputs: 2, canvases: 1, paragraphs: 1, words: 120 }, { kind: 'map', reason: 'Karte braucht freie Sicht' }],
  ['blog.example', { title: 'Meine Reise nach Kyoto', desc: 'Reisebericht mit Fotos', videos: 0, inputs: 1, canvases: 0, paragraphs: 18, words: 2100 }, { kind: 'blog', reason: 'Reisebericht zum Lesen' }]
];

const SCHEMA = {
  type: 'object',
  properties: { kind: { type: 'string', enum: KINDS }, reason: { type: 'string' } },
  required: ['kind', 'reason']
};

// Fragt die KI nach der Art der Seite. Wirft bei Fehlern.
async function classify(model, host, features, signal) {
  const messages = [{ role: 'system', content: SYSTEM }];
  for (const [h, f, out] of SHOTS) messages.push({ role: 'user', content: describe(h, f) }, { role: 'assistant', content: JSON.stringify(out) });
  messages.push({ role: 'user', content: describe(host, features) });
  let raw;
  try { raw = await chat(model, messages, { json: SCHEMA, signal }); }
  catch (e) { if (signal && signal.aborted) throw e; raw = await chat(model, messages, { json: true, signal }); } // aeltere Ollama-Versionen ohne Schema
  const j = JSON.parse(raw);
  const kind = String(j.kind || '').toLowerCase();
  if (!LABEL[kind]) throw new Error('Unklare Antwort');
  return { kind, reason: String(j.reason || '').slice(0, 60) };
}

// Macht aus der KI-Antwort (oder ohne KI aus Regeln) die endgueltige Entscheidung
function finalize(host, f = {}, k = null) {
  const textHeavy = (f.paragraphs || 0) >= 12 && (f.words || 0) >= 1000 && !f.videos && (f.inputs || 0) <= 3 && !f.canvases;
  let kind = k && k.kind;
  let reason = (k && k.reason) || '';
  const by = k ? 'ai' : 'regel';

  if (VIDEO_HOSTS.test(host)) {                         // Video-Plattformen: Effekt aus, damit nichts das Video stoert
    if (kind !== 'video') reason = '';
    kind = 'video';
  } else if (!kind) {                                   // KI nicht verfuegbar: Regeln
    if (APP_HOSTS.test(host)) kind = 'app';
    else if (/bank|sparkasse|paypal|checkout/.test(host)) kind = 'finance';
    else if (f.videos && !textHeavy) kind = 'video';
    else if (f.canvases) kind = 'game';
    else if ((f.inputs || 0) >= 6) kind = 'form';
    else kind = textHeavy ? 'article' : 'leisure';
  } else if (HIDE[kind] && textHeavy && !APP_HOSTS.test(host)) {   // Lange Textseite: bleibt an, auch wenn die KI sich vertan hat
    kind = 'article'; reason = 'Lange Leseseite';
  } else if (SHOW[kind] && f.playing) {                 // Ein grosses Video spielt gerade: aus (blosse Teaser-Videos zaehlen nicht)
    kind = 'video'; reason = 'Video läuft';
  }
  return { effect: HIDE[kind] ? 'hide' : 'show', kind, reason: (reason || LABEL[kind]).slice(0, 60), by };
}

// Wird in die Seite eingeschleust: sammelt grobe Merkmale (nur lokal, nichts verlaesst den PC).
const FEATURES_JS = `(() => {
  const all = s => [...document.querySelectorAll(s)];
  const vis = e => { const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const big = (e, w, h) => { const r = e.getBoundingClientRect(); return r.width >= w && r.height >= h && vis(e); };
  const meta = document.querySelector('meta[name="description"],meta[property="og:description"]');
  const frames = all('iframe').filter(f => /youtube|vimeo|twitch|dailymotion/i.test(f.src || '') && big(f, 320, 180)).length;
  return {
    title: (document.title || '').slice(0, 120),
    desc: ((meta && meta.content) || '').slice(0, 160),
    videos: all('video').filter(v => big(v, 320, 180)).length + frames,
    playing: all('video').some(v => !v.paused && !v.ended && big(v, 320, 180)),
    inputs: all('input[type=text],input[type=search],input[type=email],input[type=password],input[type=tel],input[type=url],input[type=number],input:not([type]),textarea,[contenteditable=true]').filter(vis).length,
    canvases: all('canvas').filter(c => big(c, 200, 150)).length,
    paragraphs: all('p').filter(p => (p.innerText || '').length > 80).length,
    words: ((document.body && document.body.innerText) || '').split(/\\s+/).length
  };
})()`;

module.exports = { siteKey, classify, finalize, FEATURES_JS, LABEL };
