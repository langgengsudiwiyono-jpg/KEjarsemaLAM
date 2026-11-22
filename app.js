/* Inkboard – whiteboard controller. Set useMock:false and point endpoints at your proxy (never put API keys in this file). */
const CFG = { lessonEndpoint: '/api/lesson', ttsEndpoint: '/api/tts', voiceId: 'YOUR_VOICE_ID', useMock: true };
const $ = s => document.querySelector(s);
const INK = { ink: '#1F2A44', blue: '#2F6DB5', red: '#C0392B', green: '#2E7D5B' };
const TONE = { butter: '#FFE9A8', sage: '#CFE3D0', peach: '#F7D3C0', none: 'transparent' };
const S = { steps: [], i: -1, els: [], playing: false, mode: 'topic', cam: { x: 40, y: 30, z: .8 }, follow: true,
  file: null, audio: null, token: 0, oy: 0, customVoice: false, started: false };

/* ---------- Mock lesson (offline demo) ---------- */
const DEMO = { steps: [
  { id: 's1', audioText: "Let’s start with the big picture: photosynthesis is how plants turn light into food.", duration: 6, visualActions: [
    { id: 't1', type: 'text', x: 0, y: 40, size: 48, text: 'Photosynthesis', color: 'ink' },
    { id: 'h1', type: 'highlight', target: 't1' },
    { id: 'b1', type: 'box', x: 0, y: 110, w: 520, h: 120, tone: 'sage' },
    { id: 't2', type: 'text', x: 24, y: 160, size: 34, text: 'light + water + CO₂\n→ sugar + oxygen', color: 'green' } ] },
  { id: 's2', audioText: "It happens in the chloroplasts, where chlorophyll captures sunlight. That energy splits water and builds sugar.", duration: 8, visualActions: [
    { id: 'b2', type: 'box', x: 0, y: 270, w: 240, h: 90, tone: 'butter' },
    { id: 't3', type: 'text', x: 20, y: 322, size: 32, text: 'Sunlight', color: 'ink' },
    { id: 'a1', type: 'arrow', x: 250, y: 315, x2: 360, y2: 315 },
    { id: 'b3', type: 'box', x: 370, y: 270, w: 260, h: 90, tone: 'peach' },
    { id: 't4', type: 'text', x: 390, y: 322, size: 32, text: 'Chloroplast', color: 'red' } ] },
  { id: 's3', audioText: "Remember it as light in, sugar and oxygen out. Ask me anything and I’ll redraw it.", duration: 6, visualActions: [
    { id: 't5', type: 'text', x: 0, y: 410, size: 36, text: 'Light in → sugar + O₂ out', color: 'blue' },
    { id: 'h2', type: 'highlight', target: 't5' } ] } ] };
const mockAnswer = q => ({ steps: [{ id: 'q' + Date.now(), duration: 6,
  audioText: `Good question. You asked: ${q}. Here is the short version, drawn on the board.`,
  visualActions: [{ id: 'qa' + Date.now(), type: 'text', x: 0, y: 40, size: 34, color: 'red', text: 'Your question:\n' + q.slice(0, 40) }] }] });

/* ---------- Canvas engine ---------- */
const cv = $('#board'), g = cv.getContext('2d');
function resize() { const d = devicePixelRatio || 1, r = cv.getBoundingClientRect(); cv.width = r.width * d; cv.height = r.height * d; }
addEventListener('resize', resize);
const prog = e => Math.max(0, Math.min(1, (performance.now() - e.start) / e.dur));
const ease = p => 1 - Math.pow(1 - p, 3);

