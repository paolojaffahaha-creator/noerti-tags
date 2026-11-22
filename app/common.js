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
  // Typ-Namen: ein Name aus dem Editor (Spieldaten) überschreibt figuren.json
  const types = () => (typesP ||= Promise.all([json('figuren.json'), gameData().catch(() => null)]).then(([d, g]) => {
    const t = (g && g.data && g.data.typen) || {};
    return (d.figuren || []).map((x) => (t[x.id] && t[x.id].name ? { ...x, name: t[x.id].name } : x));
  }));

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
      saveGameData: (data, pin, base, note) => rpc('save_game_data', { p_data: data, p_pin: pin, p_base: base, p_note: note || null }),
      chooseReward: (serial, level, option) => rpc('choose_reward', { p_serial: serial, p_level: level, p_option: option }),
      reportMatch: (m) => rpc('report_match', { p_client_id: m.id, p_a: m.a, p_b: m.b, p_winner: m.winner, p_rounds: m.rounds, p_reason: m.reason, p_log: m.log, p_game_version: m.version }),
      leaderboard: (n) => rpc('leaderboard', { p_limit: n || 20 }),
      getFigureById: (pid) => rpc('get_figure_by_id', { p_public_id: pid }),
      friendBook: (pid) => rpc('friend_book', { p_public_id: pid }),
      // Standardbilder (Nachtrag 007)
      typeImages: () => rpc('type_images'),
      async typeImageUrl(file, v) {
        const c = await config();
        return `${c.supabaseUrl}/storage/v1/object/public/typ-bilder/${file}?v=${encodeURIComponent(v || '')}`;
      },
      async uploadTypeImage(typeId, blob, transparent, pin) {
        const c = await sb();
        let { data: { session } } = await c.auth.getSession();
        if (!session) { const { error } = await c.auth.signInAnonymously(); if (error) throw error; }
        await rpc('become_admin', { p_pin: pin });
        const ext = blob.type === 'image/png' ? 'png' : 'webp', file = `${typeId}.${ext}`;
        const { error } = await c.storage.from('typ-bilder').upload(file, blob, { upsert: true, contentType: blob.type, cacheControl: '300' });
        if (error) throw error;
        const old = ext === 'png' ? `${typeId}.webp` : `${typeId}.png`;
        await c.storage.from('typ-bilder').remove([old]).catch(() => {});
        return rpc('set_type_image', { p_type: typeId, p_file: file, p_transparent: !!transparent });
      },
      async removeTypeImage(typeId, pin) {
        const c = await sb();
        let { data: { session } } = await c.auth.getSession();
        if (!session) { const { error } = await c.auth.signInAnonymously(); if (error) throw error; }
        await rpc('become_admin', { p_pin: pin });
        await c.storage.from('typ-bilder').remove([`${typeId}.webp`, `${typeId}.png`]).catch(() => {});
        return rpc('remove_type_image', { p_type: typeId });
      }
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
        CCCCCCCC: { serial: 'CCCCCCCC', public_id: 'p-c', type_id: '001', owner: null, nickname: null, bio: null, images: [], xp: 0, level: 1, wins: 0, losses: 0, opponents: 0, owner_since: null },
        DDDDDDDD: { serial: 'DDDDDDDD', public_id: 'p-d', type_id: '003', owner: 'me', nickname: 'Schnecki', bio: '', images: [], xp: 1100, level: 6, wins: 12, losses: 3, opponents: 5, owner_since: '2026-11-01T10:00:00Z' },
        EEEEEEEE: { serial: 'EEEEEEEE', public_id: 'p-e', type_id: '004', owner: 'mo', nickname: null, bio: '', images: [], xp: 40, level: 2, wins: 1, losses: 1, opponents: 1, owner_since: '2026-11-10T10:00:00Z' }
      }, blobs: {},
      // Beispiel-Kämpfe fürs Freundebuch
      kaempfe: [
        { at: '2026-11-14T18:00:00Z', winner: 'A', A: ['AAAAAAAA'], B: ['BBBBBBBB'] },
        { at: '2026-11-16T19:30:00Z', winner: 'B', A: ['AAAAAAAA', 'DDDDDDDD'], B: ['BBBBBBBB', 'EEEEEEEE'] },
        { at: '2026-11-18T20:10:00Z', winner: null, A: ['DDDDDDDD'], B: ['AAAAAAAA'] }
      ]
    });
    const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
    const save = (s) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
    const wait = () => new Promise((r) => setTimeout(r, 200));
    const view = (s, f) => ({
      public_id: f.public_id, type_id: f.type_id, nickname: f.nickname, bio: f.bio, images: f.images, xp: f.xp, level: f.level,
      wins: f.wins, losses: f.losses, opponents: f.opponents, owner_since: f.owner_since, updated_at: f.updated_at || 'x',
      owner_name: f.owner === 'me' ? (s.me && s.me.name) : f.owner ? s.names[f.owner] : null,
      is_mine: !!(s.me && f.owner === 'me'), wahlen: f.wahlen || {}
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
      },
      async chooseReward(serial, level, option) {
        await wait(); const s = load(); const f = s.figures[serial.toUpperCase()]; if (!f) fail('Figur nicht registriert');
        if (level < 2 || level > f.level) fail(`Level ${level} ist noch nicht erreicht`);
        f.wahlen ||= {}; if (f.wahlen[level] != null) fail(`Für Level ${level} wurde schon gewählt`);
        f.wahlen[level] = option; save(s); return view(s, f);
      },
      async reportMatch(m) {
        await wait(); const s = load(); s.matches ||= {}; s.met ||= [];
        if (s.matches[m.id]) return { again: true, figures: s.matches[m.id] };
        const out = [];
        for (const side of ['A', 'B']) for (const serial of m[side.toLowerCase()]) {
          const f = s.figures[serial]; if (!f) fail('Figur nicht registriert');
          const opp = m[side === 'A' ? 'b' : 'a'];
          const bonus = opp.some((o) => s.figures[o].owner && f.owner && s.figures[o].owner !== f.owner && !s.met.includes(serial + o)) ? 20 : 0;
          const gain = (m.winner == null ? 20 : m.winner === side ? 30 : 10) + bonus, before = f.level;
          f.xp += gain; f.level = Math.min(20, 1 + Math.floor(Math.sqrt(f.xp / 40)));
          if (m.winner === side) f.wins++; else if (m.winner) f.losses++;
          opp.forEach((o) => s.met.push(serial + o));
          out.push({ public_id: f.public_id, side, rated: true, xp_gain: gain, bonus, level_before: before, level: f.level, xp: f.xp });
        }
        s.matches[m.id] = out; (s.kaempfe ||= []).push({ at: new Date().toISOString(), winner: m.winner, A: m.a, B: m.b }); save(s); return { again: false, figures: out };
      },
      async leaderboard() { const s = load(); return Object.values(s.figures).map((f) => view(s, f)).sort((a, b) => b.level - a.level || b.xp - a.xp || b.wins - a.wins); },
      async getFigureById(pid) { await wait(); const s = load(); const f = Object.values(s.figures).find((x) => x.public_id === pid); return f ? view(s, f) : null; },
      async friendBook(pid) {
        await wait(); const s = load(); const me = Object.values(s.figures).find((x) => x.public_id === pid); if (!me) return null;
        const agg = {};
        for (const k of s.kaempfe || []) {
          const side = k.A.includes(me.serial) ? 'A' : k.B.includes(me.serial) ? 'B' : null; if (!side) continue;
          for (const o of [...k.A, ...k.B]) {
            if (o === me.serial) continue;
            const g = !k[side].includes(o), a = (agg[o] ||= { erstes: k.at, zuletzt: k.at, als_gegner: 0, als_team: 0, siege: 0, niederlagen: 0, unentschieden: 0 });
            a.erstes = a.erstes < k.at ? a.erstes : k.at; a.zuletzt = a.zuletzt > k.at ? a.zuletzt : k.at;
            if (g) { a.als_gegner++; if (k.winner == null) a.unentschieden++; else if (k.winner === side) a.siege++; else a.niederlagen++; } else a.als_team++;
          }
        }
        const freunde = Object.entries(agg).map(([serial, a]) => { const f = s.figures[serial], v = view(s, f);
          return { public_id: f.public_id, type_id: f.type_id, nickname: f.nickname, images: f.images, updated_at: v.updated_at, level: f.level, owner_name: v.owner_name,
            gleicher_besitzer: !!(me.owner && f.owner === me.owner), ...a }; }).sort((x, y) => y.zuletzt.localeCompare(x.zuletzt));
        return { freunde, typen: [...new Set(freunde.map((f) => f.type_id))] };
      },
      // Ohne eigenen Upload im Testmodus: vier mitgelieferte Beispielbilder (mock/NNN.png, Zuordnung zu Typen nur zum Testen)
      async typeImages() {
        const s = load(), own = Object.entries(s.typImg || {}).map(([type_id, x]) => ({ type_id, file: x.file, transparent: x.transparent, updated_at: x.at }));
        const demo = ['001', '002', '003', '005'].filter((t) => !(s.typImg || {})[t]).map((t) => ({ type_id: t, file: `${t}.png`, transparent: true, updated_at: 'demo', demo: true }));
        return [...own, ...demo];
      },
      async typeImageUrl(file, v) { const s = load(); const x = Object.values(s.typImg || {}).find((y) => y.file === file); return x ? x.url : v === 'demo' ? ROOT + 'mock/' + file : ''; },
      async uploadTypeImage(typeId, blob, transparent, pin) {
        await wait(); if (!pin) fail('Falsche PIN');
        const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        const s = load(); (s.typImg ||= {})[typeId] = { file: `${typeId}.${blob.type === 'image/png' ? 'png' : 'webp'}`, transparent: !!transparent, url, at: new Date().toISOString() }; save(s);
        return this.typeImages();
      },
      async removeTypeImage(typeId, pin) { if (!pin) fail('Falsche PIN'); const s = load(); delete (s.typImg || {})[typeId]; save(s); return this.typeImages(); }
    };
  }

  const api = MOCK ? mockApi() : realApi();

  // Spieldaten (Regeln, Typen, Attacken): aktuelle Version aus der Datenbank, sonst die Startwerte aus spieldaten.json
  let gameP = null;
  // Ältere Versionen (format 1, Kampfsystem v1) passen nicht mehr zur Engine → dann gelten die Startwerte, bis im Editor neu gespeichert wird.
  const gameData = () => (gameP ||= api.getGameData().catch(() => null)
    .then((g) => (g && g.data && g.data.format >= 2 ? g
      : json('spieldaten.json').then((data) => ({ version: g ? g.version : 0, data, note: 'Startwerte', created_at: null, stale: !!g })))));
  if (MOCK) document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div'); b.className = 'mockbar';
    b.innerHTML = 'Testmodus mit Beispieldaten – nichts wird gespeichert. <a href="?mock=0">Beenden</a>';
    document.body.prepend(b);
  });

  // Standardbilder pro Typ (Nachtrag 007): { type_id: { url, transparent } } – fehlt der Nachtrag, einfach leer
  let stdP = null;
  const stdImages = (fresh) => ((fresh || !stdP) ? (stdP = api.typeImages().catch(() => [])
    .then(async (list) => { const m = {}; for (const x of list || []) m[x.type_id] = { url: await api.typeImageUrl(x.file, x.updated_at), transparent: !!x.transparent, file: x.file }; return m; })) : stdP);
  // Hauptbild einer Figur: eigenes Foto (das erste), sonst das Standardbild des Typs
  async function figImage(f) {
    if (f.images && f.images.length) {
      const url = await api.imageUrl(f.public_id, f.images.slice().sort()[0], f.updated_at);
      if (url) return { url, own: true, transparent: false };
    }
    const s = (await stdImages())[f.type_id];
    return s ? { url: s.url, own: false, transparent: s.transparent } : { url: '', own: false, transparent: false };
  }

  // Arena-Aufstellung: liegt nur in diesem Browser, verfällt nach 30 min ohne Änderung.
  // Die Seriennummer bleibt hier lokal (sie wird später zum Melden des Ergebnisses gebraucht), angezeigt wird sie nie.
  const LOBBY = 'noerti-arena-lobby', LOBBY_TTL = 30 * 60 * 1000;
  const lobby = {
    load() {
      let l = null; try { l = JSON.parse(localStorage.getItem(LOBBY)); } catch {}
      if (!l || Date.now() - l.at > LOBBY_TTL) l = { at: Date.now(), size: 1, want: null, names: { A: '', B: '' }, A: [], B: [], lp: null, noerten: null };
      return l;
    },
    save(l) { l.at = Date.now(); try { localStorage.setItem(LOBBY, JSON.stringify(l)); } catch {} },
    clear() { try { localStorage.removeItem(LOBBY); } catch {} },
    // Figur in die Aufstellung: gewünschtes Team, sonst das erste mit freiem Platz. Gibt das Team zurück oder null (voll).
    add(entry) {
      const l = lobby.load();
      for (const side of ['A', 'B']) if (l[side].some((e) => e.serial === entry.serial)) return side;
      const order = l.want ? [l.want, l.want === 'A' ? 'B' : 'A'] : ['A', 'B'];
      const side = order.find((x) => l[x].length < l.size);
      if (!side) return null;
      l[side].push(entry); l.want = null; lobby.save(l); return side;
    }
  };

  window.Noerti = { ROOT, MOCK, api, config, types, esc, klasseChip, levelInfo, fmtDate, toast, sheet, closeSheet, errMsg, shrinkImage, gameData, lobby, stdImages, figImage };
})();
