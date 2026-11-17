// Vercel serverless function: POST /api/ai  { system, prompt }  ->  { text, model }
// Calls Google Gemini with GEMINI_API_KEY, which stays on the server.

const MAX_CHARS = 60000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY is not set on Vercel.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const system = body && typeof body.system === 'string' ? body.system : '';
  const prompt = body && typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) return res.status(400).json({ error: 'Missing prompt.' });
  if (system.length + prompt.length > MAX_CHARS) return res.status(413).json({ error: 'Prompt too long.' });

  const model = (process.env.GEMINI_MODEL || '').trim() || 'gemini-flash-latest';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || `Gemini returned HTTP ${r.status}`;
      return res.status(502).json({ error: msg });
    }
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) return res.status(502).json({ error: 'Gemini returned an empty answer.' });
    return res.status(200).json({ text, model });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Gemini: ' + e.message });
  }
};
