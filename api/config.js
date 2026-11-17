// Vercel serverless function: GET /api/config
// Tells the browser which keys exist. Returns ONLY public values (Supabase URL + publishable/anon key).
// Secrets (GEMINI_API_KEY) are reported as true/false, never returned.

function jwtRole(key) {
  try {
    const part = key.split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role || null;
  } catch (e) {
    return null;
  }
}

module.exports = function handler(req, res) {
  const url = (process.env.SUPABASE_URL || '').trim();
  let key = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  let warning = null;

  // Safety net: never hand a secret Supabase key to the browser.
  if (/^sb_secret_/.test(key) || jwtRole(key) === 'service_role') {
    key = '';
    warning = 'SUPABASE_ANON_KEY on Vercel is a SECRET key. Replace it with the publishable key (sb_publishable_...).';
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify({
    supabaseUrl: url,
    supabaseAnonKey: key,
    hasGeminiKey: Boolean((process.env.GEMINI_API_KEY || '').trim()),
    geminiModel: (process.env.GEMINI_MODEL || '').trim() || 'gemini-flash-latest',
    keys: {
      SUPABASE_URL: Boolean(url),
      SUPABASE_ANON_KEY: Boolean(key),
      GEMINI_API_KEY: Boolean((process.env.GEMINI_API_KEY || '').trim()),
    },
    warning,
  }));
};
