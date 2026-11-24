// Aufgaben-Arbeiter: bearbeitet Uebungen, Lektionen, Quizze und Hausaufgaben auf einer Webseite (z. B. Duolingo) Schritt fuer Schritt –
// Antwort waehlen, Wortkacheln setzen, tippen, "Pruefen" und "Weiter" druecken – sichtbar mit Cursor, bis nichts mehr uebrig ist.
// Aufbau: Der Bildschirm wird zuerst fest erkannt (Auswahl, Wortkacheln, Eingabe, Paare, Audio). Fuer die Antwort bekommt die KI eine
// kleine, klare Aufgabe (Antwort-Schluessel) statt einer grossen Agenten-Anweisung – das ist mit kleinen lokalen Modellen viel treffsicherer.
const { chat, models, sleep, cursor, Aborted } = require('./agent');
const T = require('./webtools');
const { str, normUrl } = T;

// ---------- Erkennung: will der Nutzer, dass Aufgaben auf einer Seite erledigt werden? ----------
const STRONG = 'aufgabe|aufgaben|übung|übungen|uebung|uebungen|lektion|lektionen|hausaufgabe|hausaufgaben|exercises?|lessons?|tasks?';
const WEAK = 'quiz|quizze|test|tests|fragen|level|kurs|kurse|vokabeln|karteikarten|einheit|einheiten|sessions?';
const VERB = '(?:mach|mache|machen|erledige|erledigen|bearbeite|bearbeiten|löse|lösen|loese|loesen|absolviere|absolvieren|übe|üben|ueben|beantworte|beantworten|arbeite|arbeiten|spiele|spielen|durchlaufe|schließe|schliesse|übernimm|uebernimm|do|complete|finish|solve)';
const RE_VERB_NOUN = new RegExp(`(^|[^\\p{L}])${VERB}[\\p{L}]*(\\s+\\S+){0,4}?\\s+(?:${STRONG})`, 'iu');
const RE_NOUN_VERB = new RegExp(`(?:${STRONG})[\\p{L}]*\\s+(?:in|auf|bei|von|aus|im|an)\\s+\\S+(\\s+\\S+){0,3}?\\s+${VERB}`, 'iu');
const RE_WEAK = new RegExp(`(^|[^\\p{L}])${VERB}[\\p{L}]*\\s+(?:die|das|alle|meine|diese[sn]?|dieses)\\s+(?:${WEAK})`, 'iu');
const QUESTIONY = /(^|\s)(wie|was|warum|wieso|weshalb|wann|wo|welche[rsmn]?)\s/i;

function isTaskRequest(text) {
  const t = String(text || '').trim();
  if (!t || /\?\s*$/.test(t) || QUESTIONY.test(t.slice(0, 22))) return false;
  return RE_VERB_NOUN.test(t) || RE_NOUN_VERB.test(t) || RE_WEAK.test(t);
}

// Bekannte Lern- und Aufgabenseiten (Name -> Startadresse); sonst eine Adresse im Text
const KNOWN = [
  { re: /duolingo/i, name: 'Duolingo', url: 'https://www.duolingo.com/learn' },
  { re: /khan\s*academy|khanacademy/i, name: 'Khan Academy', url: 'https://www.khanacademy.org/' },
  { re: /quizlet/i, name: 'Quizlet', url: 'https://quizlet.com/latest' },
  { re: /memrise/i, name: 'Memrise', url: 'https://app.memrise.com/' },
  { re: /babbel/i, name: 'Babbel', url: 'https://my.babbel.com/' },
  { re: /busuu/i, name: 'Busuu', url: 'https://www.busuu.com/' }
];
function resolveTarget(text) {
  for (const s of KNOWN) if (s.re.test(text)) return { name: s.name, url: s.url };
  const d = String(text).match(/\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i);
  if (d) { const u = normUrl(d[1]); if (u) return { name: new URL(u).hostname.replace(/^www\./, ''), url: u }; }
  return null;
}