function addActions(actions) {
  let t = performance.now();
  for (const a of actions) {
    const e = { ...a, y: (a.y ?? 0) + S.oy, y2: a.y2 != null ? a.y2 + S.oy : undefined };
    if (e.points) e.points = e.points.map(([x, y]) => [x, y + S.oy]);
    e.dur = e.type === 'text' ? Math.max(500, e.text.length * 45) : 700;
    e.start = t; t += e.dur * .75; S.els.push(e);
  }
  S.oy = Math.max(S.oy, ...S.els.map(e => Math.max(e.y, e.y2 || 0) + (e.h || 0) + (e.size || 0))) + 40;
}
function paint(e) {
  const p = ease(prog(e)); if (p <= 0) return;
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = g.fillStyle = INK.ink;
  if (e.type === 'text') {
    g.font = `700 ${e.size || 32}px Caveat`; g.fillStyle = INK[e.color] || INK.ink;
    let n = Math.floor(e.text.length * p);
    e.text.split('\n').forEach((l, k) => { g.fillText(l.slice(0, Math.max(0, n)), e.x, e.y + k * (e.size || 32) * 1.15); n -= l.length + 1; });
  } else if (e.type === 'highlight') {
    const t = S.els.find(x => x.id === e.target); if (!t) return;
    g.font = `700 ${t.size || 32}px Caveat`;
    const w = Math.max(...t.text.split('\n').map(l => g.measureText(l).width)), s = t.size || 32;
    g.fillStyle = 'rgba(255,214,90,.65)'; g.fillRect(t.x - 6, t.y - s * .8, (w + 12) * p, s * 1.1 * t.text.split('\n').length);
  } else if (e.type === 'box') {
    g.beginPath(); g.roundRect(e.x, e.y, e.w, e.h, 18);
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
  const d = devicePixelRatio || 1, c = S.cam, w = cv.width / d, h = cv.height / d;
  if (S.follow && S.els.length) { c.x += (40 - c.x) * .06; c.y += ((h * .08 - S.stepY * c.z) - c.y) * .06; }
  g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  const gs = 36 * c.z; g.fillStyle = 'rgba(31,42,68,.1)';
  for (let x = ((c.x % gs) + gs) % gs; x < w; x += gs) for (let y = ((c.y % gs) + gs) % gs; y < h; y += gs) g.fillRect(x, y, 2, 2);
  g.setTransform(d * c.z, 0, 0, d * c.z, d * c.x, d * c.y);
  for (const t of ['highlight', 'box', 'curve', 'text', 'arrow']) S.els.forEach(e => e.type === t && paint(e));
  $('#zVal').textContent = Math.round(c.z * 100) + '%';
  requestAnimationFrame(frame);
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
$('#zIn').onclick = () => zoom(1.2); $('#zOut').onclick = () => zoom(1 / 1.2);
$('#btnFollow').onclick = () => setFollow(!S.follow);

/* ---------- Audio / sync ---------- */
function say(text) { $('#bubble').textContent = text; }
function stopAudio() {
  speechSynthesis.cancel(); if (S.audio) { S.audio.pause(); S.audio = null; } $('#avatar').classList.remove('speaking');
}
async function speak(step, tk) {
  $('#avatar').classList.add('speaking');
  const lang = $('#lang').value, done = () => $('#avatar').classList.remove('speaking');
  if (S.customVoice && !CFG.useMock) {
    try {
      const r = await fetch(CFG.ttsEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: step.audioText, voice_id: CFG.voiceId, lang }) });
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
async function run(i, replay = false) {
  const tk = ++S.token, st = S.steps[i]; if (!st) return;
  S.i = i; S.playing = true; setPlayIcon(); stopAudio();
  if (!st.shown) { st.shown = true; S.stepY = S.oy; addActions(st.visualActions || []); }
  else S.stepY = S.stepY ?? 0;
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
  if (S.customVoice && CFG.useMock) say('Custom voice needs a live /api/tts endpoint. Set useMock:false in app.js.'); };

/* ---------- AI calls ---------- */
async function callAI(payload) {
  if (CFG.useMock) { await new Promise(r => setTimeout(r, 400)); return payload.question ? mockAnswer(payload.question) : DEMO; }
  const r = await fetch(CFG.lessonEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error('Lesson API ' + r.status);
  return r.json();
}
async function startLesson(topic) {
  pause(); S.steps = []; S.els = []; S.oy = 0; S.started = true; setFollow(true);
  say('Preparing your lesson…');
  try {
    const out = await callAI({ mode: S.mode, lang: $('#lang').value, topic, file: S.file });
    S.steps = out.steps; $('#btnSend').textContent = 'Ask'; run(0);
  } catch (e) { say('Couldn’t reach the lesson service. Check your endpoint and try again.'); S.started = false; }
}
async function ask(q) {
  pause(); say('Thinking about your question…');
  const active = S.steps[S.i];
  try {
    const out = await callAI({ mode: S.mode, lang: $('#lang').value, question: q, activeStep: active && { id: active.id, audioText: active.audioText },
      board: S.els.map(({ id, type, text, x, y }) => ({ id, type, text, x, y })) });
    S.steps.splice(S.i + 1, 0, ...out.steps); setFollow(true); run(S.i + 1);
  } catch (e) { say('Couldn’t answer that right now. Try asking again.'); }
}

/* ---------- Dock ---------- */
function submit() {
  const v = $('#input').value.trim(); if (!v && !S.file) return; $('#input').value = '';
  S.started ? ask(v) : startLesson(v || S.file.name);
}
$('#btnSend').onclick = submit;
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  S.mode = b.dataset.mode; document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
$('#btnFile').onclick = () => $('#file').click();
$('#file').onchange = e => {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { S.file = { name: f.name, mime: f.type, base64: r.result.split(',')[1] };
    $('#fileName').textContent = 'Attached: ' + f.name; $('#fileName').classList.remove('hidden'); };
  r.readAsDataURL(f);
};
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
resize(); lucide.createIcons();
document.fonts.load('700 32px Caveat').then(() => requestAnimationFrame(frame));
