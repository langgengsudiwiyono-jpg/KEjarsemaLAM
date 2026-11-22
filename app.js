/* Inkboard – whiteboard controller.
   Go live: set useMock:false and apiBase to your Worker URL (no API keys belong in this file). */
const CFG = { useMock: true, apiBase: '' /* e.g. 'https://inkboard-proxy.YOURNAME.workers.dev' */, voiceId: '' };
const API = p => (CFG.apiBase || '') + p;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const INK = { ink: '#1F2A44', blue: '#2F6DB5', red: '#C0392B', green: '#2E7D5B' };
const TONE = { butter: '#FFE9A8', sage: '#CFE3D0', peach: '#F7D3C0', none: 'transparent' };
const MODES = { topic: 'Topic', exam: 'Exam prep', homework: 'Homework' };
const S = { steps: [], i: -1, els: [], playing: false, mode: 'topic', cam: { x: 40, y: 30, z: .8 }, follow: true,
  file: null, audio: null, token: 0, dpr: 1, customVoice: false, started: false,
  cx: 0, cy: 0, colW: 0, b: null, id: null, title: '', topic: '', created: 0 };

/* ---------- Mock lesson (offline demo) ---------- */
const DEMO = { title: 'Photosynthesis', steps: [
  { id: 's1', audioText: "Let’s start with the big picture: photosynthesis is how plants turn light into food.", duration: 6, visualActions: [
    { id: 't1', type: 'text', x: 0, y: 40, size: 46, text: 'Photosynthesis', color: 'ink' },
    { id: 'h1', type: 'highlight', target: 't1' },
    { id: 'b1', type: 'box', x: 0, y: 70, w: 440, h: 100, tone: 'sage' },
    { id: 't2', type: 'text', x: 18, y: 112, size: 32, text: 'light + water + CO₂\n→ sugar + oxygen', color: 'green' } ] },
  { id: 's2', audioText: "It happens in the chloroplasts, where chlorophyll captures sunlight. That energy splits water and builds sugar.", duration: 8, visualActions: [
    { id: 'b2', type: 'box', x: 0, y: 0, w: 170, h: 60, tone: 'butter' },
    { id: 't3', type: 'text', x: 16, y: 40, size: 30, text: 'Sunlight', color: 'ink' },
    { id: 'a1', type: 'arrow', x: 176, y: 30, x2: 236, y2: 30 },
    { id: 'b3', type: 'box', x: 242, y: 0, w: 198, h: 60, tone: 'peach' },
    { id: 't4', type: 'text', x: 258, y: 40, size: 30, text: 'Chloroplast', color: 'red' } ] },
  { id: 's3', audioText: "Remember it as light in, sugar and oxygen out. Ask me anything and I’ll redraw it.", duration: 6, visualActions: [
    { id: 't5', type: 'text', x: 0, y: 30, size: 34, text: 'Light in → sugar + O₂ out', color: 'blue' },
    { id: 'h2', type: 'highlight', target: 't5' } ] } ] };
const mockAnswer = q => ({ steps: [{ id: 'q' + Date.now(), duration: 6,
  audioText: `Good question. You asked: ${q}. Here is the short version, drawn on the board.`,
  visualActions: [{ id: 'qa' + Date.now(), type: 'text', x: 0, y: 30, size: 32, color: 'red', text: 'Your question:\n' + q.slice(0, 40) }] }] });