// ---------- Muster fuer Knoepfe und Bildschirme ----------
// (als Zeichenketten, weil sie auch in der Seite gesucht werden; die Texte werden dort vor dem Vergleich bereinigt)
const CHECK_RE = '^(pr(?:ü|ue)fen|(?:ü|ue)berpr(?:ü|ue)fen|antwort pr(?:ü|ue)fen|check|check answer|submit|absenden|antworten|best(?:ä|ae)tigen)$';
const CHECK_STRICT = /^(pr(?:ü|ue)fen|(?:ü|ue)berpr(?:ü|ue)fen|antwort pr(?:ü|ue)fen|check|check answer)$/i;
const CONT_RE = "^(weiter|continue|fortfahren|next|n(?:ä|ae)chste[rsm]?|verstanden|got it|ok|okay|los geht'?s|weiter geht'?s|abschlie(?:ß|ss)en|beenden|fertig|done|xp (?:einl(?:ö|oe)sen|erhalten)|claim xp|ich bin bereit|sieht gut aus)$";
const START_RE = "^(start|starten|jetzt starten|loslegen|lektion starten|(?:ü|ue)bung starten|let'?s go|begin|beginnen|weiter lernen|fortsetzen|lektion fortsetzen|start lesson|continue lesson)(?: ?\\+ ?\\d+ ?(?:xp|ep))?$";
// Ablehnen von Angeboten und Hinweisen (immer harmlos)
const DISMISS_STRICT = "^(nein,? ?danke|jetzt nicht|nicht jetzt|vielleicht sp(?:ä|ae)ter|sp(?:ä|ae)ter|no,? ?thanks|no thanks|not now|maybe later|skip for now|kein interesse)$";
const DISMISS_LOOSE = "^(nein|schlie(?:ß|ss)en|close|no|×|✕|x)$";
const SKIP_ANY = "^((?:aufgabe |übung |uebung )?(?:ü|ue)berspringen|skip)$";
// Audio-Aufgaben lassen sich ohne Ton/Mikrofon nicht loesen: dort gibt es "Kann gerade nicht sprechen/zuhoeren"
const AUDIO_SKIP = /(kann (?:gerade|jetzt|momentan|im moment) nicht (?:zuh(?:ö|oe)ren|h(?:ö|oe)ren|sprechen|reden)|nicht (?:zuh(?:ö|oe)ren|h(?:ö|oe)ren|sprechen)|can'?t (?:listen|speak|hear|talk)|cannot (?:listen|speak)|no puedo (?:escuchar|hablar)|je ne peux pas (?:écouter|ecouter|parler)|non posso (?:ascoltare|parlare))/i;
const UPSELL_RE = /(duolingo (?:super|max)|super duolingo|super (?:gratis|testen|ausprobieren|holen|werden|kostenlos)|mit super\b|try super|get super|go super|premium|free trial|kostenlos testen|gratis (?:testen|probieren|ausprobieren)|\d+ tage (?:gratis|kostenlos)|probewoche|upgrade|werbefrei|ad-free|abonnement|\babo\b|subscribe)/i;
const PRICE_RE = /(\d+[.,]\d{2}\s?(?:€|eur\b|usd|\$|chf|£)|(?:€|\$|£)\s?\d+[.,]\d{2}|pro monat|per month|\/\s?(?:monat|mo\b|month)|j(?:ä|ae)hrlich|monatlich|yearly|monthly|kreditkarte|credit card|zahlungsmethode|payment method)/i;
const LESSON_DONE_RE = /(lektion (?:abgeschlossen|geschafft)|lesson (?:complete|completed)|(?:übung|uebung) abgeschlossen|perfekte lektion|alle (?:aufgaben|übungen) (?:erledigt|geschafft)|genauigkeit|\baccuracy\b)/i;
const NO_TASKS_RE = /(keine (?:weiteren |neuen |offenen |anderen )?(?:aufgaben|übungen|uebungen|lektionen)(?: mehr)?|alles erledigt|alle (?:aufgaben|übungen|lektionen) (?:erledigt|geschafft|abgeschlossen)|nothing (?:left|more) to do|no (?:more|further|remaining) (?:tasks|exercises|lessons)|all (?:tasks|exercises|lessons) (?:are )?(?:done|complete))/i;
const HEARTS_RE = /(keine herzen mehr|du hast keine herzen|ohne herzen|out of hearts|no hearts left|you have no hearts)/i;
const WRONG_RE = /(richtige lösung|korrekte lösung|richtig wäre|correct solution|correct answer|falsch|nicht ganz|incorrect|leider|knapp daneben|almost)/i;
const SOLUTION_RE = /(?:richtige|korrekte) l(?:ö|oe)sung(?:en)?:?\s*\n?\s*([^\n]{1,120})|correct (?:solution|answer)s?:?\s*\n?\s*([^\n]{1,120})/i;
// Dort wird nie geklickt (Geld, Abos, Abmelden, Loeschen, Einstellungen) – gilt fuer Knoepfe und Links, nicht fuer Antworten einer Uebung
const HARD_RISKY = /(kaufen|bestell|bezahl|zahlungspflichtig|\bbuy\b|purchase|checkout|\bpay\b|abonnier|subscribe|upgrade|premium|super\b|\bplus\b|probe|trial|gratis|kostenlos|abmelden|logout|sign out|ausloggen|lösch|delete|entfern|remove|passwort|password|einstellung|settings)/i;

// Bewertungs- und Melde-Knoepfe in der Rueckmeldung ("Zu leicht", "Zu schwierig", "Melden" ...): nie anklicken
const NOISE_CLICK = /^(zu leicht|zu schwierig|zu einfach|too easy|too hard|too difficult|melden|problem melden|bericht(?:en)?|report|diskutieren|discuss|teilen|share|hinweis)$/i;
const cl = s => String(s || '').replace(/\s+/g, ' ').replace(/[.!…›»]+$/, '').trim();
const rx = src => new RegExp(src, 'i');
const nt = s => String(s || '').toLowerCase().replace(/[.,!?¿¡;:"“”„‚'’`´()\[\]{}…\-–—]/g, '').replace(/\s+/g, ' ').trim();
const ntc = s => nt(s).replace(/\s+/g, '');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const dbg = (...a) => { if (process.env.SHIELD_DEBUG) console.log('worker', ...a); };

// ---------- Bildschirm erkennen ----------
// Knoepfe, die zur Steuerung gehoeren (nie ein Antwort-Baustein)
const isNav = e => { const t = cl(e.text); return CHECK_STRICT.test(t) || rx(CONT_RE).test(t) || rx(SKIP_ANY).test(t) || AUDIO_SKIP.test(e.text) || HARD_RISKY.test(e.text) || NOISE_CLICK.test(t); };
const PAIRS_TEXT = /(passenden paare|tippe .{0,30}paar|ordne .{0,40}zu|zuordnen|tap the matching pairs|match the (?:pairs|words))/i;
const GAP_TEXT = /(f(?:ü|ue)ll die l(?:ü|ue)cken?|fill in the (?:blank|gap)s?|erg(?:ä|ae)nze|complete the sentence|l(?:ü|ue)ckentext)/i;

// Liefert den Aufgabentyp: audio | match | choice | gap | build | type | null (keine Aufgabe sichtbar)
function detect(obs) {
  const usable = obs.els.filter(e => !e.disabled);
  const checkEl = obs.els.find(e => CHECK_STRICT.test(cl(e.text)));
  const audio = usable.find(e => AUDIO_SKIP.test(e.text));
  const choices = usable.filter(e => e.kind === 'choice');
  // Kacheln: durch data-test ausgewiesen, oder (nur bei sichtbarem Pruefen-Knopf) an ihrem Klassennamen erkannt
  const tiles = usable.filter(e => e.kind === 'tile' && e.text && (e.dt || checkEl));
  const inputs = usable.filter(e => e.kind === 'input');
  const loose = usable.filter(e => e.kind === 'clickable' && e.text && e.text.length <= 70 && !NOISE_CLICK.test(cl(e.text)));
  const pairBtns = usable.filter(e => ['tile', 'button', 'clickable', 'choice'].includes(e.kind) && e.text && e.text.length <= 40 && !isNav(e));
  const ch = obs.challenge || '';
  const strong = !!(checkEl || ch); // Pruefen-Knopf oder Aufgaben-Markierung der Seite
  let type = null, options = choices;
  if (audio) type = 'audio';
  else if (/match/i.test(ch) || (PAIRS_TEXT.test(obs.view) && pairBtns.length >= 4) || (tiles.length >= 4 && /paar|pairs?|zuordn|\bmatch/i.test(obs.view))) type = 'match';
  else if (choices.length >= 2) type = 'choice';
  else if (tiles.length >= 2 && (/tapcomplete|gap|fill/i.test(ch) || GAP_TEXT.test(obs.view))) type = 'gap'; // Luecke im Satz fuellen: ein Wort aus der Wortleiste waehlen
  else if (tiles.length >= 2) type = 'build';
  else if (inputs.length && strong) type = 'type'; // nur in echten Uebungen (Pruefen-Knopf oder Aufgaben-Markierung), nie in beliebige Formulare
  else if (loose.length >= 2 && checkEl) { type = 'choice'; options = loose; }
  // Auswahl ohne Pruefen-Knopf, aber der Weiter-Knopf der Seite ist schon aktiv (z. B. voreingestelltes Streak-Ziel): nichts aendern, einfach weiter
  if (type === 'choice' && !checkEl && !ch && usable.some(e => e.dt === 'player-next')) type = null;
  return { type, strong, audio, checkEl, options, tiles, inputs };
}

// ---------- Kleine, klare KI-Aufgaben ----------
// Bildschirmtext ohne Bedienelemente (Herzen, Schliessen-Kreuz, Pruefen/Ueberspringen), damit die KI nur die Aufgabe sieht
const NOISE_LINE = /^(✕|×|❤.*|\d+|pr(?:ü|ue)fen|(?:ü|ue)berspringen|check|skip|weiter|continue)$/i;
const screenText = (obs, n = 1200) => obs.view.split('\n').filter(l => !NOISE_LINE.test(l.trim())).join('\n').slice(0, n);

const LANGS = {
  spanisch: 'Spanish', englisch: 'English', 'französisch': 'French', franzoesisch: 'French', italienisch: 'Italian', portugiesisch: 'Portuguese', deutsch: 'German',
  'niederländisch': 'Dutch', schwedisch: 'Swedish', russisch: 'Russian', 'türkisch': 'Turkish', japanisch: 'Japanese', chinesisch: 'Chinese', koreanisch: 'Korean',
  polnisch: 'Polish', 'rumänisch': 'Romanian', ukrainisch: 'Ukrainian', griechisch: 'Greek', norwegisch: 'Norwegian', 'dänisch': 'Danish', arabisch: 'Arabic', latein: 'Latin',
  spanish: 'Spanish', english: 'English', french: 'French', german: 'German', italian: 'Italian', portuguese: 'Portuguese', dutch: 'Dutch', swedish: 'Swedish', russian: 'Russian', japanese: 'Japanese'
};
// In welche Sprache soll geschrieben werden? Aus "Schreibe auf Spanisch", "Write in English" usw.
function targetLang(text) {
  const m = String(text).match(/(?:auf|in|ins|into|to)\s+([a-zäöüß]+)/i);
  if (m && LANGS[m[1].toLowerCase()]) return LANGS[m[1].toLowerCase()];
  const any = String(text).match(/\b(spanisch|englisch|französisch|italienisch|portugiesisch|deutsch|spanish|english|french|german|italian|portuguese)\b/i);
  return any ? LANGS[any[1].toLowerCase()] : null;
}
// Der zu uebersetzende Satz: die laengste Zeile, die keine Anweisung oder Kachel ist
function sourceLine(obs, skip = []) {
  const skipSet = new Set(skip.map(nt));
  const lines = screenText(obs).split('\n').map(s => s.trim()).filter(l => l && !skipSet.has(nt(l)));
  const INSTR = /(schreibe|übersetze|uebersetze|translate|write|tippe|type)\b/i;
  const ix = lines.findIndex(l => INSTR.test(l) && l.split(/\s+/).length <= 7);
  if (ix >= 0 && lines[ix + 1]) return lines[ix + 1]; // direkt unter der Anweisung steht der Satz (Hinweistexte weiter unten zaehlen nicht)
  const rest = lines.filter(l => !INSTR.test(l) || l.split(/\s+/).length > 7);
  return [...rest].sort((a, b) => b.length - a.length)[0] || '';
}
// Antwort der KI auf die reine Uebersetzung kuerzen (kein Geplauder, keine Klammerbemerkung)
function cleanTranslation(raw) {
  let line = String(raw).split('\n').map(s => s.trim()).find(Boolean) || '';
  line = line.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  // Geplauder um die eigentliche Uebersetzung: ein Zitat im Satz bevorzugen, sonst den Teil nach dem letzten Doppelpunkt
  const quoted = [...line.matchAll(/[“"„«]([^“”"„«»]{2,200})[”"«»]/g)].map(m => m[1].trim()).sort((a, b) => b.length - a.length)[0];
  if (quoted && line.length > quoted.length + 12) line = quoted;
  else if (line.includes(':') && line.slice(0, line.lastIndexOf(':')).trim().split(/\s+/).length >= 3) line = line.slice(line.lastIndexOf(':') + 1).trim();
  return str(line, 240).replace(/^(answer|antwort|translation|übersetzung)\s*[:：]\s*/i, '').replace(/^["“„'`]+|["”'`]+$/g, '').trim();
}
const SHOTS_TR = [
  { role: 'user', content: 'Translate into English: Ich trinke Wasser' }, { role: 'assistant', content: 'I drink water.' },
  { role: 'user', content: 'Translate into Spanish: Wir haben ein Haus' }, { role: 'assistant', content: 'Tenemos una casa.' }
];
// Tippaufgabe: Sprache und Satz gezielt uebersetzen (mit kleinen Modellen deutlich treffsicherer als der ganze Bildschirm)
async function typedAnswer(model, ctx, obs, inputHint) {
  const lang = targetLang(`${inputHint || ''}\n${obs.view}`), src = sourceLine(obs, [inputHint || '']);
  if (lang && src) {
    const raw = await chat(model, [{ role: 'system', content: 'You are a precise translator. Reply with the translation only, as one natural sentence, no explanation.' }, ...SHOTS_TR, { role: 'user', content: `Translate into ${lang}: ${src}` }], { signal: ctx.signal, temperature: 0.1 });
    const out = cleanTranslation(raw);
    if (out) return out;
  }
  return answerKey(model, ctx, screenText(obs) + (inputHint ? `\n(Input field: ${inputHint})` : ''), null);
}
// Wortkacheln: mehrere Uebersetzungsversuche, genommen wird der, der sich genau aus den Kacheln legen laesst (und die meisten nutzt)
async function buildOrder(model, ctx, obs, texts) {
  const src = sourceLine(obs, texts) || screenText(obs, 600);
  const exact = [], approx = [];
  const SYS_TR = 'You are a precise translator for a language course. Reply with the translation only, as one natural sentence.';
  const ask = async (list, temp, hint) => {
    const raw = await chat(model, [
      { role: 'system', content: SYS_TR },
      { role: 'user', content: `Translate this sentence into the same language as the word tiles: ${src}\n${hint}: ${list.join(', ')}\nReply with the full translated sentence only.` }
    ], { signal: ctx.signal, temperature: temp });
    const line = cleanTranslation(raw);
    const o = tileOrder(line, texts);
    if (o) exact.push(o); else { const ap = approxOrder(line, texts); if (ap.length) approx.push(ap); }
  };
  for (const temp of [0.1, 0.5, 0.8]) await ask(texts, temp, 'The answer is built from these word tiles (some tiles are wrong distractors that you must not use)');
  // Bester Versuch: Wortzahl moeglichst nah am Quellsatz (Stolperkacheln wie "danke schoen" verlaengern sonst), dann haeufigster, dann laengster
  const wc = s => String(s).trim().split(/\s+/).filter(Boolean).length, srcWc = wc(src);
  const rank = () => {
    const count = new Map(); exact.forEach(o => { const k = o.join(' '); count.set(k, (count.get(k) || 0) + 1); });
    const all = exact.map(o => ({ o, ex: 1 })).concat(approx.map(o => ({ o, ex: 0 })));
    all.sort((x, y) => Math.abs(wc(x.o.join(' ')) - srcWc) - Math.abs(wc(y.o.join(' ')) - srcWc) || y.ex - x.ex || (count.get(y.o.join(' ')) || 0) - (count.get(x.o.join(' ')) || 0) || y.o.length - x.o.length);
    return all;
  };
  let all = rank();
  // Passt die Wortzahl nicht zum Quellsatz (vermutlich ist eine Stolperkachel mit drin): je eine Frage mit einer Kachel weniger nachschieben
  if (!all.length || Math.abs(wc(all[0].o.join(' ')) - srcWc) > 0) {
    const uniq = [...new Set(texts)].slice(0, 8);
    for (const u of uniq) { const left = [...texts]; left.splice(left.indexOf(u), 1); await ask(left, 0.1, 'Use only these words'); }
    all = rank();
  }
  dbg('build src=', JSON.stringify(src), 'exact=', exact.length, 'approx=', approx.length, 'pick=', JSON.stringify(all[0] && all[0].o));
  return all.length ? all[0].o : [];
}

async function answerKey(model, ctx, screen, tiles) {
  const system = 'You are the answer key of an online course. You see the text of an exercise screen. Work out the correct answer: for a translation exercise translate the sentence into the language the exercise asks for; for a question give the short answer. Reply with the answer only, no quotes, no explanation.';
  const user = `Exercise screen:\n${screen}\n\n${tiles && tiles.length ? `Use ONLY these words (each at most as often as listed): ${tiles.join(', ')}\n\n` : ''}Answer:`;
  const raw = await chat(model, [{ role: 'system', content: system }, { role: 'user', content: user }], { signal: ctx.signal, temperature: 0.1 });
  const line = String(raw).split('\n').map(s => s.trim()).find(Boolean) || '';
  return str(line, 240).replace(/^(answer|antwort|translation|übersetzung)\s*[:：]\s*/i, '').replace(/^["“„'`]+|["”'`]+$/g, '').trim();
}

async function pickOption(model, ctx, screen, options) {
  const schema = { type: 'object', properties: { reasoning: { type: 'string' }, answer: { type: 'string', enum: options } }, required: ['reasoning', 'answer'] };
  const system = 'You are the answer key of an online course or quiz. You see an exercise and its answer options. Think briefly, then choose the single correct option. The answer must be copied exactly from the options.';
  const user = `Exercise screen:\n${screen}\n\nOptions:\n${options.map(o => '- ' + o).join('\n')}`;
  const raw = await chat(model, [{ role: 'system', content: system }, { role: 'user', content: user }], { signal: ctx.signal, json: schema });
  try { const j = JSON.parse(raw); if (options.includes(j.answer)) return j.answer; } catch {}
  return options.find(o => raw.includes(o)) || options[0];
}

// Fuer unbekannte Bildschirme (Startseiten, Zwischenseiten, andere Webseiten): welches Element weiterbringt
const GEN_SYSTEM = `You operate a website for the user to complete exercises, lessons and quizzes. Each turn you get the visible screen text and the clickable elements. Reply ONLY with JSON:
{"thought":"short, in German","action":"click|wait|done","text":""}
- click: "text" is the exact label of ONE element from the list that moves things forward (a start button for the next lesson or task, an answer option, a "Continue" button).
- wait: the screen is still loading.
- done: no task is left on this site; "text" is a short German reason.
Never click anything about buying, subscribing, upgrading, trials, Super, Plus, Premium, settings, logout or deleting. If a screen offers to buy or subscribe, choose its "No thanks" / "Not now" / close option.`;
const GEN_SHOTS = [
  [`Goal: Mach die Aufgaben\nScreen text:\nLernpfad\nAbschnitt 1\nSTART\n\nElements:\n[1] clickable: START\n[2] link: Profil`,
    { thought: 'Die nächste Lektion starten.', action: 'click', text: 'START' }],
  [`Goal: Mach die Aufgaben\nScreen text:\nAlles erledigt – keine weiteren Aufgaben.\n\nElements:\n[1] link: Profil`,
    { thought: 'Es ist nichts mehr übrig.', action: 'done', text: 'Alle Aufgaben sind erledigt.' }]
];
// "text" darf nur eine vorhandene Beschriftung sein (oder "(keine)"): das kleine Modell erfindet sonst Knoepfe, die es nicht gibt
const genSchema = labels => ({
  type: 'object',
  properties: { thought: { type: 'string' }, action: { type: 'string', enum: ['click', 'wait', 'done'] }, text: { type: 'string', enum: [...labels, '(keine)'] } },
  required: ['thought', 'action', 'text']
});
const elLine = e => `[${e.id}] ${e.kind}${e.dt ? ` [${e.dt}]` : ''}${e.disabled ? ' (disabled)' : ''}: ${e.text}`;

async function decideGeneric(model, ctx, goal, obs, stats, history) {
  const prompt = `Goal: ${goal}\nPage: ${obs.title} (${obs.url})\nProgress: ${stats.answered} answered, ${stats.skipped} skipped.\n\nScreen text:\n${obs.view}\n\nElements:\n${obs.els.filter(e => !e.disabled).slice(0, 50).map(elLine).join('\n') || '(none)'}\n\nRecent actions:\n${history.slice(-4).join('\n') || '(none)'}`;
  const messages = [{ role: 'system', content: GEN_SYSTEM }];
  for (const [u, a] of GEN_SHOTS) messages.push({ role: 'user', content: u }, { role: 'assistant', content: JSON.stringify(a) });
  messages.push({ role: 'user', content: prompt });
  const labels = [...new Set(obs.els.filter(e => !e.disabled && e.text && !NOISE_CLICK.test(cl(e.text))).map(e => e.text))].slice(0, 40);
  const raw = await chat(model, messages, { json: genSchema(labels), signal: ctx.signal });
  const d = JSON.parse(raw);
  if (d.text === '(keine)') d.text = '';
  return d;
}

// ---------- Wortkacheln: in welcher Reihenfolge anklicken? ----------
// Findet eine Folge verschiedener Kacheln, die zusammengesetzt genau den Satz ergibt (Stolperkacheln bleiben liegen).
function tileOrder(sentence, texts) {
  const target = ntc(sentence);
  if (!target) return null;
  const toks = texts.map((t, i) => ({ i, t, n: ntc(t) })).filter(x => x.n);
  const used = new Array(toks.length).fill(false), seq = [], dead = new Set();
  let steps = 0;
  const go = pos => {
    if (pos === target.length) return true;
    if (++steps > 30000) return false;
    const key = pos + '|' + used.map(u => (u ? 1 : 0)).join('');
    if (dead.has(key)) return false;
    for (let k = 0; k < toks.length; k++) {
      if (used[k] || !target.startsWith(toks[k].n, pos)) continue;
      used[k] = true; seq.push(toks[k].t);
      if (go(pos + toks[k].n.length)) return true;
      used[k] = false; seq.pop();
    }
    dead.add(key);
    return false;
  };
  return go(0) ? seq : null;
}
// Passt der Satz nicht genau, wenigstens die Kacheln nach ihrer Stelle im Satz ordnen
function approxOrder(sentence, texts) {
  const target = ntc(sentence);
  const found = [];
  texts.forEach(t => { const n = ntc(t); const p = n ? target.indexOf(n) : -1; if (p >= 0) found.push({ t, p }); });
  return found.sort((a, b) => a.p - b.p).map(x => x.t);
}

// Bei Uebungen lohnt ein groesseres Modell, falls eines installiert ist
async function pickModel(preferred) {
  try {
    const list = await models();
    const big = list.filter(n => /(^|[:\-])(7b|8b|9b|14b)/i.test(n) && !/coder|embed|vision|vl|llava/i.test(n));
    return big[0] || preferred;
  } catch { return preferred; }
}

// ctx: { model, accent, signal, send, openTab, active, tabCount, saveNote } – wie bei den anderen Agenten
async function runWorker(text, ctx) {
  const { signal, accent, send } = ctx;
  const emit = p => send('work', p);
  const wctx = { ...ctx, cursorMs: 450 }; // schneller Cursor
  const t0 = Date.now();
  const stats = { answered: 0, correct: 0, wrong: 0, skipped: 0, dismissed: 0, lessons: 0 };
  const single = /(eine|1|die erste|diese|die aktuelle|nur die aktuelle)\s+(lektion|übung|uebung|aufgabe)\b/i.test(text);
  const maxLessons = single ? 1 : 1000; // sonst: bis nichts mehr uebrig ist (Stopp-Knopf und Zeitlimit sind die Sicherung)
  const MAX_MS = 3 * 60 * 60 * 1000;
  const history = [];
  let w = null;
  let siteName = '';

  const log = line => { emit({ ev: 'tick', ...stats, line }); };
  const getTab = () => (w && !w.isDestroyed() ? w : ctx.active());

  // 1. Zielseite bestimmen und oeffnen (oder die aktuelle Seite nehmen)
  const target = resolveTarget(text);
  const cur = ctx.active();
  const curUrl = cur && !cur.isDestroyed() ? cur.getURL() : '';
  const curIsPage = /^https?:/.test(curUrl);
  if (target && !(curIsPage && hostOf(curUrl).endsWith(hostOf(target.url).replace(/^(www|app|my)\./, '')))) {
    send('ai-status', `Öffne ${target.name} ...`);
    w = ctx.openTab('about:blank');
    await T.nav(w, wctx, target.url);
    siteName = target.name;
  } else if (curIsPage) {
    w = cur; siteName = (target && target.name) || hostOf(curUrl);
  } else {
    send('ai-chunk', 'Auf welcher Seite soll ich die Aufgaben bearbeiten? Öffne die Seite (oder nenne sie, z. B. „Mach die Aufgaben in Duolingo“) und sag es mir noch einmal.');
    return null;
  }

  const model = await pickModel(ctx.model);
  emit({ ev: 'start', site: siteName, model, maxLessons: single ? 1 : 0 });
  send('ai-chunk', `Aufgaben bearbeiten: ${siteName}`);
  let endReason = '', halt = '';
  let lastSig = '', same = 0, emptyScreens = 0, doneTries = 0, loginPolls = 0, lastKey = '', lastKeyCount = 0;
  let inLesson = false, heartsHits = 0, payTries = 0, attempts = 0, lastAttempt = '';
  // Nach einem Fehler zeigt die Seite die richtige Lösung; Duolingo & Co. wiederholen Fehler am Ende – dann antworte ich damit richtig
  const solutions = new Map();
  let curEx = null;
  // Schluessel einer Aufgabe = ihr ganzer Text (Reihenfolge egal, ohne Zusatzzeilen wie "Neues Wort" oder "Zuvor gemachter Fehler")
  const KEY_NOISE = /^(\d+|neues wort|zuvor gemachter fehler|new word|previously made mistake)$/i;
  const exKey = (_ex, obs) => screenText(obs, 2000).split('\n').map(nt).filter(l => l && !KEY_NOISE.test(l)).sort().join('|');

  const observe = () => { const t = getTab(); return t && !t.isDestroyed() ? t.executeJavaScript(T.WORK_OBSERVE_JS).catch(() => null) : Promise.resolve(null); };
  const primary = async re => cursor(getTab(), accent, T.findPrimaryJs(re));
  const press = async (t, label) => T.clickTarget(getTab(), wctx, t, label);
  // Haupt-Knopf der Fussleiste (je Schritt anders beschriftet), nie bei Angeboten oder Preisen
  const nextBtn = async () => { const t = await cursor(getTab(), accent, T.findNextJs()); return t && !HARD_RISKY.test(t.text) && !UPSELL_RE.test(t.text) && !PRICE_RE.test(t.text) ? t : null; };
  const clickEl = async (el, label) => {
    if (!el) return false;
    const t = await T.cursorFind(getTab(), wctx, el.id);
    if (!t) return false;
    await press(t, label);
    return true;
  };
  const pressKey = key => { const t = getTab(); if (t && !t.isDestroyed()) { t.sendInputEvent({ type: 'keyDown', keyCode: key }); t.sendInputEvent({ type: 'keyUp', keyCode: key }); } };
  // Element mit passendem Text (exakt, sonst enthaltend); bei mehreren das unterste (Wortleiste liegt unter der Antwortzeile)
  const matchEl = (els, wanted, pred = () => true) => {
    const wn = nt(wanted);
    if (!wn) return null;
    const pool = els.filter(e => !e.disabled && e.text && pred(e));
    const lowest = a => a.reduce((x, y) => (y.top > x.top ? y : x));
    const exact = pool.filter(e => nt(e.text) === wn);
    if (exact.length) return lowest(exact);
    const part = pool.filter(e => { const n = nt(e.text); return n && (n.includes(wn) || wn.includes(n)); });
    return part.length ? lowest(part) : null;
  };

  // Nach einer Antwort: Pruefen druecken, Rueckmeldung lesen (richtig/falsch zaehlen), Weiter druecken
  const advance = async (answerText, force) => {
    const tab = getTab();
    await sleep(200, signal);
    const chk = await primary(CHECK_RE);
    if (chk) {
      await press(chk, 'Prüfe ...');
      await T.settleFast(tab, wctx, 450);
      const fb = await tab.executeJavaScript(`(() => ({ bad: !!document.querySelector('[data-test*="blame-incorrect"]'), ok: !!document.querySelector('[data-test*="blame-correct"]'), text: (document.body.innerText || '').slice(0, 3500) }))()`).catch(() => ({ bad: false, ok: false, text: '' }));
      const wrong = fb.bad || (!fb.ok && WRONG_RE.test(fb.text));
      stats.answered++;
      if (wrong) {
        stats.wrong++;
        const m = fb.text.match(SOLUTION_RE);
        const sol = m ? str(m[1] || m[2], 120).replace(/\s*(zu leicht|zu schwierig|too easy|too hard|mit super)\b.*$/i, '').trim() : '';
        if (sol && curEx && curEx.key) solutions.set(curEx.key, sol);
        log(`Falsch: ${answerText}${sol ? ` (Lösung: ${str(sol, 80)})` : ''}`);
      } else { stats.correct++; log(`Richtig: ${answerText}`); }
    } else if (force) { stats.answered++; stats.correct++; log(`Erledigt: ${answerText}`); }
    // Der Weiter-Knopf gleitet mit der Rueckmeldung erst nach einem Moment ein: bis zu ~3 s warten, statt auf andere Knoepfe auszuweichen
    let cont = null;
    for (let i = 0; i < 8 && !cont; i++) {
      cont = (await nextBtn()) || (await primary(CONT_RE));
      if (!cont) await sleep(380, signal);
    }
    if (cont && !HARD_RISKY.test(cont.text)) { await press(cont, 'Weiter ...'); await T.settleFast(tab, wctx, 400); }
  };

  // ---------- Loeser fuer die einzelnen Aufgabentypen ----------
  const doAudio = async ex => {
    const label = str(ex.audio.text, 40);
    if (!await clickEl(ex.audio, label)) return false;
    stats.skipped++; log(`Audio-Aufgabe: „${label}“ gewählt`); history.push(`audio exercise: clicked "${label}"`);
    await T.settleFast(getTab(), wctx, 600);
    return true;
  };

  const solveChoice = async (ex, obs) => {
    const opts = ex.options;
    const texts = [...new Set(opts.map(o => o.text).filter(Boolean))];
    let pick, how = '';
    const known = curEx && solutions.get(curEx.key);
    const exactKnown = known && opts.find(o => nt(o.text) === nt(known)); // nur genaue Treffer, kein Teilwort ("sugar" in "Tea with sugar")
    if (exactKnown) { pick = exactKnown; how = ' (gemerkte Lösung)'; }
    else if (texts.length >= 2) pick = matchEl(opts, await pickOption(model, ctx, screenText(obs), texts)) || opts[0];
    else { pick = opts[0]; how = ' (geraten)'; } // Bilder ohne Text kann ich nicht lesen
    if (!await clickEl(pick, 'Antwort ...')) return false;
    history.push(`chose "${pick.text}"`);
    await advance(`${pick.text || 'Bild'}${how}`);
    return true;
  };

  const solveType = async (ex, obs) => {
    const input = ex.inputs[0];
    const known = curEx && solutions.get(curEx.key);
    const ans = known || await typedAnswer(model, ctx, obs, input.text);
    dbg('type', JSON.stringify(ans), known ? '(gemerkt)' : '');
    if (!ans) return false;
    const t = await T.cursorFind(getTab(), wctx, input.id);
    if (!t || !t.editable) return false;
    const r = await T.typeInto(getTab(), wctx, t, ans, false);
    if (!r.ok) { halt = r.why; return true; }
    history.push(`typed "${ans}"`);
    await advance(ans);
    return true;
  };

  // Lueckensatz: aus der Wortleiste das Wort waehlen, das in die Luecke passt
  const solveGap = async (ex, obs) => {
    const texts = [...new Set(ex.tiles.map(t => t.text))];
    const tileSet = new Set(texts.map(nt));
    const sentence = screenText(obs).split('\n').map(s => s.trim()).filter(l => l && !tileSet.has(nt(l)) && !GAP_TEXT.test(l)).join(' ');
    const known = curEx && solutions.get(curEx.key);
    // Gemerkt ist der ganze richtige Satz: gesucht ist das Wort daraus, das im sichtbaren Satz fehlt
    const sentWords = new Set(nt(sentence).split(' '));
    const fromSol = known ? texts.filter(t => nt(known).split(' ').includes(nt(t)) && !sentWords.has(nt(t))) : [];
    const pickText = (fromSol.length === 1 && fromSol[0]) || await pickOption(model, ctx, `Fill in the blank: a word is missing in this sentence. Choose the word that fits.\nSentence: ${sentence}`, texts);
    const el = matchEl(ex.tiles, pickText);
    if (!el || !await clickEl(el, `Lücke: ${str(pickText, 20)}`)) return false;
    history.push(`filled the gap with "${pickText}"`);
    await advance(pickText);
    return true;
  };

  const solveBuild = async (ex, obs) => {
    const texts = ex.tiles.map(t => t.text);
    const known = curEx && solutions.get(curEx.key);
    const order = (known && tileOrder(known, texts)) || await buildOrder(model, ctx, obs, texts);
    dbg('build =>', JSON.stringify(order), known ? '(gemerkt)' : '');
    if (!order.length) return false;
    const said = [];
    for (let i = 0; i < order.length; i++) {
      const o = i === 0 ? obs : await observe();
      if (!o) break;
      const el = matchEl(o.els, order[i], e => ['tile', 'clickable', 'button', 'choice'].includes(e.kind) && nt(e.text) === nt(order[i]));
      if (!el || !await clickEl(el, `Wort ${i + 1} von ${order.length}`)) break;
      said.push(el.text);
      await sleep(220, signal);
    }
    if (!said.length) return false;
    history.push(`built "${said.join(' ')}"`);
    await advance(said.join(' '));
    return true;
  };

  const solveMatch = async (ex, obs) => {
    const tokensOf = o => o.els.filter(e => !e.disabled && e.text && e.text.length <= 40 && ['tile', 'choice', 'clickable', 'button'].includes(e.kind) && !isNav(e));
    let o = obs, pairs = 0, fails = 0;
    const tried = new Set();
    for (let round = 0; round < 16 && o; round++) {
      const tokens = tokensOf(o);
      if (tokens.length < 2) break;
      // Zwei Spalten? (groesste Luecke zwischen den Mittelpunkten)
      const xs = [...tokens].sort((a, b) => a.cx - b.cx);
      let gap = 0, at = -1;
      for (let i = 1; i < xs.length; i++) if (xs[i].cx - xs[i - 1].cx > gap) { gap = xs[i].cx - xs[i - 1].cx; at = i; }
      let left = tokens, right = tokens;
      if (gap >= 60 && at > 0) { const cut = (xs[at].cx + xs[at - 1].cx) / 2; left = tokens.filter(t => t.cx < cut); right = tokens.filter(t => t.cx >= cut); }
      const first = left[0];
      const cands = right.filter(t => t !== first && !tried.has(first.text + '→' + t.text));
      if (!cands.length) break;
      const texts = [...new Set(cands.map(c => c.text))];
      const partner = texts.length === 1 ? texts[0] : await pickOption(model, ctx, `Match each word with its translation or matching partner.\nWord: ${first.text}`, texts);
      if (!await clickEl(first, `Paar: ${str(first.text, 24)}`)) break;
      await sleep(260, signal);
      const o2 = await observe();
      const second = o2 && matchEl(o2.els, partner, e => ['tile', 'choice', 'clickable', 'button'].includes(e.kind) && !isNav(e));
      if (!second || !await clickEl(second, `Paar: ${str(partner, 24)}`)) { fails++; if (fails >= 3) break; continue; }
      await T.settleFast(getTab(), wctx, 450);
      o = await observe();
      const left2 = o ? tokensOf(o).length : 0;
      if (left2 <= tokens.length - 2) { pairs++; log(`Paar: ${first.text} = ${partner}`); } else { fails++; tried.add(first.text + '→' + partner); if (fails >= 4) break; }
    }
    if (!pairs) return false;
    history.push(`matched ${pairs} pairs`);
    await advance(`${pairs} Paare`, true);
    return true;
  };

  try {
    for (let it = 0; it < 30000; it++) {
      if (signal.aborted) throw new Aborted();
      if (Date.now() - t0 > MAX_MS) { endReason = 'Zeitlimit von 3 Stunden erreicht.'; break; }
      const tab = getTab();
      if (!tab || tab.isDestroyed()) { endReason = 'Der Tab wurde geschlossen.'; break; }
      send('ai-status', `Aufgaben bearbeiten · ${stats.answered} erledigt`);
      await cursor(tab, accent, 'window.__shieldCursor.speed(0.45)');
      await T.hud(tab, ctx, `Aufgaben bearbeiten · ${stats.answered} erledigt`, 0, 0);

      const obs = await observe();
      if (!obs) { await T.settleFast(tab, wctx, 600); continue; }
      const view = obs.view;

      // Cookie-Abfragen: die datensparsamste Wahl treffen
      if (/cookie|consent|datenschutz/i.test(view)) await T.dismissConsent(tab, wctx);

      // Anmeldung: Passwoerter gebe ich nicht ein – ich warte, bis du angemeldet bist
      if (obs.els.some(e => e.kind === 'password-field')) {
        if (loginPolls++ === 0) { send('ai-chunk', `Bitte melde dich bei ${siteName} an – ich warte, bis du eingeloggt bist.`); log('Warte auf deine Anmeldung ...'); }
        send('ai-status', 'Warte auf deine Anmeldung ...');
        if (loginPolls > 150) { endReason = 'Keine Anmeldung erfolgt.'; break; }
        await sleep(3000, signal);
        continue;
      }
      loginPolls = 0;

      // Bleibt die Seite unveraendert, komme ich nicht weiter
      const sig = obs.url + '|' + view.slice(0, 400) + '|' + obs.els.length;
      if (sig === lastSig) same++; else { same = 0; lastSig = sig; }
      if (same >= 9) { endReason = 'Die Seite ändert sich nicht mehr – ich komme nicht weiter.'; break; }

      const ex = detect(obs);
      // Mitten in einer Lektion (Aufgaben-Markierung, Rueckmeldung, Fussleisten-Knopf) ist ein Preis im Werbebanner keine Bezahlseite
      const inLessonUi = !!(obs.challenge || obs.blame || obs.els.some(e => e.dt === 'player-next'));
      const pay = PRICE_RE.test(view) && !inLessonUi;
      const exercise = !!ex.type && (ex.strong || !pay);
      dbg(`it=${it} type=${exercise ? ex.type : '-'} ch=${obs.challenge || '-'} els=${obs.els.length} same=${same} view=${JSON.stringify(view.slice(0, 70))}`);

      // Lektionsende zaehlen (einmal je Lektion)
      if (exercise) inLesson = true;
      else if (inLesson && (obs.complete || LESSON_DONE_RE.test(view))) {
        inLesson = false; stats.lessons++; log(`Lektion abgeschlossen (${stats.lessons})`);
        if (stats.lessons >= maxLessons) {
          const c = await primary(CONT_RE); if (c) await press(c, 'Weiter ...');
          endReason = stats.lessons === 1 ? 'Die Lektion ist abgeschlossen.' : `${stats.lessons} Lektionen abgeschlossen.`;
          break;
        }
      }

      if (exercise) {
        emptyScreens = 0; doneTries = 0; payTries = 0;
        // Klappt dieselbe Aufgabe mehrmals nicht, ueberspringen (falls moeglich), sonst aufgeben
        const akey = sig + '|' + ex.type;
        attempts = akey === lastAttempt ? attempts + 1 : 1; lastAttempt = akey;
        if (attempts > 3) {
          const sk = await primary(SKIP_ANY);
          if (sk) { await press(sk, 'Überspringe ...'); stats.skipped++; log('Aufgabe nicht lösbar – übersprungen'); attempts = 0; await T.settleFast(tab, wctx, 500); continue; }
          endReason = 'Ich komme bei einer Aufgabe nicht weiter.'; break;
        }
        let ok = false;
        curEx = ex.type === 'audio' || ex.type === 'match' ? null : { type: ex.type, key: exKey(ex, obs) };
        try {
          if (ex.type === 'audio') ok = await doAudio(ex);
          else if (ex.type === 'choice') ok = await solveChoice(ex, obs);
          else if (ex.type === 'build') ok = await solveBuild(ex, obs);
          else if (ex.type === 'gap') ok = await solveGap(ex, obs);
          else if (ex.type === 'match') ok = await solveMatch(ex, obs);
          else if (ex.type === 'type') ok = await solveType(ex, obs);
        } catch (e) { if (e instanceof Aborted || signal.aborted) throw new Aborted(); dbg('solver error', String(e && e.message).slice(0, 160)); }
        if (halt) { endReason = halt; break; }
        if (ok) continue;
        history.push(`could not solve ${ex.type}`);
        await T.settleFast(tab, wctx, 700);
        continue;
      }

      // ---- Keine Aufgabe sichtbar: Zwischenseiten, Angebote, Lektionsauswahl ----
      if (HEARTS_RE.test(view) && ++heartsHits >= 3) { endReason = 'Die Herzen sind aufgebraucht – hier ist gerade nichts mehr zu tun.'; break; }

      // In der Lektion (nach der Antwort, Rueckmeldung, Zwischenfolien): immer zuerst der Weiter-Knopf der Fussleiste
      if (inLessonUi) {
        const nb = (await nextBtn()) || (await primary(CONT_RE));
        if (nb && !HARD_RISKY.test(nb.text)) { await press(nb, 'Weiter ...'); await T.settleFast(tab, wctx, 400); emptyScreens = 0; continue; }
      }

      // Angebote und Hinweise ablehnen (nie darauf eingehen)
      const dis = await primary(DISMISS_STRICT);
      if (dis && !HARD_RISKY.test(dis.text)) { await press(dis, 'Lehne ab'); stats.dismissed++; log('Angebot abgelehnt'); history.push('declined an offer'); emptyScreens = 0; await T.settleFast(tab, wctx, 450); continue; }

      // Naechste Lektion starten (Knopf oder die "START"-Blase auf dem Lernpfad)
      const startBtn = (await primary(START_RE)) || (() => { const e = obs.els.find(x => !x.disabled && rx(START_RE).test(cl(x.text))); return e ? { el: e } : null; })();
      if (startBtn && !(startBtn.text && HARD_RISKY.test(startBtn.text))) {
        if (stats.lessons >= maxLessons) { endReason = `${stats.lessons} Lektionen abgeschlossen.`; break; }
        if (startBtn.el) await clickEl(startBtn.el, 'Starte ...'); else await press(startBtn, 'Starte ...');
        await T.settleFast(tab, wctx, 800); log('Nächste Lektion gestartet'); emptyScreens = 0; payTries = 0; continue;
      }

      // Rueckmeldungen, Zwischenseiten, Lektionsende: weiter (nicht auf Seiten mit Preisen)
      const cont = pay ? null : ((await primary(CONT_RE)) || (await nextBtn()));
      if (cont && !HARD_RISKY.test(cont.text)) { await press(cont, 'Weiter ...'); await T.settleFast(tab, wctx, 400); emptyScreens = 0; continue; }

      if (NO_TASKS_RE.test(view)) { endReason = 'Keine weiteren Aufgaben auf der Seite.'; break; }

      // Bezahl- oder Abo-Seite ohne Ablehnen-Knopf: schliessen versuchen, sonst aufhoeren
      if (pay || UPSELL_RE.test(view)) {
        const lo = await primary(DISMISS_LOOSE);
        if (lo && !HARD_RISKY.test(lo.text)) { await press(lo, 'Schließe Angebot'); stats.dismissed++; log('Angebot geschlossen'); await T.settleFast(tab, wctx, 450); continue; }
        if (pay) {
          if (payTries++ < 2) { pressKey('Escape'); await T.settleFast(tab, wctx, 600); continue; }
          endReason = 'Die Seite zeigt ein Bezahl- oder Abo-Angebot, das ich nicht wegklicken kann. Dafür brauche ich dich.'; break;
        }
      }

      // Hier muss die KI entscheiden (oder erkennen, dass nichts mehr da ist)
      if (++emptyScreens < 3) { await T.settleFast(tab, wctx, 900); continue; }
      let d;
      try { d = await decideGeneric(model, ctx, text, obs, stats, history); }
      catch (e) { if (signal.aborted) throw new Aborted(); history.push('(no valid decision)'); await sleep(800, signal); continue; }
      dbg('generic', JSON.stringify(d));
      const key = `${sig}|${d.action}|${(d.text || '').slice(0, 30)}`;
      if (key === lastKey) lastKeyCount++; else { lastKey = key; lastKeyCount = 0; }
      if (lastKeyCount >= 3) { endReason = 'Ich wiederhole dieselbe Aktion ohne Erfolg und höre deshalb auf.'; break; }

      if (d.action === 'done') {
        // Die Seite kann noch laden: ein paar Mal nachsehen, bevor ich aufgebe
        if (doneTries++ < 2) { await T.settleFast(tab, wctx, 1800); continue; }
        endReason = str(d.thought, 200) || 'Keine weiteren Aufgaben gefunden.';
        break;
      }
      doneTries = 0;
      if (d.action === 'wait') { await T.settleFast(tab, wctx, 1500); continue; }
      const el = matchEl(obs.els, str(d.text, 80));
      if (!el) { history.push(`no element "${d.text}"`); continue; }
      if (HARD_RISKY.test(el.text) || NOISE_CLICK.test(cl(el.text))) { history.push(`refused to click "${el.text}"`); log(`„${el.text}“ lasse ich aus`); continue; }
      await clickEl(el, str(el.text, 30) || 'Klicke ...');
      history.push(`clicked "${el.text}"`);
      log(`Klick: ${str(el.text, 40)}`);
      await T.settleFast(tab, wctx, 500);
    }
    if (!endReason) endReason = 'Zu viele Schritte – ich höre vorsichtshalber auf.';
  } catch (e) {
    if (e instanceof Aborted || signal.aborted) endReason = 'Von dir gestoppt.'; else throw e;
  } finally {
    await T.hideCursor(getTab(), ctx);
  }

  const mins = Math.max(1, Math.round((Date.now() - t0) / 60000));
  const report = [
    `Aufgaben auf ${siteName}`,
    `${stats.answered} Aufgaben bearbeitet (${stats.correct} richtig, ${stats.wrong} falsch), ${stats.skipped} übersprungen (Audio: „Kann gerade nicht sprechen/hören“), ${stats.dismissed} Angebote abgelehnt, ${stats.lessons} Lektion${stats.lessons === 1 ? '' : 'en'} abgeschlossen.`,
    `Dauer: ${mins} Min. · Modell: ${model}`,
    `Ende: ${endReason}`
  ].join('\n');
  if (ctx.saveNote) ctx.saveNote({ title: `Aufgaben: ${siteName}`, url: '', text: report });
  emit({ ev: 'final', report, ...stats, reason: endReason });
  send('ai-chunk', report);
  return report;
}

module.exports = { isTaskRequest, resolveTarget, runWorker };
