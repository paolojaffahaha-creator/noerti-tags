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
  // XP gesamt für Level 2 … 20 (Vorgabe; die Werkstatt kann sie unter regeln.xp_kurve ändern – gleiche Tabelle wie in der Datenbank)
  let XP_KURVE = [40, 90, 150, 220, 300, 390, 500, 630, 780, 950, 1140, 1360, 1610, 1890, 2200, 2540, 2920, 3340, 3800];
  const xpFuer = (level) => (level <= 1 ? 0 : XP_KURVE[Math.min(level, 20) - 2]);
  function levelInfo(xp, level) {
    if (level >= 20) return { pct: 100, text: `${xp} XP · Max-Level` };
    const lo = xpFuer(level), hi = xpFuer(level + 1);
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
      myProfile: () => rpc('my_profile'),
      chooseStarter: (pid) => rpc('choose_starter', { p_public_id: pid }),
      findPlayers: (q) => rpc('find_players', { p_q: q || '', p_limit: 10 }),
      playerCollection: (name) => rpc('player_collection', { p_name: name }),
      // Anmelden mit Name + PIN über die Edge Function name-login (die E-Mail bleibt auf dem Server)
      async loginName(name, pin) {
        const cfg = await config(), c = await sb();
        const r = await fetch(`${cfg.supabaseUrl}/functions/v1/name-login`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey }, body: JSON.stringify({ name, pin }) });
        let j = {}; try { j = await r.json(); } catch {}
        if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'Anmelden mit Name + PIN ist noch nicht eingerichtet' : 'Anmelden hat nicht geklappt'));
        const { error } = await c.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
        if (error) throw error;
      },
      async setPin(pin) { const { error } = await (await sb()).auth.updateUser({ password: pin }); if (error) throw error; },
      async resetPin(email) { const { error } = await (await sb()).auth.resetPasswordForEmail(email, { redirectTo: redirect }); if (error) throw error; },
      async onRecovery(cb) { (await sb()).auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') cb(); }); },
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
      reportMatch2: (m) => rpc('report_match2', { p_client_id: m.id, p_a: m.a, p_b: m.b, p_winner: m.winner, p_rounds: m.rounds, p_reason: m.reason, p_log: m.log, p_game_version: m.version, p_spieler: m.spieler || null }),
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
      me: { id: 'me', anonymous: true, email: null, name: 'Feigenkönig' }, names: { mo: 'Mo', leif: 'Leif' }, log: [], starter: { mo: 'BBBBBBBB' },
      figures: {
        AAAAAAAA: { serial: 'AAAAAAAA', public_id: 'p-a', type_id: '005', owner: 'me', nickname: 'DJ Feige', bio: 'Dreht immer auf Lautstärke 11.', images: [], xp: 600, level: 4, wins: 9, losses: 4, opponents: 7, owner_since: '2026-11-12T10:00:00Z' },
        BBBBBBBB: { serial: 'BBBBBBBB', public_id: 'p-b', type_id: '002', owner: 'mo', nickname: 'Kicki', bio: '', images: [], xp: 170, level: 3, wins: 5, losses: 2, opponents: 3, owner_since: '2026-10-29T10:00:00Z' },
        CCCCCCCC: { serial: 'CCCCCCCC', public_id: 'p-c', type_id: '001', owner: null, nickname: null, bio: null, images: [], xp: 0, level: 1, wins: 0, losses: 0, opponents: 0, owner_since: null },
        DDDDDDDD: { serial: 'DDDDDDDD', public_id: 'p-d', type_id: '003', owner: 'me', nickname: 'Schnecki', bio: '', images: [], xp: 1100, level: 6, wins: 12, losses: 3, opponents: 5, owner_since: '2026-11-01T10:00:00Z' },
        EEEEEEEE: { serial: 'EEEEEEEE', public_id: 'p-e', type_id: '004', owner: 'mo', nickname: null, bio: '', images: [], xp: 40, level: 2, wins: 1, losses: 1, opponents: 1, owner_since: '2026-11-10T10:00:00Z' },
        FFFFFFFF: { serial: 'FFFFFFFF', public_id: 'p-f', type_id: '001', owner: 'leif', nickname: 'Stinki', bio: '', images: [], xp: 160, level: 4, wins: 4, losses: 2, opponents: 2, owner_since: '2026-11-11T10:00:00Z' },
        GGGGGGGG: { serial: 'GGGGGGGG', public_id: 'p-g', type_id: '002', owner: 'leif', nickname: 'Zipfel', bio: '', images: [], xp: 60, level: 2, wins: 1, losses: 2, opponents: 2, owner_since: '2026-11-13T10:00:00Z' },
        HHHHHHHH: { serial: 'HHHHHHHH', public_id: 'p-h', type_id: '002', owner: null, nickname: null, bio: null, images: [], xp: 0, level: 1, wins: 0, losses: 0, opponents: 0, owner_since: null }
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
      is_mine: !!(s.me && f.owner === 'me'), wahlen: f.wahlen || {},
      starter: !!(f.owner && (s.starter || {})[f.owner] === f.serial),
      starter_von: (() => { const o = Object.entries(s.starter || {}).find(([, x]) => x === f.serial); return o ? (o[0] === 'me' ? s.me && s.me.name : s.names[o[0]]) : null; })()
    });
    const lvOf = (xp) => { let l = 1; while (l < 20 && xp >= xpFuer(l + 1)) l++; return l; };
    const ownerKey = (s, name) => { const k = (name || '').trim().toLowerCase(); if (s.me && s.me.name && s.me.name.toLowerCase() === k) return 'me'; return Object.keys(s.names).find((x) => s.names[x].toLowerCase() === k) || null; };
    const fail = (m) => { throw new Error(m); };
    return {
      async getFigure(serial) { await wait(); const s = load(); const f = s.figures[serial.toUpperCase()]; return f ? view(s, f) : null; },
      async me() { const s = load(); return s.me ? { ...s.me } : null; },
      async ensureUser() { const s = load(); if (!s.me) { s.me = { id: 'me', anonymous: true, email: null, name: null }; save(s); } },
      async setName(n) { const s = load(); if (!s.me) fail('Nicht angemeldet'); const v = n.trim();
        if (v.length < 2 || v.length > 16) fail('Name: 2–16 Zeichen, Buchstaben, Ziffern, Leerzeichen, . _ -');
        if (Object.values(s.names).some((x) => x.toLowerCase() === v.toLowerCase())) fail(`Der Name „${v}“ ist schon vergeben`);
        s.me.name = v; save(s); },
      async claim(serial) {
        await wait(); const s = load(); const f = s.figures[serial]; if (!s.me) fail('Nicht angemeldet'); if (!s.me.name) fail('Erst einen Spielernamen wählen');
        if (!f) fail('Figur nicht registriert');
        let extra = {};
        if (f.owner !== 'me') {
          const first = !Object.values(s.figures).some((x) => x.owner === 'me') && !s.log.some((l) => l.to === 'me') && !(s.starter || {}).me;
          s.log.push({ serial, from: f.owner, to: 'me', at: new Date().toISOString() }); f.owner = 'me'; f.owner_since = new Date().toISOString();
          if (first) { const lv = f.level; (s.starter ||= {}).me = serial; f.xp += 90; f.level = Math.max(f.level, lvOf(f.xp)); extra = { starter_neu: true, xp_gain: 90, level_before: lv }; }
        }
        save(s); return { ...view(s, f), ...extra };
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
      async myProfile() { const s = load(); if (!s.me) return null; const st = (s.starter || {}).me;
        return { name: s.me.name, starter: st ? s.figures[st].public_id : null, starter_waehlen: !st && Object.values(s.figures).some((x) => x.owner === 'me') }; },
      async chooseStarter(pid) {
        await wait(); const s = load(); if ((s.starter || {}).me) fail('Du hast schon einen Starter');
        const f = Object.values(s.figures).find((x) => x.public_id === pid && x.owner === 'me'); if (!f) fail('Nur eine Figur aus deiner Sammlung');
        const lv = f.level; (s.starter ||= {}).me = f.serial; f.xp += 90; f.level = Math.max(f.level, lvOf(f.xp)); save(s);
        return { ...view(s, f), starter_neu: true, xp_gain: 90, level_before: lv };
      },
      async findPlayers(q) { const s = load(), k = (q || '').trim().toLowerCase();
        const all = [...(s.me && s.me.name ? [['me', s.me.name]] : []), ...Object.entries(s.names)];
        return all.filter(([, n]) => n.toLowerCase().startsWith(k)).map(([o, name]) => ({ name, figuren: Object.values(s.figures).filter((f) => f.owner === o).length })); },
      async playerCollection(name) { await wait(); const s = load(), o = ownerKey(s, name); if (!o) return null;
        return { name: o === 'me' ? s.me.name : s.names[o], figuren: Object.values(s.figures).filter((f) => f.owner === o).map((f) => view(s, f)).sort((a, b) => b.level - a.level) }; },
      async loginName(name, pin) { await wait(); const s = load(), o = ownerKey(s, name); if (!o || String(pin).length < 6) fail('Name oder PIN stimmt nicht');
        if (o !== 'me') fail('Im Testmodus geht nur der eigene Name'); },
      async setPin(pin) { await wait(); if (String(pin).length < 6) fail('PIN: mindestens 6 Zeichen'); },
      async resetPin() { await wait(); },
      async onRecovery() {},
      async reportMatch2(m) {
        await wait(); const s = load(); s.matches ||= {}; s.met ||= [];
        if (s.matches[m.id]) return { again: true, figures: s.matches[m.id] };
        const res = (e) => { const f = e.s ? s.figures[e.s.toUpperCase()] : Object.values(s.figures).find((x) => x.public_id === e.p); if (!f) fail('Figur nicht registriert'); return { f, live: !!e.s }; };
        const T = { A: m.a.map(res), B: m.b.map(res) }, out = [];
        for (const side of ['A', 'B']) for (const { f, live } of T[side]) {
          const opp = T[side === 'A' ? 'B' : 'A'];
          const bonus = live && opp.some((o) => o.live && o.f.owner && f.owner && o.f.owner !== f.owner && !s.met.includes(f.serial + o.f.serial)) ? 20 : 0;
          const starter = !!(f.owner && (s.starter || {})[f.owner] === f.serial), faktor = (live ? 1 : 0.5) * (starter ? 2 : 1);
          const base = m.winner == null ? 20 : m.winner === side ? 30 : 10, gain = Math.round((base + bonus) * faktor), before = f.level;
          f.xp += gain; f.level = Math.max(f.level, lvOf(f.xp));
          if (m.winner === side) f.wins++; else if (m.winner) f.losses++;
          if (live) opp.filter((o) => o.live).forEach((o) => s.met.push(f.serial + o.f.serial));
          out.push({ public_id: f.public_id, side, rated: true, xp_gain: gain, base, bonus, live, starter, faktor, level_before: before, level: f.level, xp: f.xp });
        }
        const sp = m.spieler || {}; (s.duelle ||= []).push({ A: (sp.A || '').toLowerCase(), B: (sp.B || '').toLowerCase(), w: m.winner });
        let bilanz = null;
        if (sp.A && sp.B && sp.A.toLowerCase() !== sp.B.toLowerCase()) {
          const a = sp.A.toLowerCase(), b = sp.B.toLowerCase(), ds = s.duelle.filter((d) => (d.A === a && d.B === b) || (d.A === b && d.B === a));
          bilanz = { A: ds.filter((d) => (d.A === a && d.w === 'A') || (d.B === a && d.w === 'B')).length, B: ds.filter((d) => (d.A === b && d.w === 'A') || (d.B === b && d.w === 'B')).length, u: ds.filter((d) => !d.w).length };
        }
        s.matches[m.id] = out; (s.kaempfe ||= []).push({ at: new Date().toISOString(), winner: m.winner, A: T.A.filter((x) => x.live).map((x) => x.f.serial), B: T.B.filter((x) => x.live).map((x) => x.f.serial) });
        save(s); return { again: false, figures: out, bilanz };
      },
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
      : json('spieldaten.json').then((data) => ({ version: g ? g.version : 0, data, note: 'Startwerte', created_at: null, stale: !!g }))))
    .then((g) => { const k = g && g.data && g.data.regeln && g.data.regeln.xp_kurve; if (Array.isArray(k) && k.length === 19) XP_KURVE = k.map(Number); return g; }));
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
      l.spieler ||= { A: null, B: null };     // wer auf welcher Seite kämpft (Spielername) – steuert, welche Sammlung zur Auswahl steht
      return l;
    },
    save(l) { l.at = Date.now(); try { localStorage.setItem(LOBBY, JSON.stringify(l)); } catch {} },
    clear() { try { localStorage.removeItem(LOBBY); } catch {} },
    // Figur in die Aufstellung: gewünschtes Team, sonst das Team ihres Besitzers, sonst das erste mit freiem Platz.
    // Gescannt (live) und die Seite hat noch keinen Spieler → der Besitzer wird Spieler dieser Seite. Gibt das Team zurück oder null (voll).
    add(entry) {
      const l = lobby.load(), key = (e) => e.public_id || e.serial;
      for (const side of ['A', 'B']) {
        const old = l[side].find((e) => key(e) === key(entry));
        if (old) { if (entry.live) { Object.assign(old, entry); lobby.save(l); } return side; }   // nochmal gescannt → jetzt live
      }
      const own = ['A', 'B'].find((x) => entry.owner_name && (l.spieler[x] || '').toLowerCase() === entry.owner_name.toLowerCase());
      const order = l.want ? [l.want, l.want === 'A' ? 'B' : 'A'] : own ? [own, own === 'A' ? 'B' : 'A'] : ['A', 'B'];
      const side = order.find((x) => l[x].length < l.size);
      if (!side) return null;
      if (entry.live && entry.owner_name && !l.spieler[side] && !['A', 'B'].some((x) => (l.spieler[x] || '').toLowerCase() === entry.owner_name.toLowerCase())) l.spieler[side] = entry.owner_name;
      l[side].push(entry); l.want = null; lobby.save(l); return side;
    }
  };
  const LIVE_TTL = 2 * 3600 * 1000;      // so lange gilt ein Scan als „live“ (doppelte XP, Freundebuch)
  const isLive = (e) => !!(e && e.live && e.serial && Date.now() - (e.liveAt || 0) < LIVE_TTL);

  window.Noerti = { ROOT, MOCK, api, config, types, esc, klasseChip, levelInfo, xpFuer, fmtDate, toast, sheet, closeSheet, errMsg, shrinkImage, gameData, lobby, isLive, LIVE_TTL, stdImages, figImage };
})();