/* ---------- Canvas engine ---------- */
const cv = $('#board'), g = cv.getContext('2d');
function resize() {
  const box = cv.parentElement, d = S.dpr = Math.max(1, devicePixelRatio || 1), w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return; cv.width = Math.round(w * d); cv.height = Math.round(h * d);
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(cv.parentElement);
const prog = e => Math.max(0, Math.min(1, (performance.now() - e.start) / e.dur));
const ease = p => 1 - Math.pow(1 - p, 3);

/* Compact layout: each step is packed to its own bounding box, then flowed top-to-bottom in
   columns (COL_H tall); the camera fits the whole board into the viewport. */
const COL_H = 440, GAP = 24, COL_GAP = 56;
function bbox(a) {
  if (a.type === 'text') { const s = a.size || 32, L = a.text.split('\n'); g.font = `700 ${s}px Caveat`;
    return [a.x, a.y - s * .8, a.x + Math.max(...L.map(l => g.measureText(l).width)), a.y - s * .8 + L.length * s * 1.15]; }
  if (a.type === 'box') return [a.x, a.y, a.x + a.w, a.y + a.h];
  if (a.type === 'arrow') return [Math.min(a.x, a.x2), Math.min(a.y, a.y2), Math.max(a.x, a.x2), Math.max(a.y, a.y2)];
  if (a.type === 'curve' && a.points?.length) { const X = a.points.map(p => p[0]), Y = a.points.map(p => p[1]);
    return [Math.min(...X), Math.min(...Y), Math.max(...X), Math.max(...Y)]; }
}
function addActions(actions) {
  const bs = actions.map(bbox).filter(Boolean); if (!bs.length) return;
  const x1 = Math.min(...bs.map(b => b[0])), y1 = Math.min(...bs.map(b => b[1]));
  const w = Math.max(...bs.map(b => b[2])) - x1, h = Math.max(...bs.map(b => b[3])) - y1;
  if (S.cy > 0 && S.cy + h > COL_H) { S.cx += S.colW + COL_GAP; S.cy = 0; S.colW = 0; }
  const dx = S.cx - x1, dy = S.cy - y1, top = S.cy, sx = v => v == null ? v : v + dx, sy = v => v == null ? v : v + dy;
  let t = performance.now();
  for (const a of actions) {
    const e = { ...a, x: sx(a.x), y: sy(a.y), x2: sx(a.x2), y2: sy(a.y2) };
    if (a.points) e.points = a.points.map(([px, py]) => [px + dx, py + dy]);
    e.dur = e.type === 'text' ? Math.max(500, e.text.length * 40) : 650;
    e.start = t; t += e.dur * .7; S.els.push(e);
  }
  S.cy += h + GAP; S.colW = Math.max(S.colW, w);
  const nb = [S.cx, top, S.cx + w, top + h];
  S.b = S.b ? [Math.min(S.b[0], nb[0]), Math.min(S.b[1], nb[1]), Math.max(S.b[2], nb[2]), Math.max(S.b[3], nb[3])] : nb;
}
function clearBoard() { S.els = []; S.cx = S.cy = S.colW = 0; S.b = null; }

function paint(e) {
  const p = ease(prog(e)); if (p <= 0) return;
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = g.fillStyle = INK.ink;
  if (e.type === 'text') {
    g.font = `700 ${e.size || 32}px Caveat`; g.fillStyle = INK[e.color] || INK.ink;
    let n = Math.floor(e.text.length * p);
    e.text.split('\n').forEach((l, k) => { g.fillText(l.slice(0, Math.max(0, n)), e.x, e.y + k * (e.size || 32) * 1.15); n -= l.length + 1; });
  } else if (e.type === 'highlight') {
    const t = S.els.find(x => x.id === e.target); if (!t) return;
    const s = t.size || 32; g.font = `700 ${s}px Caveat`;
    const w = Math.max(...t.text.split('\n').map(l => g.measureText(l).width));
    g.fillStyle = 'rgba(255,214,90,.65)'; g.fillRect(t.x - 6, t.y - s * .8, (w + 12) * p, s * 1.15 * t.text.split('\n').length);
  } else if (e.type === 'box') {
    g.beginPath(); g.roundRect(e.x, e.y, e.w, e.h, 16);
    g.globalAlpha = p; g.fillStyle = TONE[e.tone || 'butter']; g.fill(); g.globalAlpha = 1;
    const per = 2 * (e.w + e.h); g.setLineDash([per * p, per]); g.stroke(); g.setLineDash([]);
  } else if (e.type === 'arrow') {
    const x = e.x + (e.x2 - e.x) * p, y = e.y + (e.y2 - e.y) * p;
    g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(x, y); g.stroke();
    if (p > .9) { const a = Math.atan2(e.y2 - e.y, e.x2 - e.x); g.beginPath();
      g.moveTo(e.x2, e.y2); g.lineTo(e.x2 - 14 * Math.cos(a - .5), e.y2 - 14 * Math.sin(a - .5));
      g.moveTo(e.x2, e.y2); g.lineTo(e.x2 - 14 * Math.cos(a + .5), e.y2 - 14 * Math.sin(a + .5)); g.stroke(); }
  } else if (e.type === 'curve' && e.points?.length > 1) {
    g.strokeStyle = INK[e.color] || INK.blue; g.beginPath(); g.moveTo(...e.points[0]);
    e.points.slice(1, 1 + Math.ceil((e.points.length - 1) * p)).forEach(pt => g.lineTo(...pt)); g.stroke();
  }
}
function frame() {
  requestAnimationFrame(frame);
  const d = S.dpr, c = S.cam, w = cv.width / d, h = cv.height / d; if (!w || !h) return;
  if (S.follow && S.b) {                       // fit whole board in view
    const bw = S.b[2] - S.b[0], bh = S.b[3] - S.b[1], pad = 36;
    const tz = Math.max(.3, Math.min(1.15, (w - 2 * pad) / bw, (h - 2 * pad) / bh));
    c.z += (tz - c.z) * .08;
    c.x += ((w - bw * c.z) / 2 - S.b[0] * c.z - c.x) * .08; c.y += ((h - bh * c.z) / 2 - S.b[1] * c.z - c.y) * .08;
  }
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); // clear in raw pixels first
  g.setTransform(d, 0, 0, d, 0, 0);
  const gs = 36 * c.z; g.fillStyle = 'rgba(31,42,68,.1)';
  if (gs > 14) for (let x = ((c.x % gs) + gs) % gs; x < w; x += gs) for (let y = ((c.y % gs) + gs) % gs; y < h; y += gs) g.fillRect(x, y, 2, 2);
  g.setTransform(d * c.z, 0, 0, d * c.z, d * c.x, d * c.y);
  for (const t of ['highlight', 'box', 'curve', 'text', 'arrow']) S.els.forEach(e => e.type === t && paint(e));
  $('#zVal').textContent = Math.round(c.z * 100) + '%';
}
function zoom(f, cx = cv.clientWidth / 2, cy = cv.clientHeight / 2) {
  const c = S.cam, z = Math.min(2.5, Math.max(.25, c.z * f)), k = z / c.z;
  c.x = cx - (cx - c.x) * k; c.y = cy - (cy - c.y) * k; c.z = z;
}
function setFollow(v) { S.follow = v; $('#btnFollow').setAttribute('aria-pressed', v); }
let drag = null;
cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
cv.addEventListener('pointermove', e => { if (!drag) return; setFollow(false); S.cam.x += e.clientX - drag.x; S.cam.y += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; });
cv.addEventListener('pointerup', () => { drag = null; cv.style.cursor = 'grab'; });
cv.addEventListener('wheel', e => { e.preventDefault(); setFollow(false); const r = cv.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : .9, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
$('#zIn').onclick = () => { setFollow(false); zoom(1.2); }; $('#zOut').onclick = () => { setFollow(false); zoom(1 / 1.2); };
$('#btnFollow').onclick = () => setFollow(!S.follow);

/* ---------- Audio / sync ---------- */
const say = text => { $('#bubble').textContent = text; };
function stopAudio() { speechSynthesis.cancel(); if (S.audio) { S.audio.pause(); S.audio = null; } $('#avatar').classList.remove('speaking'); }
async function speak(step, tk) {
  $('#avatar').classList.add('speaking');
  const lang = $('#lang').value, done = () => $('#avatar').classList.remove('speaking');
  if (S.customVoice && !CFG.useMock) {
    try {
      const r = await fetch(API('/api/tts'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: step.audioText, voice_id: CFG.voiceId || undefined, lang }) });
      if (!r.ok) throw new Error(r.status);
      const a = S.audio = new Audio(URL.createObjectURL(await r.blob()));
      if (tk !== S.token) return;
      return new Promise(res => { a.onended = () => { done(); res(); }; a.onerror = () => { done(); res(); }; a.play(); });
    } catch (e) { console.warn('TTS failed, using browser voice', e); }
  }
  if (!('speechSynthesis' in window)) { await new Promise(r => setTimeout(r, step.duration * 1000)); return done(); }
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(step.audioText); u.lang = lang; u.rate = .98;
    u.onend = u.onerror = () => { done(); res(); }; speechSynthesis.speak(u);
  });
}
async function run(i) {
  const tk = ++S.token, st = S.steps[i]; if (!st) return;
  S.i = i; S.playing = true; setPlayIcon(); stopAudio();
  if (!st.shown) { st.shown = true; addActions(st.visualActions || []); }
  say(st.audioText); $('#stepInfo').textContent = `Step ${i + 1} of ${S.steps.length}`;
  await speak(st, tk);
  if (tk !== S.token || !S.playing) return;
  if (i + 1 < S.steps.length) run(i + 1); else { S.playing = false; setPlayIcon(); }
}
function setPlayIcon() { $('#btnPlay').innerHTML = `<i data-lucide="${S.playing ? 'pause' : 'play'}"></i>`; lucide.createIcons(); }
function pause() { S.playing = false; S.token++; stopAudio(); setPlayIcon(); }
$('#btnPlay').onclick = () => S.playing ? pause() : S.i >= 0 && run(S.i);
$('#btnNext').onclick = () => S.i + 1 < S.steps.length && run(S.i + 1);
$('#btnPrev').onclick = () => S.i > 0 && run(S.i - 1);
$('#btnVoice').onclick = e => { S.customVoice = !S.customVoice; e.currentTarget.setAttribute('aria-pressed', S.customVoice);
  if (S.customVoice && CFG.useMock) say('Custom voice needs your Worker’s /api/tts. Set useMock:false in app.js.'); };

