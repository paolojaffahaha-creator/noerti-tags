/* Nörti Arena – gemeinsame Basis für Figurenseite und Sammlung.
   Echte Daten kommen aus Supabase. Mit ?mock=1 läuft alles gegen eine Attrappe im Browser (zum Testen, nichts wird gespeichert). */
(function () {
  const ROOT = new URL('../', document.currentScript.src).href;
  const qs = new URLSearchParams(location.search);
  try {
    if (qs.get('mock') === '1') sessionStorage.setItem('noerti-mock', '1');
    if (qs.get('mock') === '0') sessionStorage.removeItem('noerti-mock');
  } catch {}
  let MOCK = false; try { MOCK = sessionStorage.getItem('noerti-mock') === '1'; } catch {}

  const json = (p) => fetch(ROOT + p, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(p + ' fehlt'); return r.json(); });
  let cfgP = null, typesP = null;
  const config = () => (cfgP ||= json('config.json'));
  const types = () => (typesP ||= json('figuren.json').then((d) => d.figuren || []));

  // ---------- Helfer ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KLASSE = { natur: 'Natur', street: 'Street', sound: 'Sound', original: 'Original' };
  const klasseChip = (k) => `<span class="chip k-${k || 'none'}">${esc((KLASSE[k] || '?').toUpperCase())}</span>`;
  function levelInfo(xp, level) {
    if (level >= 20) return { pct: 100, text: `${xp} XP · Max-Level` };
    const lo = 40 * (level - 1) ** 2, hi = 40 * level ** 2;
    return { pct: Math.max(0, Math.min(100, Math.round(((xp - lo) / (hi - lo)) * 100))), text: `${xp} / ${hi} XP bis Level ${level + 1}` };
  }
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: '2-digit' }); } catch { return ''; } };
  let toastT = null;
  function toast(msg, kind) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast' + (kind === 'err' ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
  }
  function sheet(html, onMount) {
    closeSheet();
    const bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>${html}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
    document.body.appendChild(bg);
    const el = bg.querySelector('.sheet');
    onMount && onMount(el);
    const f = el.querySelector('input, textarea, button'); f && f.focus();
    return el;
  }
  function closeSheet() { document.querySelectorAll('.sheet-bg').forEach((n) => n.remove()); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  const errMsg = (e) => (e && (e.message || e.error_description)) || String(e);

  // Bild verkleinern → WebP (Fallback JPEG), max. 300 KB
  async function shrinkImage(file) {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    for (const type of ['image/webp', 'image/jpeg']) {
      for (const q of [0.82, 0.7, 0.58, 0.45]) {
        const b = await new Promise((r) => c.toBlob(r, type, q));
        if (b && b.type === type && b.size <= 300 * 1024) return b;
      }
    }
    throw new Error('Bild ist zu groß, bitte ein kleineres wählen.');
  }

  // ---------- Echte API (Supabase) ----------
  function realApi() {
    let sbP = null;
    const sb = () => (sbP ||= config().then((c) => window.supabase.createClient(c.supabaseUrl, c.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })));
    const rpc = async (fn, args) => { const { data, error } = await (await sb()).rpc(fn, args || {}); if (error) throw error; return data; };
    const redirect = ROOT + 'sammlung/';
    return {
      getFigure: (s) => rpc('get_figure', { p_serial: s }),
      async me() {
        const c = await sb();
        const { data: { session } } = await c.auth.getSession();
        if (!session) return null;
        const u = session.user;
        const { data } = await c.from('profiles').select('display_name').eq('id', u.id).maybeSingle();
        return { id: u.id, anonymous: !!u.is_anonymous, email: u.email || null, pendingEmail: u.new_email || null, name: data ? data.display_name : null };
      },
      async ensureUser() {
        const c = await sb();
        const { data: { session } } = await c.auth.getSession();
        if (session) return;
        const { error } = await c.auth.signInAnonymously();
        if (error) throw error;
      },
      setName: (n) => rpc('set_display_name', { p_name: n }),
      claim: (s) => rpc('claim_figure', { p_serial: s }),
      updateFigure: (s, nick, bio, images) => rpc('update_figure', { p_serial: s, p_nickname: nick, p_bio: bio, p_images: images }),
      myCollection: () => rpc('my_collection'),
      myTradedAway: () => rpc('my_traded_away'),
      async upload(pid, file, blob) {
        const { error } = await (await sb()).storage.from('figuren-bilder')
          .upload(`${pid}/${file}`, blob, { upsert: true, contentType: blob.type, cacheControl: '60' });
        if (error) throw error;
      },
      async removeImage(pid, file) {
        const { error } = await (await sb()).storage.from('figuren-bilder').remove([`${pid}/${file}`]);
        if (error) throw error;
      },
      async imageUrl(pid, file, v) {
        const c = await config();
        return `${c.supabaseUrl}/storage/v1/object/public/figuren-bilder/${pid}/${file}?v=${encodeURIComponent(v || '')}`;
      },
      async linkEmail(email) {
        const { error } = await (await sb()).auth.updateUser({ email }, { emailRedirectTo: redirect });
        if (error) throw error;
      },
      async signInEmail(email) {
        const { error } = await (await sb()).auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirect } });
        if (error) throw error;
      },
      async signOut() { await (await sb()).auth.signOut(); },
      getGameData: (v) => rpc('get_game_data', v ? { p_version: v } : {}),
      gameDataVersions: () => rpc('game_data_versions'),
      saveGameData: (data, pin, base, note) => rpc('save_game_data', { p_data: data, p_pin: pin, p_base: base, p_note: note || null })
    };
  }

  // ---------- Attrappe (?mock=1) ----------
  function mockApi() {
    const KEY = 'noerti-mock-state';
    const seed = () => ({
      me: { id: 'me', anonymous: true, email: null, name: 'Feigenkönig' }, names: { mo: 'Mo' }, log: [],
      figures: {
        AAAAAAAA: { serial: 'AAAAAAAA', public_id: 'p-a', type_id: '005', owner: 'me', nickname: 'DJ Feige', bio: 'Dreht immer auf Lautstärke 11.', images: [], xp: 600, level: 4, wins: 9, losses: 4, opponents: 7, owner_since: '2026-11-12T10:00:00Z' },
        BBBBBBBB: { serial: 'BBBBBBBB', public_id: 'p-b', type_id: '002', owner: 'mo', nickname: 'Kicki', bio: '', images: [], xp: 170, level: 3, wins: 5, losses: 2, opponents: 3, owner_since: '2026-10-29T10:00:00Z' },
        CCCCCCCC: { serial: 'CCCCCCCC', public_id: 'p-c', type_id: '001', owner: null, nickname: null, bio: null, images: [], xp: 0, level: 1, wins: 0, losses: 0, opponents: 0, owner_since: null }
      }, blobs: {}
    });
    const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
    const save = (s) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
    const wait = () => new Promise((r) => setTimeout(r, 200));
    const view = (s, f) => ({
      public_id: f.public_id, type_id: f.type_id, nickname: f.nickname, bio: f.bio, images: f.images, xp: f.xp, level: f.level,
      wins: f.wins, losses: f.losses, opponents: f.opponents, owner_since: f.owner_since, updated_at: f.updated_at || 'x',
      owner_name: f.owner === 'me' ? (s.me && s.me.name) : f.owner ? s.names[f.owner] : null,
      is_mine: !!(s.me && f.owner === 'me')
    });
    const fail = (m) => { throw new Error(m); };
    return {
      async getFigure(serial) { await wait(); const s = load(); const f = s.figures[serial.toUpperCase()]; return f ? view(s, f) : null; },
      async me() { const s = load(); return s.me ? { ...s.me } : null; },
      async ensureUser() { const s = load(); if (!s.me) { s.me = { id: 'me', anonymous: true, email: null, name: null }; save(s); } },
      async setName(n) { const s = load(); if (!s.me) fail('Nicht angemeldet'); s.me.name = n.trim(); save(s); },
      async claim(serial) {
        await wait(); const s = load(); const f = s.figures[serial]; if (!s.me) fail('Nicht angemeldet'); if (!s.me.name) fail('Erst einen Spielernamen wählen');
        if (!f) fail('Figur nicht registriert');
        if (f.owner !== 'me') { s.log.push({ serial, from: f.owner, to: 'me', at: new Date().toISOString() }); f.owner = 'me'; f.owner_since = new Date().toISOString(); }
        save(s); return view(s, f);
      },
      async updateFigure(serial, nick, bio, images) {
        await wait(); const s = load(); const f = s.figures[serial];
        if (!f || f.owner !== 'me' || !s.me) fail('Nur der Besitzer darf die Figur bearbeiten');
        f.nickname = (nick || '').trim() || null; f.bio = (bio || '').trim() || null; if (images) f.images = images; f.updated_at = String(Date.now());
        save(s); return view(s, f);
      },
      async myCollection() {
        const s = load(); if (!s.me) fail('Nicht angemeldet');
        return Object.values(s.figures).filter((f) => f.owner === 'me')
          .map((f) => ({ ...view(s, f), serial: f.serial, traded_in: s.log.some((l) => l.serial === f.serial && l.from) }))
          .sort((a, b) => b.level - a.level || b.xp - a.xp);
      },
      async myTradedAway() { return []; },
      async upload(pid, file, blob) {
        const s = load();
        s.blobs[pid + '/' + file] = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        save(s);
      },
      async removeImage(pid, file) { const s = load(); delete s.blobs[pid + '/' + file]; save(s); },
      async imageUrl(pid, file) { return load().blobs[pid + '/' + file] || ''; },
      async linkEmail(email) { await wait(); const s = load(); s.me.pendingEmail = email; save(s); },
      async signInEmail() { await wait(); },
      async signOut() { const s = load(); s.me = null; save(s); },
      async getGameData(v) { const g = load().game || []; return (v ? g.find((x) => x.version === v) : g[g.length - 1]) || null; },
      async gameDataVersions() { return (load().game || []).map(({ version, note, created_at }) => ({ version, note, created_at })).reverse(); },
      async saveGameData(data, pin, base, note) {
        await wait(); if (!pin) fail('Falsche PIN');
        const s = load(); s.game ||= []; const cur = s.game.length ? s.game[s.game.length - 1].version : 0;
        if (base != null && base !== cur) fail(`Inzwischen gespeichert (Version ${cur}). Bitte neu laden.`);
        s.game.push({ version: cur + 1, data, note: note || null, created_at: new Date().toISOString() }); save(s); return { version: cur + 1 };
      }
    };
  }

  const api = MOCK ? mockApi() : realApi();

  // Spieldaten (Regeln, Typen, Attacken): aktuelle Version aus der Datenbank, sonst die Startwerte aus spieldaten.json
  let gameP = null;
  const gameData = () => (gameP ||= api.getGameData().catch(() => null)
    .then((g) => g || json('spieldaten.json').then((data) => ({ version: 0, data, note: 'Startwerte', created_at: null }))));
  if (MOCK) document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div'); b.className = 'mockbar';
    b.innerHTML = 'Testmodus mit Beispieldaten – nichts wird gespeichert. <a href="?mock=0">Beenden</a>';
    document.body.prepend(b);
  });

  window.Noerti = { ROOT, MOCK, api, config, types, esc, klasseChip, levelInfo, fmtDate, toast, sheet, closeSheet, errMsg, shrinkImage, gameData };
})();
