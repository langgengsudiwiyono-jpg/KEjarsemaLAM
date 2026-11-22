/* Inkboard proxy – Cloudflare Worker. Secrets live in env, never in the browser.
   POST /api/lesson  → Claude or Gemini, returns structured lesson JSON
   POST /api/tts     → ElevenLabs, returns audio/mpeg */
import tpl from './promptTemplate.json';

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...h } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return J({ error: 'Origin not allowed' }, 403, cors);
    if (req.method !== 'POST') return J({ error: 'POST only' }, 405, cors);
    if (+req.headers.get('content-length') > 14e6) return J({ error: 'Payload too large' }, 413, cors);
    const { pathname } = new URL(req.url);
    try {
      const body = await req.json();
      if (pathname === '/api/lesson') return J(await lesson(body, env), 200, cors);
      if (pathname === '/api/tts') return await tts(body, env, cors);
      return J({ error: 'Not found' }, 404, cors);
    } catch (e) { return J({ error: e.message || 'Server error' }, 502, cors); }
  },
};

async function lesson(b, env) {
  const f = b.file;
  const task = { task: b.question ? 'question' : 'lesson', mode: b.mode, language: b.lang, topic: b.topic,
    question: b.question, activeStep: b.activeStep, board: b.board };
  const text = [JSON.stringify(task)];
  if (f?.text && !f.base64) text.push(`SOURCE MATERIAL (${String(f.name).slice(0, 80)}):\n${f.text.slice(0, 60000)}`);
  const out = (env.PROVIDER || 'claude').toLowerCase() === 'gemini' ? await gemini(text, f, env) : await claude(text, f, env);
  if (!Array.isArray(out?.steps) || !out.steps.length) throw new Error('Model returned no steps');
  return out;
}

async function claude(text, f, env) {
  const content = [];
  if (f?.base64) content.push(f.kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.base64 } });
  content.push({ type: 'text', text: text.join('\n\n') });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 4096, system: tpl.systemPrompt,
      tools: [{ name: 'emit_lesson', description: 'Return the lesson steps and whiteboard actions.', input_schema: tpl.responseSchema }],
      tool_choice: { type: 'tool', name: 'emit_lesson' }, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Claude ' + r.status);
  return j.content.find(c => c.type === 'tool_use')?.input;
}

async function gemini(text, f, env) {
  const parts = [];
  if (f?.base64) parts.push({ inline_data: { mime_type: f.kind === 'pdf' ? 'application/pdf' : f.mime, data: f.base64 } });
  parts.push({ text: text.join('\n\n') });
  const model = env.GEMINI_MODEL || 'gemini-2.5-pro';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: tpl.systemPrompt }] }, contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: tpl.responseSchema } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Gemini ' + r.status);
  return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || 'null');
}

async function tts(b, env, cors) {
  const text = String(b.text || '').slice(0, 1500);
  if (!text) return J({ error: 'text is required' }, 400, cors);
  const voice = env.ELEVENLABS_VOICE_ID || b.voice_id;          // server-side voice wins
  if (!/^[A-Za-z0-9]{10,40}$/.test(voice || '')) return J({ error: 'voice_id missing or invalid' }, 400, cors);
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' }),
  });
  if (!r.ok) return J({ error: 'ElevenLabs ' + r.status }, 502, cors);
  return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg', ...cors } });
}