/* ---------- Boards history (localStorage) ---------- */
const LS = 'inkboard.boards.v1';
const boards = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };
function saveBoard() {
  if (!S.id) return;
  const rec = { id: S.id, title: S.title, mode: S.mode, topic: S.topic, created: S.created, steps: S.steps.map(({ shown, ...r }) => r) };
  const list = [rec, ...boards().filter(b => b.id !== S.id)].slice(0, 20);
  try { localStorage.setItem(LS, JSON.stringify(list)); } catch (e) { console.warn('Could not save board', e); }
  renderBoards();
}
const card = (b, del) => `<div class="chip rounded-2xl p-3 text-left shrink-0 min-w-[10rem] max-w-[15rem] cursor-pointer" data-open="${b.id}" tabindex="0" role="button">
  <div class="font-semibold truncate">${esc(b.title)}</div>
  <div class="text-xs opacity-60">${MODES[b.mode] || 'Topic'}, ${new Date(b.created).toLocaleDateString()}</div>
  ${del ? `<button class="text-xs font-semibold underline mt-2" data-del="${b.id}">Delete</button>` : ''}</div>`;
function renderBoards() {
  const list = boards();
  $('#recent').innerHTML = list.slice(0, 8).map(b => card(b)).join('') || '<span class="text-sm opacity-60">Boards you create show up here.</span>';
  $('#spacesGrid').innerHTML = list.map(b => card(b, true)).join('') || '<p class="opacity-60">No boards yet. Start a lesson and it will be saved here.</p>';
}
function openBoard(id) {
  const b = boards().find(x => x.id === id); if (!b) return;
  pause(); clearBoard(); Object.assign(S, { id: b.id, title: b.title, mode: b.mode, topic: b.topic, created: b.created,
    steps: b.steps.map(s => ({ ...s })), started: true, i: -1 });
  setFollow(true); setMode(b.mode); $('#btnSend').textContent = 'Ask'; tab('lesson'); run(0);
}
document.addEventListener('click', e => {
  const del = e.target.closest('[data-del]'), op = e.target.closest('[data-open]');
  if (del) { e.stopPropagation(); try { localStorage.setItem(LS, JSON.stringify(boards().filter(b => b.id !== del.dataset.del))); } catch {} renderBoards(); }
  else if (op) openBoard(op.dataset.open);
});

