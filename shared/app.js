/* =====================================================================
   Opus Revenue Desk — shared logic
   Config loader · Supabase client · connect screen · file parsers ·
   rate recommendation rules · AI call · helpers
   Loaded after supabase-js (window.supabase), SheetJS (window.XLSX)
   and Chart.js (window.Chart) from CDNs.
   ===================================================================== */
(function () {
  'use strict';
  const ORD = (window.ORD = {});

  /* ---------------------------------------------------------------
     1. Rate rules — every threshold in one place (tune here)
     --------------------------------------------------------------- */
  ORD.RULES = {
    horizonDays: 60,
    // KL market demand (Lighthouse Market Insight, 0-100)
    demandBands: [
      { below: 25, adj: -0.08 },
      { below: 45, adj: -0.03 },
      { below: 65, adj: 0 },
      { below: 80, adj: 0.06 },
      { below: Infinity, adj: 0.12 },
    ],
    // Hotel occupancy on the books (%)
    otb: { high: 85, highAdj: 0.10, mid: 70, midAdj: 0.05, lowWithinDays: 14, low: 40, lowAdj: -0.07 },
    // Room-type pickup (share of that room type's inventory sold) — only when room counts are entered
    roomType: { full: 0.90, fullAdj: 0.05, lowWithinDays: 14, low: 0.30, lowAdj: -0.03 },
    // Competitor guardrail on the cheapest room type
    compset: { floorOfMedian: 0.90, ratingGap: 0.3, premiumAbove: 0.10, premiumEven: 0.03, premiumBelow: -0.05 },
    roundTo: 5,
    nationalityMinNights: 5,
  };

  /* ---------------------------------------------------------------
     2. Small helpers
     --------------------------------------------------------------- */
  const K = (ORD.KEYS = {
    url: 'ord.supabaseUrl',
    key: 'ord.supabaseKey',
    gemini: 'ord.geminiKey',
    model: 'ord.geminiModel',
    maps: 'ord.mappings',
  });
  const store = (ORD.store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
    json(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; } catch (e) { return fallback; } },
    setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  });

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  ORD.h = h;
  // replaceChildren that skips null/false (conditional children) and flattens arrays
  ORD.fill = function (el, ...kids) {
    el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
    return el;
  };
  ORD.$ = (s, r) => (r || document).querySelector(s);

  let toastTimer;
  ORD.toast = function (msg, isErr) {
    let t = document.querySelector('.toast');
    if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), isErr ? 7000 : 3500);
  };

  ORD.empty = (title, text) => h('div', { class: 'empty' }, h('b', { text: title }), text ? h('span', { text }) : null);

  /* ---------------------------------------------------------------
     3. Numbers & dates (dates are 'YYYY-MM-DD' strings, UTC maths)
     --------------------------------------------------------------- */
  const nf0 = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bad = (v) => v == null || Number.isNaN(+v) || !Number.isFinite(+v);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  const D = (ORD.date = {
    iso(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; },
    today() { const d = new Date(); return D.iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); },
    parts(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; },
    toUTC(s) { const p = D.parts(s); return Date.UTC(p.y, p.m - 1, p.d); },
    fromUTC(ms) { const d = new Date(ms); return D.iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); },
    add(s, n) { return D.fromUTC(D.toUTC(s) + n * 864e5); },
    diff(a, b) { return Math.round((D.toUTC(b) - D.toUTC(a)) / 864e5); },
    dow(s) { return new Date(D.toUTC(s)).getUTCDay(); },
    monthStart(s) { return s.slice(0, 7) + '-01'; },
    monthEnd(s) { const p = D.parts(s); return D.fromUTC(Date.UTC(p.y, p.m, 0)); },
    addMonths(s, n) { const p = D.parts(s); return D.fromUTC(Date.UTC(p.y, p.m - 1 + n, 1)); },
    range(a, b) { const out = []; for (let d = a; d <= b; d = D.add(d, 1)) out.push(d); return out; },
    valid(y, m, d) {
      if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
      const s = D.iso(y, m, d);
      return D.fromUTC(D.toUTC(s)) === s ? s : null;
    },
  });

  ORD.fmt = {
    rm: (v) => (bad(v) ? '—' : 'RM ' + nf0.format(Math.round(+v))),
    rm2: (v) => (bad(v) ? '—' : 'RM ' + nf2.format(+v)),
    int: (v) => (bad(v) ? '—' : nf0.format(+v)),
    pct: (v, dp = 1) => (bad(v) ? '—' : (+v).toFixed(dp) + '%'), // v already in percent
    share: (v, dp = 1) => (bad(v) ? '—' : (+v * 100).toFixed(dp) + '%'), // v as fraction
    signed: (v, dp = 0) => (bad(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v * 100).toFixed(dp) + '%'),
    day: (s) => { const p = D.parts(s); return `${DOW[D.dow(s)]} ${p.d} ${MON[p.m - 1]}`; },
    dayShort: (s) => { const p = D.parts(s); return `${p.d} ${MON[p.m - 1]}`; },
    dateLong: (s) => { const p = D.parts(s); return `${p.d} ${MON[p.m - 1]} ${p.y}`; },
    month: (s) => { const p = D.parts(s); return `${MONL[p.m - 1]} ${p.y}`; },
    dow: (s) => DOW[D.dow(s)],
  };

  ORD.toNum = function (v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s || /^[-–—]$/.test(s)) return null;
    const paren = /^\(.*\)$/.test(s);
    s = s.replace(/[^0-9.\-]/g, '');
    if (!s || s === '-' || s === '.') return null;
    const n = parseFloat(s);
    if (Number.isNaN(n)) return null;
    return paren ? -Math.abs(n) : n;
  };

  ORD.parseDate = function (v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !Number.isNaN(+v)) return D.iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return D.fromUTC(Math.round((Math.floor(v) - 25569) * 864e5));
      return null;
    }
    const s = String(v).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return D.valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let d = +m[1], mo = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // fall back to month/day
      return D.valid(y, mo, d);
    }
    m = s.match(/(\d{1,2})[\s\-/]*([A-Za-z]{3,9})[\s\-/,]*(\d{2,4})/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
      let y = +m[3]; if (y < 100) y += 2000;
      return D.valid(y, MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    }
    m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return D.valid(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    if (/^\d{5}(\.\d+)?$/.test(s)) return ORD.parseDate(Number(s));
    return null;
  };

  const norm = (ORD.norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim());
  ORD.roundTo = (v, step) => Math.round(v / step) * step;
  const median = (ORD.median = (arr) => {
    const a = arr.filter((x) => !bad(x)).map(Number).sort((x, y) => x - y);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  });
  const mean = (ORD.mean = (arr) => { const a = arr.filter((x) => !bad(x)).map(Number); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; });

  /* ---------------------------------------------------------------
     4. Config: /api/config first, then this browser's saved values
     --------------------------------------------------------------- */
  ORD.loadConfig = async function () {
    let server = null;
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) server = await r.json();
    } catch (e) { /* not on Vercel (e.g. local static server) */ }
    const local = { url: store.get(K.url), key: store.get(K.key), gemini: store.get(K.gemini), model: store.get(K.model) };
    const src = (serverVal, localVal) => (serverVal ? 'vercel' : localVal ? 'browser' : 'missing');
    const cfg = {
      server,
      supabaseUrl: (server && server.supabaseUrl) || local.url,
      supabaseKey: (server && server.supabaseAnonKey) || local.key,
      geminiModel: local.model || (server && server.geminiModel) || 'gemini-flash-latest',
      source: {
        SUPABASE_URL: src(server && server.supabaseUrl, local.url),
        SUPABASE_ANON_KEY: src(server && server.supabaseAnonKey, local.key),
        GEMINI_API_KEY: src(server && server.hasGeminiKey, local.gemini),
      },
      warning: server && server.warning,
    };
    ORD.config = cfg;
    return cfg;
  };

  function jwtRole(key) {
    try {
      const part = key.split('.')[1];
      return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).role || null;
    } catch (e) { return null; }
  }

  ORD.createClient = (url, key) => window.supabase.createClient(url.replace(/\/+$/, ''), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  ORD.testConnection = async function (url, key) {
    url = (url || '').trim(); key = (key || '').trim();
    if (!/^https?:\/\/[^\s]+$/.test(url)) return { ok: false, message: 'The Project URL should look like https://abcdefgh.supabase.co' };
    if (!key) return { ok: false, message: 'Paste the publishable key (sb_publishable_…) or the anon key.' };
    if (/^sb_secret_/.test(key) || jwtRole(key) === 'service_role') {
      return { ok: false, message: 'That is a SECRET key. Never use it in the browser — paste the publishable key (sb_publishable_…) instead.' };
    }
    if (!window.supabase) return { ok: false, message: 'The Supabase library did not load. Check your internet connection and refresh.' };
    try {
      const c = ORD.createClient(url, key);
      const { data, error } = await c.from('properties').select('code,name');
      if (error) {
        const missing = error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message || '');
        return {
          ok: false, missing,
          message: missing ? 'Connected, but the tables are missing — run schema.sql in Supabase › SQL Editor, then test again.'
            : 'Supabase replied: ' + (error.message || error.code || 'unknown error'),
        };
      }
      const n = (data || []).length;
      return { ok: true, count: n, client: c, message: `Connected — ${n} hotel${n === 1 ? '' : 's'} found.` };
    } catch (e) {
      return { ok: false, message: 'Could not reach Supabase: ' + e.message };
    }
  };

  /* ---------------------------------------------------------------
     5. Page chrome: top bar + "Connect your Supabase" panel
     --------------------------------------------------------------- */
  ORD.renderTopbar = function (active) {
    const link = (href, label, key) => h('a', { href, class: active === key ? 'active' : null, 'aria-current': active === key ? 'page' : null }, label);
    const bar = h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'O'), 'Opus Revenue Desk'),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, link('/home/', 'Home', 'home'), link('/dashboard/', 'Dashboard', 'dashboard')),
      h('div', { class: 'spacer' }),
      h('div', { class: 'conn', id: 'conn' }, h('i', { class: 'dot' }), h('span', { text: 'Checking…' })));
    document.body.prepend(bar);
  };
  ORD.setConn = function (state, text) {
    const c = document.getElementById('conn');
    if (!c) return;
    c.querySelector('.dot').className = 'dot ' + (state || '');
    c.querySelector('span').textContent = text;
  };

  ORD.copySchema = async function () {
    try {
      const r = await fetch('/supabase/schema.sql', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await navigator.clipboard.writeText(await r.text());
      ORD.toast('schema.sql copied — paste it into Supabase › SQL Editor › New query, then Run.');
    } catch (e) {
      ORD.toast('Could not copy automatically. Open /supabase/schema.sql in a new tab and copy it from there.', true);
    }
  };

  ORD.renderConnect = function (container, status) {
    status = status || {};
    const url = h('input', { type: 'url', id: 'sb-url', placeholder: 'https://abcdefgh.supabase.co', value: store.get(K.url), autocomplete: 'off' });
    const key = h('input', { type: 'text', id: 'sb-key', placeholder: 'sb_publishable_…  (or the legacy anon key)', value: store.get(K.key), autocomplete: 'off', spellcheck: 'false' });
    const msg = h('div', { class: 'msg' + (status.message ? ' err' : ''), role: 'status', text: status.message || '' });
    const save = h('button', { class: 'btn primary', disabled: true }, 'Save & continue');
    const test = h('button', { class: 'btn' }, 'Test connection');
    let lastOk = false;
    test.addEventListener('click', async () => {
      test.disabled = true; msg.className = 'msg'; msg.textContent = 'Testing…';
      const r = await ORD.testConnection(url.value, key.value);
      msg.className = 'msg ' + (r.ok ? 'ok' : 'err'); msg.textContent = r.message;
      lastOk = r.ok; save.disabled = !r.ok; test.disabled = false;
    });
    [url, key].forEach((i) => i.addEventListener('input', () => { lastOk = false; save.disabled = true; }));
    save.addEventListener('click', () => {
      if (!lastOk) return;
      store.set(K.url, url.value.trim().replace(/\/+$/, ''));
      store.set(K.key, key.value.trim());
      location.reload();
    });
    const fromVercel = ORD.config && ORD.config.source.SUPABASE_URL === 'vercel';
    ORD.fill(container, h('div', { class: 'card connect' },
      h('h1', null, 'Connect your Supabase'),
      h('p', { class: 'ink2', style: { marginTop: '8px' } },
        'This tool keeps its data in your Supabase project. Paste the two public values below — they are saved in this browser only. ',
        'When SUPABASE_URL and SUPABASE_ANON_KEY are set on Vercel, this screen is skipped.'),
      fromVercel ? h('div', { class: 'callout warn' }, 'Vercel has Supabase values set, but the connection failed. Check them in Vercel › Settings › Environment Variables, or paste working values below.') : null,
      h('div', { class: 'form-grid' },
        h('label', { class: 'field', for: 'sb-url' }, 'Project URL', url),
        h('label', { class: 'field', for: 'sb-key' }, 'Publishable key (safe to use in the browser)', key)),
      h('div', { class: 'row' }, test, save),
      msg,
      h('hr', { style: { border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' } }),
      h('h3', null, 'First time? Set up Supabase in 3 steps'),
      h('ol', null,
        h('li', null, 'Create a free project at ', h('a', { href: 'https://supabase.com/dashboard', target: '_blank', rel: 'noopener' }, 'supabase.com/dashboard'), ' (region: Southeast Asia — Singapore).'),
        h('li', null, 'Open SQL Editor › New query, paste schema.sql and click Run. ',
          h('button', { class: 'btn small', onclick: ORD.copySchema }, 'Copy schema.sql')),
        h('li', null, 'Copy the Project URL (the Connect button, or Project Settings › Data API) and the publishable key (Project Settings › API Keys). Never use the secret key here.')),
      h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Full walkthrough: API_KEYS_GUIDE.md in the project folder.')));
  };

  /* ---------------------------------------------------------------
     6. Boot + reference data
     --------------------------------------------------------------- */
  ORD.boot = async function ({ page, main, onReady }) {
    ORD.renderTopbar(page);
    const cfg = await ORD.loadConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseKey) {
      ORD.setConn('bad', 'Not connected');
      ORD.renderConnect(main);
      return;
    }
    const t = await ORD.testConnection(cfg.supabaseUrl, cfg.supabaseKey);
    if (!t.ok) {
      ORD.setConn('bad', 'Connection problem');
      ORD.renderConnect(main, t);
      return;
    }
    ORD.db = t.client;
    ORD.setConn('ok', 'Connected');
    try {
      await ORD.loadReference();
    } catch (e) {
      ORD.fill(main, h('div', { class: 'card' }, ORD.empty('Could not load hotels', e.message)));
      return;
    }
    if (!ORD.properties.length) {
      ORD.fill(main, h('div', { class: 'card' }, ORD.empty('No hotels found', 'The properties table is empty — run schema.sql again to add your three hotels.')));
      return;
    }
    await onReady();
  };

  ORD.q = async function (builder) {
    const { data, error } = await builder;
    if (error) throw new Error(error.message || String(error.code));
    return data || [];
  };
  ORD.selectAll = async function (makeQuery, pageSize = 1000) {
    let all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await makeQuery().range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      all = all.concat(data || []);
      if (!data || data.length < pageSize) break;
    }
    return all;
  };
  ORD.upsertChunks = async function (table, rows, onConflict, chunk = 500) {
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await ORD.db.from(table).upsert(rows.slice(i, i + chunk), { onConflict });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  };

  ORD.loadReference = async function () {
    const [props, rts] = await Promise.all([
      ORD.q(ORD.db.from('properties').select('*').order('name')),
      ORD.q(ORD.db.from('room_types').select('*').order('property_code').order('sort').order('name')),
    ]);
    ORD.properties = props;
    ORD.propByCode = Object.fromEntries(props.map((p) => [p.code, p]));
    ORD.roomTypes = rts;
  };
  ORD.roomTypesFor = (code, activeOnly) => ORD.roomTypes.filter((r) => r.property_code === code && (!activeOnly || r.active));

  ORD.propertySelect = function (id, value, onChange) {
    const sel = h('select', { id }, ORD.properties.map((p) => h('option', { value: p.code }, p.name)));
    sel.value = value || ORD.properties[0].code;
    if (onChange) sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };

  /* Distinctive words per hotel, used to recognise a hotel in file titles / names */
  ORD.guessProperty = function (text) {
    const t = ' ' + norm(text) + ' ';
    for (const p of ORD.properties) if (t.includes(' ' + norm(p.ezee_name) + ' ') || t.includes(' ' + norm(p.name) + ' ')) return p.code;
    const others = (p) => ORD.properties.filter((o) => o.code !== p.code).map((o) => norm(o.ezee_name) + ' ' + norm(o.name)).join(' ');
    let best = null, bestScore = 0;
    for (const p of ORD.properties) {
      const words = norm(p.name).split(' ').filter((w) => w.length > 3 && !(' ' + others(p) + ' ').includes(' ' + w + ' '));
      const score = words.filter((w) => new RegExp('\\b' + w.replace(/s$/, '') + 's?\\b').test(t)).length;
      if (score > bestScore) { best = p.code; bestScore = score; }
    }
    return best;
  };

  /* ---------------------------------------------------------------
     7. File reading + detection
     --------------------------------------------------------------- */
  ORD.readWorkbook = async function (file) {
    if (!window.XLSX) throw new Error('The spreadsheet reader (SheetJS) did not load. Check your internet connection and refresh.');
    const buf = await file.arrayBuffer();
    const isCsv = /\.(csv|txt)$/i.test(file.name);
    const wb = window.XLSX.read(buf, { type: 'array', raw: isCsv, cellDates: false });
    const sheets = wb.SheetNames.map((n) => ({
      name: n,
      rows: window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }),
    }));
    sheets.sort((a, b) => b.rows.length - a.rows.length);
    return sheets[0] ? sheets[0].rows : [];
  };

  const ALIASES = {
    res_no: ['res no', 'reservation no', 'reservation number', 'res number', 'booking no', 'booking id', 'booking number', 'folio no', 'res', 'reservation', 'conf no', 'confirmation no', 'voucher no'],
    arrival: ['arrival', 'arrival date', 'check in', 'checkin', 'check in date', 'arr date', 'arr'],
    departure: ['departure', 'departure date', 'check out', 'checkout', 'check out date', 'dep date', 'dep'],
    nights: ['nights', 'no of nights', 'night', 'los', 'room nights', 'total nights'],
    room_type: ['room type', 'roomtype', 'room category', 'room type name', 'accommodation', 'unit type'],
    nationality: ['nationality', 'country', 'guest country', 'nation', 'country of residence', 'guest nationality'],
    business_source: ['business source', 'source', 'channel', 'booking source', 'market source', 'travel agent', 'source of business'],
    status: ['status', 'reservation status', 'booking status', 'res status'],
    room_revenue: ['room revenue', 'room charges', 'total room charges', 'room charge', 'revenue', 'total revenue', 'total amount', 'amount', 'net amount', 'total', 'grand total', 'room rate total'],
    booking_date: ['booking date', 'reservation date', 'res date', 'booked on', 'created on', 'created date', 'booking created'],
    date: ['date', 'stay date', 'arrival date', 'check in date', 'day of stay', 'check in'],
    hotel: ['hotel', 'hotel name', 'property', 'property name', 'competitor', 'name', 'compset hotel'],
    rate: ['rate', 'price', 'lowest rate', 'lowest price', 'best available rate', 'bar', 'amount', 'value'],
    channel: ['channel', 'source', 'ota', 'provider', 'website'],
    demand: ['market demand', 'demand', 'demand %', 'demand index', 'market demand %'],
    market_adr: ['market price', 'market adr', 'average price', 'market rate', 'hotel price', 'average rate', 'median price'],
  };
  ORD.ALIASES = ALIASES;

  function aliasScore(header, aliases) {
    const n = norm(header);
    if (!n) return 0;
    let best = 0;
    for (const a of aliases) {
      if (n === a) best = Math.max(best, 3);
      else if (n.startsWith(a + ' ') || n.endsWith(' ' + a)) best = Math.max(best, 2);
      else if (a.length >= 4 && n.includes(a)) best = Math.max(best, 1);
    }
    return best;
  }

  ORD.findHeaderRow = function (rows, keys) {
    let bestIdx = 0, best = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i] || [];
      const strings = r.filter((c) => typeof c === 'string' && c.trim()).length;
      if (strings < 2) continue;
      let score = 0;
      for (const c of r) if (typeof c === 'string') for (const k of keys) if (aliasScore(c, ALIASES[k]) >= 2) { score++; break; }
      if (score > best) { best = score; bestIdx = i; }
    }
    return bestIdx;
  };

  ORD.autoMap = function (headers, fieldKeys) {
    const used = new Set();
    const map = {};
    for (const key of fieldKeys) {
      let bestI = -1, bestS = 0;
      headers.forEach((hd, i) => {
        if (used.has(i)) return;
        const s = aliasScore(hd, ALIASES[key]);
        if (s > bestS) { bestS = s; bestI = i; }
      });
      if (bestI >= 0) { map[key] = bestI; used.add(bestI); }
    }
    return map;
  };

  ORD.detectKind = function (rows) {
    const top = rows.slice(0, 12);
    if (top.some((r) => (r || []).some((c) => norm(c) === 'night sold'))) return 'ezee_daily';
    const hi = ORD.findHeaderRow(rows, ['arrival', 'departure', 'nationality', 'room_type', 'demand', 'date', 'hotel', 'rate']);
    const hs = (rows[hi] || []).map(norm);
    const has = (k) => hs.some((x) => aliasScore(x, ALIASES[k]) >= 2);
    if (has('nationality') || (has('arrival') && (has('departure') || has('nights')))) return 'ezee_reservations';
    if (has('demand')) {
      // Rate Insight exports can carry a demand column too: if there are 2+ other price columns
      // (one per hotel), it is a rates file; a Market Insight file has just demand (+ maybe market price).
      const body = rows.slice(hi + 1, hi + 31);
      const priceCols = hs.filter((x, i) => x && !['date', 'demand', 'market_adr'].some((k) => aliasScore(x, ALIASES[k]) >= 2) && !RATE_SKIP.test(x) &&
        body.filter((r) => { const v = ORD.toNum((r || [])[i]); return v != null && v > 30; }).length >= Math.min(5, body.length * 0.5)).length;
      return priceCols >= 2 ? 'lighthouse_rates' : 'lighthouse_demand';
    }
    return 'lighthouse_rates';
  };

  ORD.guessSnapshotDate = function (fileName, rows) {
    const m = String(fileName).match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (m) { const d = D.valid(+m[1], +m[2], +m[3]); if (d) return d; }
    for (const r of rows.slice(0, 6)) for (const c of r || []) {
      if (typeof c === 'string' && /(extract|export|generated|created|as of|shopped|report date)/i.test(c)) {
        const d = ORD.parseDate(c.replace(/^[^0-9A-Za-z]*[A-Za-z ]*?(on|of|:)\s*/i, ''));
        if (d) return d;
      }
    }
    return D.today();
  };

  /* ---------- eZee "Monthly Statistics" ---------- */
  ORD.parseEzeeDaily = function (rows, fileName) {
    let month = null;
    const titleBits = [];
    rows.slice(0, 6).forEach((r) => (r || []).forEach((c) => {
      if (typeof c !== 'string') return;
      const m = c.match(/Month\s+([A-Za-z]+)\s*,?\s*(\d{4})/i);
      if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) month = D.iso(+m[2], MONTHS[m[1].slice(0, 3).toLowerCase()], 1);
      titleBits.push(c);
    }));
    const hdrIdx = rows.findIndex((r) => (r || []).some((c) => norm(c) === 'night sold'));
    if (hdrIdx < 0) throw new Error('This does not look like an eZee Monthly Statistics export (no "Night Sold" column).');
    const header = rows[hdrIdx].map(norm);
    const col = (...names) => header.findIndex((x) => names.includes(x));
    const C = {
      date: col('date'), avail: col('available rooms'), sold: col('night sold', 'nights sold'), comp: col('complimentary'),
      occ: col('occ', 'occ %', 'occupancy'), adr: col('adr'), revpar: col('rev par', 'revpar'), pax: col('pax'),
      room: col('room charges'), extra: col('extra charges'), tax: col('tax'),
    };
    if (C.date < 0) C.date = 0;
    const warnings = [];
    if (!month) warnings.push('Could not find the month line ("Month November,2026") — pick the month below.');
    const out = [];
    let total = null;
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const first = String(r[C.date] != null ? r[C.date] : r[0] != null ? r[0] : '').trim();
      if (/^total/i.test(first)) {
        total = { avail: ORD.toNum(r[C.avail]), sold: ORD.toNum(r[C.sold]), comp: ORD.toNum(r[C.comp]), occ: ORD.toNum(r[C.occ]), adr: ORD.toNum(r[C.adr]), revpar: ORD.toNum(r[C.revpar]), room: ORD.toNum(r[C.room]) };
        break;
      }
      const day = parseInt(first, 10);
      if (!day || day > 31 || ORD.toNum(r[C.avail]) == null) continue;
      out.push({
        day,
        available_rooms: ORD.toNum(r[C.avail]),
        nights_sold: ORD.toNum(r[C.sold]),
        complimentary: ORD.toNum(r[C.comp]),
        occupancy_pct: ORD.toNum(r[C.occ]),
        adr: ORD.toNum(r[C.adr]),
        revpar: ORD.toNum(r[C.revpar]),
        pax: C.pax >= 0 ? ORD.toNum(r[C.pax]) : null,
        room_charges: ORD.toNum(r[C.room]),
        extra_charges: C.extra >= 0 ? ORD.toNum(r[C.extra]) : null,
        tax: C.tax >= 0 ? ORD.toNum(r[C.tax]) : null,
      });
    }
    return {
      kind: 'ezee_daily',
      propertyCode: ORD.guessProperty(titleBits.join(' ') + ' ' + fileName),
      title: titleBits[0] || '',
      month, days: out, total, warnings,
    };
  };

  ORD.buildEzeeDailyRows = function (parsed, propertyCode, month, fileName) {
    const p = D.parts(month);
    const now = new Date().toISOString();
    return parsed.days.map((d) => {
      const stay = D.valid(p.y, p.m, d.day);
      return stay && {
        property_code: propertyCode, stay_date: stay,
        available_rooms: d.available_rooms == null ? null : Math.round(d.available_rooms),
        nights_sold: d.nights_sold, complimentary: d.complimentary == null ? null : Math.round(d.complimentary),
        occupancy_pct: d.occupancy_pct, adr: d.adr, revpar: d.revpar,
        pax: d.pax == null ? null : Math.round(d.pax), room_charges: d.room_charges,
        extra_charges: d.extra_charges, tax: d.tax,
        source_file: fileName, is_sample: false, updated_at: now,
      };
    }).filter(Boolean);
  };

  /* ---------- eZee reservation list ---------- */
  ORD.RES_FIELDS = [
    { key: 'arrival', label: 'Arrival date', required: true },
    { key: 'departure', label: 'Departure date', hint: 'or Nights' },
    { key: 'nights', label: 'Nights', hint: 'or Departure' },
    { key: 'room_type', label: 'Room type', required: true },
    { key: 'room_revenue', label: 'Room revenue', required: true },
    { key: 'nationality', label: 'Nationality / country' },
    { key: 'business_source', label: 'Business source' },
    { key: 'status', label: 'Status' },
    { key: 'res_no', label: 'Reservation no.' },
    { key: 'booking_date', label: 'Booking date' },
  ];

  ORD.analyzeTable = function (rows, keys) {
    const hdrIdx = ORD.findHeaderRow(rows, keys);
    const headers = (rows[hdrIdx] || []).map((c, i) => (c == null || String(c).trim() === '' ? `Column ${i + 1}` : String(c).trim()));
    const body = rows.slice(hdrIdx + 1).filter((r) => (r || []).some((c) => c != null && String(c).trim() !== ''));
    return { hdrIdx, headers, body, signature: headers.map(norm).join('|') };
  };

  ORD.savedMapping = function (kind, signature) {
    const all = store.json(K.maps, {});
    return all[kind + '::' + signature] || null;
  };
  ORD.saveMapping = function (kind, signature, mapping) {
    const all = store.json(K.maps, {});
    all[kind + '::' + signature] = mapping;
    store.setJson(K.maps, all);
  };

  ORD.buildReservations = function (table, map, opts) {
    const out = [], seen = {};
    let skipped = 0;
    const get = (r, k) => (map[k] == null || map[k] === '' ? null : r[+map[k]]);
    const now = new Date().toISOString();
    for (const r of table.body) {
      const arrival = ORD.parseDate(get(r, 'arrival'));
      let departure = ORD.parseDate(get(r, 'departure'));
      const nightsIn = ORD.toNum(get(r, 'nights'));
      if (!departure && arrival && nightsIn > 0) departure = D.add(arrival, Math.round(nightsIn));
      if (!arrival || !departure || departure <= arrival) { skipped++; continue; }
      const nights = D.diff(arrival, departure);
      let revenue = ORD.toNum(get(r, 'room_revenue'));
      if (revenue == null) { skipped++; continue; }
      if (opts.perNight) revenue = revenue * nights;
      const roomType = String(get(r, 'room_type') == null ? '' : get(r, 'room_type')).trim();
      if (!roomType) { skipped++; continue; }
      const resNo = get(r, 'res_no') == null ? '' : String(get(r, 'res_no')).trim();
      const base = `${resNo || 'ROW'}|${arrival}|${departure}|${roomType}`;
      seen[base] = (seen[base] || 0) + 1;
      const str = (k) => { const v = get(r, k); return v == null || String(v).trim() === '' ? null : String(v).trim(); };
      out.push({
        property_code: opts.propertyCode,
        res_key: `${base}|${seen[base]}`,
        res_no: resNo || null,
        booking_date: ORD.parseDate(get(r, 'booking_date')),
        arrival, departure,
        room_type: roomType,
        nationality: str('nationality'),
        business_source: str('business_source'),
        status: str('status') || 'Confirmed',
        room_revenue: Math.round(revenue * 100) / 100,
        source_file: opts.fileName, is_sample: false, updated_at: now,
      });
    }
    return { rows: out, skipped };
  };

  /* ---------- Lighthouse Rate Insight ---------- */
  const RATE_SKIP = /(^day$|weekday|^dow$|demand|event|holiday|median|average|avg|^min|^max|parity|rank|^los$|occupancy|^%|difference|diff|index|compset)/;
  ORD.analyzeRates = function (rows, propertyCode) {
    const t = ORD.analyzeTable(rows, ['date', 'hotel', 'rate', 'channel']);
    const hn = t.headers.map(norm);
    const pick = (k) => { let bi = -1, bs = 0; hn.forEach((x, i) => { const s = aliasScore(x, ALIASES[k]); if (s > bs) { bs = s; bi = i; } }); return bs >= 2 ? bi : -1; };
    let dateCol = pick('date');
    if (dateCol < 0) {
      // first column where most values parse as dates
      dateCol = t.headers.findIndex((_, i) => t.body.slice(0, 20).filter((r) => ORD.parseDate(r[i])).length >= Math.min(5, t.body.length * 0.6));
      if (dateCol < 0) dateCol = 0;
    }
    const hotelCol = pick('hotel'), rateCol = pick('rate');
    const layout = hotelCol >= 0 && rateCol >= 0 ? 'long' : 'wide';
    const hotelCols = t.headers.map((_, i) => i).filter((i) => i !== dateCol && !RATE_SKIP.test(hn[i]) &&
      t.body.slice(0, 30).some((r) => ORD.toNum(r[i]) != null || /sold/i.test(String(r[i] || ''))));
    const p = ORD.propByCode[propertyCode];
    let ownCol = hotelCols.find((i) => ORD.guessProperty(t.headers[i]) === propertyCode);
    if (ownCol == null && hotelCols.length) ownCol = hotelCols[0];
    const channelCol = pick('channel');
    const hotelNames = hotelCol >= 0 ? [...new Set(t.body.map((r) => String(r[hotelCol] || '').trim()).filter(Boolean))] : [];
    const ownName = hotelNames.find((n) => ORD.guessProperty(n) === propertyCode) || (p ? hotelNames.find((n) => norm(n).includes(norm(p.name))) : null) || hotelNames[0] || '';
    return Object.assign(t, { layout, dateCol, hotelCol, rateCol, channelCol, hotelCols, ownCol, hotelNames, ownName });
  };

  ORD.buildRates = function (t, cfg, opts) {
    const best = {};
    let skipped = 0;
    const put = (stay, hotel, isOwn, channel, raw) => {
      const rate = ORD.toNum(raw);
      const sold = rate == null && /sold/i.test(String(raw || ''));
      if (rate == null && !sold) return;
      const key = `${stay}|${hotel}|${channel}`;
      const cur = best[key];
      if (!cur) best[key] = { stay, hotel, isOwn, channel, rate: rate != null ? rate : null, sold: rate == null };
      else if (rate != null && (cur.rate == null || rate < cur.rate)) { cur.rate = rate; cur.sold = false; }
    };
    for (const r of t.body) {
      const stay = ORD.parseDate(r[cfg.dateCol]);
      if (!stay) { skipped++; continue; }
      if (cfg.layout === 'wide') {
        for (const i of cfg.hotelCols) put(stay, t.headers[i], i === +cfg.ownCol, 'Lowest', r[i]);
      } else {
        const hotel = String(r[cfg.hotelCol] || '').trim();
        if (!hotel) { skipped++; continue; }
        const channel = cfg.channelCol >= 0 && r[cfg.channelCol] != null && String(r[cfg.channelCol]).trim() ? String(r[cfg.channelCol]).trim() : 'Lowest';
        put(stay, hotel, hotel === cfg.ownName, channel, r[cfg.rateCol]);
      }
    }
    const rows = Object.values(best).map((b) => ({
      property_code: opts.propertyCode, snapshot_date: opts.snapshotDate, stay_date: b.stay,
      hotel_name: b.hotel, is_own: b.isOwn, channel: b.channel, rate: b.rate, is_sold_out: !!b.sold,
      currency: 'MYR', is_sample: false,
    }));
    return { rows, skipped };
  };

  /* ---------- Lighthouse Market Insight ---------- */
  ORD.analyzeDemand = function (rows) {
    const t = ORD.analyzeTable(rows, ['date', 'demand', 'market_adr']);
    const m = ORD.autoMap(t.headers, ['demand', 'market_adr', 'date']);
    let dateCol = m.date != null ? m.date : t.headers.findIndex((_, i) => t.body.slice(0, 20).filter((r) => ORD.parseDate(r[i])).length >= 5);
    if (dateCol < 0) dateCol = 0;
    return Object.assign(t, { dateCol, demandCol: m.demand != null ? m.demand : -1, priceCol: m.market_adr != null ? m.market_adr : -1 });
  };
  ORD.buildDemand = function (t, cfg, opts) {
    const tmp = [];
    let skipped = 0;
    for (const r of t.body) {
      const stay = ORD.parseDate(r[cfg.dateCol]);
      const dem = ORD.toNum(r[cfg.demandCol]);
      if (!stay || dem == null) { skipped++; continue; }
      tmp.push({ stay, dem, price: cfg.priceCol >= 0 ? ORD.toNum(r[cfg.priceCol]) : null, pctSign: /%/.test(String(r[cfg.demandCol])) });
    }
    const fraction = tmp.length && tmp.every((x) => x.dem <= 1 && !x.pctSign);
    const byDate = {};
    tmp.forEach((x) => { byDate[x.stay] = x; });
    const rows = Object.values(byDate).map((x) => ({
      area: 'Kuala Lumpur', snapshot_date: opts.snapshotDate, stay_date: x.stay,
      demand_pct: Math.round((fraction ? x.dem * 100 : x.dem) * 10) / 10,
      market_adr: x.price, is_sample: false,
    }));
    return { rows, skipped };
  };

  /* ---------------------------------------------------------------
     8. OTA ratings: latest month per hotel → positioning
     --------------------------------------------------------------- */
  ORD.PLATFORMS = ['Agoda', 'Booking.com', 'Trip.com'];
  ORD.loadRatings = async function (code, uptoMonth) {
    let q = ORD.db.from('ota_ratings').select('*').eq('property_code', code).order('month', { ascending: false });
    if (uptoMonth) q = q.lte('month', uptoMonth);
    const rows = await ORD.q(q.limit(500));
    if (!rows.length) return null;
    const month = rows[0].month;
    const cur = rows.filter((r) => r.month === month);
    const out = { month, platforms: {} };
    const ownAll = [], compAll = [];
    for (const pl of ORD.PLATFORMS) {
      const list = cur.filter((r) => r.platform === pl).map((r) => ({ hotel: r.hotel_name, isOwn: r.is_own, score: (+r.rating / +r.scale) * 10 }));
      const own = list.find((x) => x.isOwn);
      const comps = list.filter((x) => !x.isOwn);
      if (!own && !comps.length) continue;
      const compAvg = mean(comps.map((c) => c.score));
      const sorted = [...list].sort((a, b) => b.score - a.score);
      out.platforms[pl] = {
        own: own ? own.score : null, compAvg, count: list.length,
        rank: own ? sorted.findIndex((x) => x.isOwn) + 1 : null,
        gap: own && compAvg != null ? own.score - compAvg : null,
        best: sorted[0],
      };
      if (own) ownAll.push(own.score);
      comps.forEach((c) => compAll.push(c.score));
    }
    out.ownAvg = mean(ownAll);
    out.compAvg = mean(compAll);
    out.gap = out.ownAvg != null && out.compAvg != null ? out.ownAvg - out.compAvg : null;
    return out;
  };

  /* ---------------------------------------------------------------
     9. Rate recommendation engine
     --------------------------------------------------------------- */
  ORD.loadRateInputs = async function (code, start, end) {
    const db = ORD.db;
    const [ds, otb, comp, dem, ratings] = await Promise.all([
      ORD.q(db.from('daily_stats').select('stay_date,available_rooms,nights_sold,complimentary').eq('property_code', code).gte('stay_date', start).lte('stay_date', end)),
      ORD.selectAll(() => db.from('v_otb_room_type').select('stay_date,room_type,rooms_sold').eq('property_code', code).gte('stay_date', start).lte('stay_date', end).order('stay_date')),
      ORD.q(db.from('v_compset_latest').select('*').eq('property_code', code).gte('stay_date', start).lte('stay_date', end)),
      ORD.q(db.from('v_demand_latest').select('stay_date,demand_pct,snapshot_date').gte('stay_date', start).lte('stay_date', end)),
      ORD.loadRatings(code),
    ]);
    return { ds, otb, comp, dem, ratings };
  };

  ORD.computeRecommendations = function (code, inputs, start, days) {
    const R = ORD.RULES;
    const p = ORD.propByCode[code];
    const rts = ORD.roomTypesFor(code, true);
    if (!rts.length) return { error: 'No active room types for this hotel — add them in Home › Room types.' };
    const today = D.today();
    const lead = rts.reduce((a, b) => (+b.base_rate < +a.base_rate ? b : a));
    const gap = inputs.ratings ? inputs.ratings.gap : null;
    const premium = gap == null ? R.compset.premiumEven : gap >= R.compset.ratingGap ? R.compset.premiumAbove : gap <= -R.compset.ratingGap ? R.compset.premiumBelow : R.compset.premiumEven;
    const premiumWhy = gap == null ? 'no OTA ratings yet' : `your OTA rating is ${gap >= 0 ? '+' : ''}${gap.toFixed(2)} vs compset`;

    const dsBy = Object.fromEntries(inputs.ds.map((r) => [r.stay_date, r]));
    const compBy = Object.fromEntries(inputs.comp.map((r) => [r.stay_date, r]));
    const demBy = Object.fromEntries(inputs.dem.map((r) => [r.stay_date, r]));
    const otbBy = {}, otbTotal = {};
    for (const r of inputs.otb) {
      (otbBy[r.stay_date] = otbBy[r.stay_date] || {})[norm(r.room_type)] = r.rooms_sold;
      otbTotal[r.stay_date] = (otbTotal[r.stay_date] || 0) + r.rooms_sold;
    }
    const dates = D.range(start, D.add(start, days - 1));
    const meta = [];
    const cells = Object.fromEntries(rts.map((rt) => [rt.id, []]));
    const pctTxt = (a) => (a > 0 ? '+' : a < 0 ? '−' : '±') + Math.abs(Math.round(a * 100)) + '%';

    for (const d of dates) {
      const daysOut = D.diff(today, d);
      const dateReasons = [], missing = [];
      let adj = 0;

      // 1) KL demand
      const dem = demBy[d] ? +demBy[d].demand_pct : null;
      if (dem != null) {
        const band = R.demandBands.find((b) => dem < b.below);
        adj += band.adj;
        dateReasons.push(`KL demand ${Math.round(dem)}% → ${pctTxt(band.adj)}`);
      } else missing.push('KL demand');

      // 2) Occupancy on the books
      let occ = null, occSrc = null;
      const ds = dsBy[d];
      if (ds && +ds.available_rooms > 0) { occ = ((+ds.nights_sold || 0) + (+ds.complimentary || 0)) / +ds.available_rooms * 100; occSrc = 'eZee'; }
      else if (otbTotal[d] != null) { occ = otbTotal[d] / p.total_rooms * 100; occSrc = 'reservations'; }
      if (occ != null) {
        let a = 0;
        if (occ >= R.otb.high) a = R.otb.highAdj;
        else if (occ >= R.otb.mid) a = R.otb.midAdj;
        else if (daysOut <= R.otb.lowWithinDays && occ < R.otb.low) a = R.otb.lowAdj;
        adj += a;
        dateReasons.push(`On the books ${Math.round(occ)}% (${occSrc}) → ${pctTxt(a)}`);
      } else missing.push('occupancy on the books');

      // 3) Room-type pickup + provisional rate
      const prov = {}, rtReasons = {};
      for (const rt of rts) {
        let a = 0;
        rtReasons[rt.id] = [];
        if (+rt.rooms > 0) {
          const sold = (otbBy[d] && otbBy[d][norm(rt.name)]) || 0;
          const share = sold / +rt.rooms;
          if (share >= R.roomType.full) a = R.roomType.fullAdj;
          else if (daysOut <= R.roomType.lowWithinDays && share <= R.roomType.low) a = R.roomType.lowAdj;
          if (a) rtReasons[rt.id].push(`${rt.name}: ${sold}/${rt.rooms} sold → ${pctTxt(a)}`);
        }
        prov[rt.id] = +rt.base_rate * (1 + adj + a);
      }

      // 4) Competitor guardrail on the cheapest room type
      const c = compBy[d];
      const med = c && c.compset_median != null ? +c.compset_median : null;
      let shift = 1, compReason = null;
      if (med) {
        const lower = med * R.compset.floorOfMedian, upper = med * (1 + premium);
        const lp = prov[lead.id];
        if (lp > upper) { shift = upper / lp; compReason = `Compset median RM ${Math.round(med)}: capped ${lead.name} at median ${pctTxt(premium)} (${premiumWhy})`; }
        else if (lp < lower) { shift = lower / lp; compReason = `Compset median RM ${Math.round(med)}: raised ${lead.name} to 90% of median`; }
        else compReason = `Within compset band (median RM ${Math.round(med)}, allowed up to ${pctTxt(premium)} — ${premiumWhy})`;
      } else missing.push('competitor rates');

      for (const rt of rts) {
        let rate = ORD.roundTo(prov[rt.id] * shift, R.roundTo);
        let clampReason = null;
        if (rate < +rt.min_rate) { rate = +rt.min_rate; clampReason = `Held at minimum RM ${Math.round(rate)}`; }
        if (rate > +rt.max_rate) { rate = +rt.max_rate; clampReason = `Held at maximum RM ${Math.round(rate)}`; }
        const base = +rt.base_rate;
        cells[rt.id].push({
          date: d, rate, base, change: rate / base - 1,
          reasons: [...dateReasons, ...rtReasons[rt.id], compReason, clampReason].filter(Boolean),
          missing,
        });
      }
      meta.push({
        date: d, daysOut, demand: dem, occ, occSrc, median: med,
        own: c && c.own_rate != null ? +c.own_rate : null,
        soldOut: c ? c.competitors_sold_out : 0,
      });
    }
    return {
      property: p, lead, premium, gap, dates, meta,
      rows: rts.map((rt) => ({ roomType: rt, cells: cells[rt.id] })),
    };
  };

  ORD.recsToCsv = function (recs) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [['Hotel', 'Date', 'Day', 'Room type', 'Base rate', 'Recommended rate', 'Change %', 'Reasons'].join(',')];
    recs.rows.forEach((row) => row.cells.forEach((c) => {
      lines.push([recs.property.name, c.date, ORD.fmt.dow(c.date), row.roomType.name, c.base, c.rate,
        (c.change * 100).toFixed(1), c.reasons.join(' | ') + (c.missing.length ? ' | Missing: ' + c.missing.join(', ') : '')].map(esc).join(','));
    }));
    return lines.join('\n');
  };
  ORD.download = function (name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------------------------------------------------------------
     10. KPI maths (matches eZee: complimentary rooms count as occupied)
     --------------------------------------------------------------- */
  ORD.kpisFromDaily = function (rows) {
    let avail = 0, occupied = 0, rev = 0, n = 0;
    for (const r of rows) {
      if (+r.available_rooms > 0) {
        avail += +r.available_rooms;
        occupied += (+r.nights_sold || 0) + (+r.complimentary || 0);
        rev += +r.room_charges || 0;
        n++;
      }
    }
    return {
      days: n, available: avail, occupied, revenue: rev,
      occ: avail ? (occupied / avail) * 100 : null,
      adr: occupied ? rev / occupied : null,
      revpar: avail ? rev / avail : null,
    };
  };

  /* ---------------------------------------------------------------
     11. AI write-up (Gemini) — server route first, browser key for demos
     --------------------------------------------------------------- */
  ORD.aiAvailable = () => ORD.config && ORD.config.source.GEMINI_API_KEY !== 'missing';
  ORD.callAI = async function (system, prompt) {
    const src = ORD.config.source.GEMINI_API_KEY;
    if (src === 'vercel') {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, prompt }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'AI request failed (' + r.status + ')');
      return j;
    }
    if (src === 'browser') {
      const model = ORD.config.geminiModel || 'gemini-flash-latest';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': store.get(K.gemini) },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Gemini request failed (' + r.status + ')');
      const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('Gemini returned an empty answer.');
      return { text, model };
    }
    throw new Error('No Gemini API key — add GEMINI_API_KEY on Vercel or paste a key in Home › Settings.');
  };

  /* Minimal, safe markdown → DOM (headings, bullets, bold) */
  ORD.renderMarkdown = function (text) {
    const root = h('div', { class: 'strategy' });
    let list = null;
    const inline = (s) => {
      const span = h('span');
      s.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) span.append(h('strong', { text: part.slice(2, -2) }));
        else if (part) span.append(document.createTextNode(part));
      });
      return span;
    };
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line.trim()) { list = null; continue; }
      const head = line.match(/^#{1,4}\s+(.*)$/);
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (head) { list = null; root.append(h('h4', null, inline(head[1].replace(/\*\*/g, '')))); }
      else if (bullet) { if (!list) { list = h('ul'); root.append(list); } list.append(h('li', null, inline(bullet[1]))); }
      else { list = null; root.append(h('p', null, inline(line))); }
    }
    return root;
  };

  /* ---------------------------------------------------------------
     12. Chart helpers (Chart.js, themed from CSS variables)
     --------------------------------------------------------------- */
  ORD.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  ORD.charts = {};
  ORD.makeChart = function (id, canvas, config) {
    if (!window.Chart) return null;
    if (ORD.charts[id]) ORD.charts[id].destroy();
    const ink2 = ORD.css('--ink-2'), muted = ORD.css('--muted'), grid = ORD.css('--line'), base = ORD.css('--line-strong');
    window.Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    window.Chart.defaults.font.size = 12;
    window.Chart.defaults.color = muted;
    const opts = config.options || (config.options = {});
    opts.responsive = true;
    opts.maintainAspectRatio = false;
    opts.animation = false;
    opts.plugins = Object.assign({ legend: { display: false } }, opts.plugins || {});
    opts.plugins.tooltip = Object.assign({
      backgroundColor: ORD.css('--surface'), titleColor: ORD.css('--ink'), bodyColor: ink2,
      borderColor: base, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
    }, opts.plugins.tooltip || {});
    for (const ax of Object.values(opts.scales || {})) {
      ax.grid = Object.assign({ color: grid, drawTicks: false }, ax.grid || {});
      ax.border = Object.assign({ color: base }, ax.border || {});
      ax.ticks = Object.assign({ color: muted, padding: 6 }, ax.ticks || {});
    }
    ORD.charts[id] = new window.Chart(canvas, config);
    return ORD.charts[id];
  };
  // Redraw charts when the OS theme changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (typeof ORD.onThemeChange === 'function') ORD.onThemeChange();
    });
  }
})();
