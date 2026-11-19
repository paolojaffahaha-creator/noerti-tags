/* Nörti Arena – Kampf-Engine (ohne Oberfläche). Regeln: 01 Konzept/Stats & Kampfsystem.md → "Kampfregeln v1".
   Alle Zahlen kommen aus den Spieldaten (Editor). Läuft im Browser (window.NoertiKampf) und in Node (Tests). */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const step5 = (c) => clamp(Math.round(c / 5) * 5, 5, 100);
  const need = (chance) => 21 - chance / 5;              // W20: 75 % → trifft bei 6+
  const d20 = (rng) => 1 + Math.floor(rng() * 20);
  const OTHER = { A: 'B', B: 'A' };

  // ---------- Figur aus Typ + Level ----------
  function figur(data, f) {
    const R = data.regeln, t = data.typen[f.type_id];
    if (!t) throw new Error(`Für ${f.name || f.type_id} gibt es noch keine Kampfwerte (Editor).`);
    const lv = clamp(f.level || 1, 1, 20);
    const bonus = Math.floor(Math.min(R.level_chance_max, Math.floor(lv / R.level_chance_alle)) / 5) * 5;
    const atk = [];
    if (t.standard) atk.push({ ...R.standard_attacke, ab: 1 });
    for (const a of t.attacken) {
      if ((a.ab || 1) > lv) continue;
      const x = { ...a, effekt: a.effekt ? { ...a.effekt } : null };
      if (lv >= 10 && a.stufe10) {
        for (const [k, v] of Object.entries(a.stufe10)) x[k] = k === 'effekt' ? { ...x.effekt, ...v } : v;
      }
      delete x.stufe10; atk.push(x);
    }
    const lpMax = Math.round(t.lp * (1 + R.level_lp_pct * (lv - 1) / 100));
    return {
      key: f.key, name: f.name, type_id: f.type_id, level: lv, img: f.img || null, owner: f.owner || null,
      lpMax, lp: lpMax, noerten: R.noerten_start, tempo: t.tempo, chanceBonus: bonus,
      schadenFaktor: 1 + R.level_schaden_pct * (lv - 1) / 100,
      attacken: atk.map((a) => ({ ...a, treffer: Math.max(1, a.treffer || 1) })),
      mods: { chanceMalus: 0, konter: 0, boost: 0, dodgeNext: 0, dodgeNow: 0, dotNext: 0, dotNow: 0 }, ko: false
    };
  }

  // ---------- Kampf anlegen ----------
  function neu(data, teamA, teamB) {
    const mk = (t) => ({ name: t.name, figs: t.figs.map((f) => figur(data, f)), active: 0 });
    const teams = { A: mk(teamA), B: mk(teamB) };
    const maxRunden = data.regeln.max_runden * Math.max(teams.A.figs.length, teams.B.figs.length);
    return { regeln: data.regeln, maxRunden, runde: 1, teams, over: false, winner: null, needSwitch: [], history: [] };
  }
  const aktiv = (s, side) => s.teams[side].figs[s.teams[side].active];
  const bank = (s, side) => s.teams[side].figs.map((f, i) => ({ f, i })).filter(({ f, i }) => !f.ko && i !== s.teams[side].active);

  // Welche Aktionen sind gerade möglich?
  function optionen(s, side) {
    const R = s.regeln, f = aktiv(s, side);
    return {
      attacken: f.attacken.map((a, i) => ({ i, a, ok: f.noerten >= a.kosten, chance: step5(a.chance + f.chanceBonus + f.mods.konter - f.mods.chanceMalus) })),
      verteidigen: f.noerten >= R.kosten_verteidigen,
      ausweichen: f.noerten >= R.kosten_ausweichen,
      auftanken: true,
      wechseln: bank(s, side).map(({ f: b, i }) => ({ i, name: b.name }))
    };
  }
  function gueltig(s, side, act) {
    const o = optionen(s, side);
    if (!act) return false;
    if (act.typ === 'angriff') return !!(o.attacken[act.i] && o.attacken[act.i].ok);
    if (act.typ === 'verteidigen') return o.verteidigen;
    if (act.typ === 'ausweichen') return o.ausweichen;
    if (act.typ === 'auftanken') return true;
    if (act.typ === 'wechseln') return o.wechseln.some((w) => w.i === act.i);
    return false;
  }

  // ---------- Eine Runde auswerten ----------
  function runde(s, actA, actB, rng = Math.random) {
    if (s.over) throw new Error('Kampf ist vorbei');
    if (s.needSwitch.length) throw new Error('Erst ausgeknockte Figur ersetzen');
    const R = s.regeln, act = { A: actA, B: actB }, ev = [];
    for (const side of ['A', 'B']) if (!gueltig(s, side, act[side])) throw new Error(`Ungültige Aktion für ${side}`);
    const push = (e) => { ev.push(e); return e; };
    const fi = (side) => s.teams[side].active;
    const nVal = (side, f, why) => push({ t: 'noerten', side, fi: s.teams[side].figs.indexOf(f), value: f.noerten, text: why });

    // Effekte aus der Vorrunde aktiv schalten
    for (const side of ['A', 'B']) for (const f of s.teams[side].figs) {
      f.mods.dodgeNow = f.mods.dodgeNext; f.mods.dodgeNext = 0;
      f.mods.dotNow = f.mods.dotNext; f.mods.dotNext = 0;
    }

    // 1. Kosten zahlen
    for (const side of ['A', 'B']) {
      const f = aktiv(s, side), a = act[side];
      const k = a.typ === 'angriff' ? f.attacken[a.i].kosten : a.typ === 'verteidigen' ? R.kosten_verteidigen : a.typ === 'ausweichen' ? R.kosten_ausweichen : 0;
      if (k) { f.noerten -= k; nVal(side, f, `${f.name}: −${k} Nörten`); }
    }
    // 2. Auswechseln passiert zuerst
    for (const side of ['A', 'B']) if (act[side].typ === 'wechseln') {
      const from = aktiv(s, side); s.teams[side].active = act[side].i;
      push({ t: 'wechsel', side, fi: act[side].i, text: `${from.name} geht raus, ${aktiv(s, side).name} kommt rein!` });
    }
    // 3. Angriffe
    const wasHit = { A: false, B: false }, attacked = { A: false, B: false };
    let order = ['A', 'B'].filter((x) => act[x].typ === 'angriff');
    if (order.length === 2) {
      const ta = aktiv(s, 'A').tempo, tb = aktiv(s, 'B').tempo;
      if (tb > ta || (tb === ta && rng() < 0.5)) order = ['B', 'A'];
      push({ t: 'info', text: `${aktiv(s, order[0]).name} ist schneller und greift zuerst an.` });
    }
    for (const X of order) {
      const Y = OTHER[X], fx = aktiv(s, X), fy = aktiv(s, Y), a = fx.attacken[act[X].i], yAct = act[Y].typ;
      if (fx.ko) { push({ t: 'info', text: `${fx.name} ist k.o. – der Angriff fällt aus.` }); continue; }
      push({ t: 'angriff', side: X, text: `${fx.name} setzt ${a.name} ein!` });
      let chance = step5(a.chance + fx.chanceBonus + fx.mods.konter - fx.mods.chanceMalus);
      fx.mods.konter = 0; fx.mods.chanceMalus = 0;
      const selfEffect = () => {
        const e = a.effekt; if (!e) return;
        if (e.art === 'heilen') { const h = Math.min(e.wert, fx.lpMax - fx.lp); fx.lp += h; push({ t: 'lp', side: X, fi: fi(X), value: fx.lp, text: `${fx.name} heilt ${h} LP.` }); }
        if (e.art === 'verstaerken') { fx.mods.boost = e.wert; push({ t: 'effekt', side: X, text: `${fx.name}s nächste Attacke macht +${e.wert} % Schaden.` }); }
        if (e.art === 'ausweichen') { fx.mods.dodgeNext = e.wert; push({ t: 'effekt', side: X, text: `${fx.name} weicht nächste Runde ${e.wert} % besser aus.` }); }
      };
      if (!(a.schaden > 0)) {                                   // Attacke ohne Schaden (Heilen, Verstärken …)
        let ok = true;
        if (chance < 100) { const r = d20(rng); ok = r >= need(chance); push({ t: 'wurf', side: X, label: a.name, chance, need: need(chance), roll: r, ok, text: ok ? 'Klappt!' : 'Daneben!' }); }
        if (ok) selfEffect();
        continue;
      }
      attacked[Y] = true;
      let factor = 1;
      if (yAct === 'ausweichen') {
        const dc = step5(clamp(R.ausweichen_basis + (fy.tempo - fx.tempo) * R.ausweichen_pro_tempo + fy.mods.dodgeNow + fy.chanceBonus, R.ausweichen_min, R.ausweichen_max));
        const r = d20(rng), ok = r >= need(dc);
        push({ t: 'wurf', side: Y, label: 'Ausweichen', chance: dc, need: need(dc), roll: r, ok, text: ok ? `${fy.name} weicht aus!` : `${fy.name} wird erwischt!` });
        if (ok) { fx.mods.boost = 0; selfEffect(); continue; }
        factor = R.getroffen_faktor;
      } else if (yAct === 'verteidigen') factor = R.verteidigen_faktor;
      else if (yAct === 'auftanken') factor = R.getroffen_faktor;
      const boost = 1 + (fx.mods.boost || 0) / 100; fx.mods.boost = 0;
      let hits = 0, total = 0;
      for (let h = 0; h < a.treffer; h++) {
        const r = chance >= 100 ? 20 : d20(rng), ok = chance >= 100 || r >= need(chance);
        push({ t: 'wurf', side: X, label: a.treffer > 1 ? `${a.name} ${h + 1}/${a.treffer}` : a.name, chance, need: need(chance), roll: r, ok, text: ok ? 'Treffer!' : 'Daneben!' });
        if (!ok) continue;
        hits++;
        const dmg = Math.max(1, Math.round(a.schaden * fx.schadenFaktor * boost * factor));
        total += dmg; fy.lp = Math.max(0, fy.lp - dmg);
        push({ t: 'lp', side: Y, fi: fi(Y), value: fy.lp, dmg, text: `${fy.name} verliert ${dmg} LP${factor > 1 ? ' (ungeschützt!)' : factor < 1 ? ' (geblockt)' : ''}.` });
        if (fy.lp <= 0) break;
      }
      selfEffect();
      if (!hits) continue;
      wasHit[Y] = true;
      const e = a.effekt;
      if (e && e.art === 'gegner_chance') { fy.mods.chanceMalus = e.wert; push({ t: 'effekt', side: Y, text: `${fy.name} ist unsicher: nächste Attacke −${e.wert} %.` }); }
      if (e && e.art === 'nachschaden') { fy.mods.dotNext += e.wert; push({ t: 'effekt', side: Y, text: `${fy.name} bekommt nächste Runde ${e.wert} Schaden extra.` }); }
      if (yAct === 'verteidigen' && fy.lp > 0) {
        fy.mods.konter = R.konter_treffer; fx.noerten = Math.max(0, fx.noerten - R.konter_noerten);
        push({ t: 'konter', side: Y, text: `Block! ${fy.name} kontert: nächste Attacke +${R.konter_treffer} %, ${fx.name} verliert ${R.konter_noerten} Nörten.` });
        nVal(X, fx, '');
      }
      if (fy.lp <= 0) { fy.ko = true; push({ t: 'ko', side: Y, fi: fi(Y), text: `${fy.name} ist k.o.!` }); }
    }
    // 4. Auftanken, verpuffte Aktionen
    for (const side of ['A', 'B']) {
      const f = aktiv(s, side), o = act[OTHER[side]].typ, a = act[side].typ;
      if (f.ko) continue;
      if (a === 'auftanken') {
        const amount = wasHit[side] ? R.auftanken_getroffen : o === 'verteidigen' ? R.auftanken_gegen_verteidigen : R.auftanken;
        const before = f.noerten; f.noerten = Math.min(R.noerten_start, f.noerten + amount);
        nVal(side, f, `${f.name} tankt auf: +${f.noerten - before} Nörten${wasHit[side] ? ' (gestört)' : o === 'verteidigen' ? ' (in Ruhe!)' : ''}.`);
      }
      if (a === 'verteidigen' && !attacked[side]) push({ t: 'info', side, text: `${f.name} verteidigt ins Leere.` });
      if (a === 'ausweichen' && !attacked[side]) push({ t: 'info', side, text: `${f.name} weicht ins Leere aus.` });
    }
    // 5. Nachschaden
    for (const side of ['A', 'B']) {
      const f = aktiv(s, side);
      if (f.ko || !f.mods.dotNow) continue;
      f.lp = Math.max(0, f.lp - f.mods.dotNow);
      push({ t: 'lp', side, fi: fi(side), value: f.lp, dmg: f.mods.dotNow, text: `${f.name} verliert ${f.mods.dotNow} LP Nachschaden.` });
      if (f.lp <= 0) { f.ko = true; push({ t: 'ko', side, fi: fi(side), text: `${f.name} ist k.o.!` }); }
    }
    for (const side of ['A', 'B']) for (const f of s.teams[side].figs) { f.mods.dodgeNow = 0; f.mods.dotNow = 0; }
    s.history.push({ runde: s.runde, A: actA, B: actB });
    s.runde++;
    pruefen(s, ev);
    return ev;
  }

  function pruefen(s, ev) {
    const alive = (side) => s.teams[side].figs.some((f) => !f.ko);
    const a = alive('A'), b = alive('B');
    if (!a || !b) { s.over = true; s.winner = a ? 'A' : b ? 'B' : null; s.grund = 'ko'; }
    else if (s.runde > s.maxRunden) {
      const pct = (side) => { const fs = s.teams[side].figs; return fs.reduce((x, f) => x + f.lp, 0) / fs.reduce((x, f) => x + f.lpMax, 0); };
      const pa = pct('A'), pb = pct('B');
      s.over = true; s.winner = pa > pb ? 'A' : pb > pa ? 'B' : null; s.grund = 'runden';
      ev.push({ t: 'info', text: `Rundenlimit erreicht – es zählen die übrigen Lebenspunkte.` });
    }
    s.needSwitch = s.over ? [] : ['A', 'B'].filter((side) => aktiv(s, side).ko);
    if (s.over) ev.push({ t: 'ende', winner: s.winner, text: s.winner ? `${s.teams[s.winner].name} gewinnt!` : 'Unentschieden!' });
  }

  // Ausgeknockte Figur ersetzen (kostenlos, am Rundenende)
  function ersetzen(s, side, i) {
    const f = s.teams[side].figs[i];
    if (!s.needSwitch.includes(side) || !f || f.ko) throw new Error('Ungültiger Wechsel');
    s.teams[side].active = i; s.needSwitch = s.needSwitch.filter((x) => x !== side);
  }

  // Zufalls-Spieler (für Tests und Probekämpfe)
  function zufall(s, side, rng = Math.random) {
    const o = optionen(s, side), list = [];
    o.attacken.filter((x) => x.ok).forEach((x) => list.push({ typ: 'angriff', i: x.i }, { typ: 'angriff', i: x.i }));
    if (o.verteidigen) list.push({ typ: 'verteidigen' });
    if (o.ausweichen) list.push({ typ: 'ausweichen' });
    list.push({ typ: 'auftanken' });
    if (o.wechseln.length && rng() < 0.3) list.push({ typ: 'wechseln', i: o.wechseln[0].i });
    return list[Math.floor(rng() * list.length)];
  }

  const api = { figur, neu, optionen, gueltig, runde, ersetzen, aktiv, bank, zufall, need, step5 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NoertiKampf = api;
})(typeof window !== 'undefined' ? window : globalThis);