/* ---------- Tabs & Explore ---------- */
function tab(name) {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
  ['lesson', 'spaces', 'explore'].forEach(n => $('#v-' + n).classList.toggle('hidden', n !== name));
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
$('#allHistory').onclick = () => tab('spaces');
const TOPICS = [['Photosynthesis', 'How plants turn light into sugar'], ['Quadratic equations', 'Factoring, formula, graph'],
  ['Unsur intrinsik cerpen', 'Tema, alur, latar, tokoh'], ['Newton’s laws of motion', 'Force, mass and acceleration'],
  ['Proklamasi Kemerdekaan', 'Events leading to 17 August 1945'], ['Fractions and decimals', 'Convert and compare']];
$('#exploreGrid').innerHTML = TOPICS.map(([t, d]) => `<button class="chip rounded-2xl p-4 text-left" data-topic="${esc(t)}"><div class="font-extrabold">${esc(t)}</div><div class="text-sm opacity-70">${esc(d)}</div></button>`).join('');
$('#exploreGrid').onclick = e => { const b = e.target.closest('[data-topic]'); if (b) { tab('lesson'); setMode('topic'); startLesson(b.dataset.topic); } };

/* ---------- AI calls ---------- */
async function callAI(payload) {
  if (CFG.useMock) { await new Promise(r => setTimeout(r, 400)); return payload.question ? mockAnswer(payload.question) : DEMO; }
  const r = await fetch(API('/api/lesson'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch {} throw new Error(m || r.status); }
  const out = await r.json(); if (!Array.isArray(out.steps) || !out.steps.length) throw new Error('empty lesson'); return out;
}
async function startLesson(topic) {
  pause(); S.steps = []; clearBoard(); S.started = true; setFollow(true); S.i = -1;
  Object.assign(S, { id: Date.now().toString(36), created: Date.now(), topic, title: topic });
  say(S.file ? 'Reading your material and preparing the lesson…' : 'Preparing your lesson…');
  try {
    const out = await callAI({ mode: S.mode, lang: $('#lang').value, topic, file: S.file });
    S.steps = out.steps; S.title = out.title || topic; $('#btnSend').textContent = 'Ask'; saveBoard(); run(0);
  } catch (e) { say(`Couldn’t create the lesson (${e.message}). Check your Worker URL and keys, then try again.`); S.started = false; }
}
async function ask(q) {
  pause(); say('Thinking about your question…');
  const a = S.steps[S.i], f = S.file && { name: S.file.name, kind: 'text', text: (S.file.text || '').slice(0, 8000) };
  try {
    const out = await callAI({ mode: S.mode, lang: $('#lang').value, question: q, file: f, activeStep: a && { id: a.id, audioText: a.audioText },
      board: S.els.map(({ id, type, text }) => ({ id, type, text })) });
    S.steps.splice(S.i + 1, 0, ...out.steps); saveBoard(); run(S.i + 1);
  } catch (e) { say(`Couldn’t answer that (${e.message}). Try asking again.`); }
}

/* ---------- Files: PDF.js / FileReader → base64 or text ---------- */
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
async function shrinkImage(f) {
  const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { mime: 'image/jpeg', base64: c.toDataURL('image/jpeg', .85).split(',')[1] };
}
async function readFile(f) {
  if (f.size > 20e6) throw new Error('File is larger than 20 MB');
  if (f.type === 'application/pdf') {
    const buf = await f.arrayBuffer(), out = { name: f.name, kind: 'pdf', mime: f.type };
    try {
      const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise; let t = '';
      for (let p = 1; p <= Math.min(pdf.numPages, 30) && t.length < 60000; p++)
        t += `\n[Page ${p}]\n` + (await (await pdf.getPage(p)).getTextContent()).items.map(i => i.str).join(' ');
      out.text = t.slice(0, 60000);
    } catch (e) { console.warn('PDF.js failed', e); }
    if (f.size < 8e6) out.base64 = b64(buf);          // native PDF input for Gemini / Claude
    if (!out.text && !out.base64) throw new Error('Could not read this PDF');
    return out;
  }
  if (f.type.startsWith('image/')) return { name: f.name, kind: 'image', ...(await shrinkImage(f)) };
  return { name: f.name, kind: 'text', mime: 'text/plain', text: (await f.text()).slice(0, 60000) };
}
function showFile() {
  const el = $('#fileName'); el.classList.toggle('hidden', !S.file); if (!S.file) return;
  el.innerHTML = `Attached: ${esc(S.file.name)} <button id="fileClear" class="underline font-semibold ml-1">Remove</button>`;
  $('#fileClear').onclick = () => { S.file = null; $('#file').value = ''; showFile(); };
}
$('#btnFile').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; say(`Reading ${f.name}…`);
  try { S.file = await readFile(f); say(`Got ${f.name}. Type what you want to learn from it, or just press Start.`); }
  catch (err) { S.file = null; say(`Couldn’t read that file: ${err.message}`); }
  showFile();
};

/* ---------- Dock ---------- */
function submit() {
  const v = $('#input').value.trim(); if (!v && !S.file) return; $('#input').value = '';
  S.started ? ask(v || 'Please explain this part again.') : startLesson(v || S.file.name);
}
function setMode(m) { S.mode = m; document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === m)); }
$('#btnSend').onclick = submit;
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null;
$('#btnMic').onclick = e => {
  if (!SR) return say('Voice input isn’t supported in this browser. Type your question instead.');
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = $('#lang').value; rec.interimResults = false;
  e.currentTarget.setAttribute('aria-pressed', true); pause();
  rec.onresult = ev => { $('#input').value = ev.results[0][0].transcript; submit(); };
  rec.onend = () => { rec = null; $('#btnMic').setAttribute('aria-pressed', false); };
  rec.start();
};

/* ---------- Boot ---------- */
resize(); renderBoards(); lucide.createIcons();
document.fonts.load('700 32px Caveat').then(() => requestAnimationFrame(frame));
