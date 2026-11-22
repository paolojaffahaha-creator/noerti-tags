/* Nörti Arena – Kampf-Engine v2 (ohne Oberfläche). Regeln: 01 Konzept/Stats & Kampfsystem.md → "Kampfsystem v2".
   Jede Figur hat eigene Aktionen in vier Kategorien. Der Kreislauf Angriff > Auftanken > Verteidigung > Angriff gilt für die Kategorie,
   die Aktion liefert die Zahlen (Würfe, Chance, Ausgänge, Effekte, Sonderregeln). Leveln läuft nur über den Level-Pfad des Typs.
   Alle Zahlen kommen aus den Spieldaten (Editor, format 2). Läuft im Browser (window.NoertiKampf) und in Node (Tests). */
(function (root) {
  'use strict';
  const FORMAT = 2;
  const KAT = ['angriff', 'verteidigung', 'ausweichen', 'auftanken'];
  const MAX_PRO_KAT = 3;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const step5 = (c) => clamp(Math.round(c / 5) * 5, 5, 100);
  const need = (chance) => 21 - chance / 5;              // W20: 75 % → trifft bei 6+
  const d20 = (rng) => 1 + Math.floor(rng() * 20);
  const OTHER = { A: 'B', B: 'A' };
  const copy = (o) => JSON.parse(JSON.stringify(o));

  // ---------- Texte (für Oberfläche und Ereignisse) ----------
  const FX = {
    chance:     { name: 'Trefferchance', text: (w) => `Trefferchance ${w > 0 ? '+' : '−'}${Math.abs(w)} %` },
    schaden:    { name: 'Schaden', text: (w) => `Schaden ${w > 0 ? '+' : '−'}${Math.abs(w)} %` },
    ausweichen: { name: 'Ausweichen', text: (w) => `Ausweichen ${w > 0 ? '+' : '−'}${Math.abs(w)} %` },
    schutz:     { name: 'Schutz', text: (w) => `${w} % weniger Schaden` },
    tempo:      { name: 'Tempo', text: (w) => `Tempo ${w > 0 ? '+' : '−'}${Math.abs(w)}` },
    gift:       { name: 'Nachschaden', text: (w) => `${w} Schaden pro Runde` },
    regen:      { name: 'Heilung pro Runde', text: (w) => `+${w} LP pro Runde` },
    tank:       { name: 'Nörten pro Runde', text: (w) => `+${w} Nörten pro Runde` },
    heilen:     { name: 'Heilen (sofort)', sofort: true, text: (w) => `heilt ${w} LP` },
    noerten:    { name: 'Nörten (sofort)', sofort: true, text: (w) => `${w > 0 ? '+' : '−'}${Math.abs(w)} Nörten` }
  };
  const fxText = (e) => {
    const d = FX[e.art]; if (!d) return '';
    const r = e.runden || 1;
    return d.text(e.wert) + (d.sofort ? '' : r > 1 ? ` (${r} Runden)` : ' (nächste Runde)');
  };

  // ---------- Level-Pfad ----------
  // pfad: { "<level>": [option, …] } – eine Option = fest, mehrere = der Besitzer wählt (figures.wahlen = { "<level>": index }).
  function ausbau(data, typeId, level, wahlen) {
    const t = data.typen[typeId];
    if (!t) throw new Error(`Für Typ ${typeId} gibt es noch keine Kampfwerte (Editor).`);
    const lv = clamp(level || 1, 1, 20);
    const b = { lpF: t.lp_faktor ?? 1, noF: t.noerten_faktor ?? 1, tempo: t.tempo ?? 5,
      gelernt: (t.aktionen || []).filter((a) => a.start).map((a) => a.id), verb: [], optik: [], offen: [], erhalten: [] };
    for (let l = 2; l <= lv; l++) {
      const opts = (t.pfad || {})[l];
      if (!opts || !opts.length) continue;
      let o;
      if (opts.length === 1) o = opts[0];
      else {
        const w = wahlen ? wahlen[l] ?? wahlen[String(l)] : null;
        if (w == null || !opts[w]) { b.offen.push(l); continue; }
        o = opts[w];
      }
      b.erhalten.push({ level: l, o });
      if (o.art === 'lp_faktor') b.lpF += o.wert;
      else if (o.art === 'noerten_faktor') b.noF += o.wert;
      else if (o.art === 'tempo') b.tempo += o.wert;
      else if (o.art === 'lernt') { if (!b.gelernt.includes(o.aktion)) b.gelernt.push(o.aktion); }
      else if (o.art === 'verbessern') b.verb.push(o);
      else if (o.art === 'optik') b.optik.push(o.text);
    }
    b.lpF = Math.max(0.1, b.lpF); b.noF = Math.max(0.1, b.noF); b.tempo = clamp(b.tempo, 1, 15);
    return b;
  }
  const WERT = { angriff: 'Schaden', verteidigung: 'Schutz', ausweichen: 'Wert', auftanken: 'Ertrag' };
  const FELD = { chance: 'Chance', kosten: 'Kosten', n: 'Würfe', effekt: 'Effekt' };
  function optionText(t, o) {
    const akt = (id) => (t.aktionen || []).find((a) => a.id === id) || {};
    const sg = (w) => (w > 0 ? '+' : '−') + String(Math.abs(Math.round(w * 100) / 100)).replace('.', ',');
    if (o.art === 'lp_faktor') return `Lebenspunkte ${sg(o.wert * 100)} %`;
    if (o.art === 'noerten_faktor') return `Nörten ${sg(o.wert * 100)} %`;
    if (o.art === 'tempo') return `Tempo ${sg(o.wert)}`;
    if (o.art === 'lernt') return `lernt ${akt(o.aktion).name || o.aktion}`;
    if (o.art === 'verbessern') {
      const a = o.aktion ? akt(o.aktion) : null, kat = a ? a.kat : o.kat;
      const wer = a ? a.name || o.aktion : `alle ${KAT_NAME[o.kat] || o.kat}`;
      const feld = o.feld === 'wert' ? WERT[kat] || 'Wert' : FELD[o.feld] || o.feld;
      const unit = o.feld === 'chance' || (o.feld === 'wert' && kat === 'verteidigung' && !(a && a.sonder && a.sonder.schild)) ? ' %' : '';
      return `${wer}: ${feld} ${sg(o.wert)}${unit}`;
    }
    if (o.art === 'optik') return o.text || 'Optik';
    return '?';
  }
  const KAT_NAME = { angriff: 'Angriffe', verteidigung: 'Verteidigungen', ausweichen: 'Ausweichen', auftanken: 'Auftanken' };

  // Aktion mit allen Verbesserungen aus dem Pfad
  function aktionBauen(a, verb) {
    const x = copy(a);
    x.wuerfe = { art: 'einfach', n: 1, chance: 100, ...(x.wuerfe || {}) };
    if (!x.ausgaenge || !x.ausgaenge.length) x.ausgaenge = [{ anteil: 100, wert: 0 }];
    x.effekte ||= []; x.sonder ||= {}; x.kosten = x.kosten || 0;
    for (const v of verb || []) {
      if (v.aktion ? v.aktion !== a.id : v.kat !== a.kat) continue;
      if (v.feld === 'chance') x.wuerfe.chance += v.wert;
      else if (v.feld === 'wert') x.ausgaenge.forEach((o) => { if (o.wert > 0 || x.ausgaenge.length === 1) o.wert += v.wert; });
      else if (v.feld === 'kosten') x.kosten = Math.max(0, x.kosten + v.wert);
      else if (v.feld === 'n') { x.wuerfe.n = clamp((x.wuerfe.n || 1) + v.wert, 1, 8); if (x.wuerfe.bis) x.wuerfe.bis = clamp(x.wuerfe.bis + v.wert, 1, 8); }
      else if (v.feld === 'effekt') x.effekte.forEach((e) => { if (!e.wert) return; e.wert += Math.sign(e.wert) * v.wert; });
    }
    x.wuerfe.chance = step5(x.wuerfe.chance);
    if (x.kat === 'verteidigung' && !x.sonder.schild) x.ausgaenge.forEach((o) => { o.wert = clamp(o.wert, 0, 100); });
    return x;
  }
  const NOTTANK = { id: '_durchschnaufen', kat: 'auftanken', name: 'Durchschnaufen', start: true, kosten: 0, wuerfe: { art: 'einfach', chance: 100 }, ausgaenge: [{ anteil: 100, wert: 15 }] };

  // ---------- Figur aus Typ + Level + Wahlen ----------
  function figur(data, f, opts = {}) {
    const R = data.regeln, t = data.typen[f.type_id];
    if (!t) throw new Error(`Für ${f.name || f.type_id} gibt es noch keine Kampfwerte (Editor).`);
    const b = ausbau(data, f.type_id, f.level, f.wahlen);
    const proKat = {};
    const aktionen = [];
    for (const id of b.gelernt) {
      const a = (t.aktionen || []).find((x) => x.id === id);
      if (!a || !KAT.includes(a.kat)) continue;
      proKat[a.kat] = (proKat[a.kat] || 0) + 1;
      if (proKat[a.kat] > MAX_PRO_KAT) continue;
      aktionen.push(aktionBauen(a, b.verb));
    }
    if (!aktionen.some((a) => a.kat === 'auftanken')) aktionen.push(aktionBauen(NOTTANK, []));
    aktionen.sort((x, y) => KAT.indexOf(x.kat) - KAT.indexOf(y.kat));
    const lpBasis = opts.lp ?? standard(R, 'kampf_lp'), noBasis = opts.noerten ?? standard(R, 'kampf_noerten');
    const lpMax = Math.max(1, Math.round(lpBasis * b.lpF)), noMax = Math.max(10, Math.round(noBasis * b.noF));
    return {
      key: f.key, name: f.name, type_id: f.type_id, level: clamp(f.level || 1, 1, 20), img: f.img || null, owner: f.owner || null,
      lpMax, lp: lpMax, noertenMax: noMax, noerten: noMax, tempo: b.tempo, aktionen, fx: [], ko: false, offen: b.offen.length
    };
  }
  const standard = (R, k) => { const l = R[k] || [{ wert: 100 }]; return (l[R.kampf_standard ?? 1] || l[0]).wert; };

  // ---------- Kampf anlegen ----------
  // opts: { lp: Grundwert LP, noerten: Grundwert Nörten } – vor dem Kampf gewählt, jede Figur multipliziert mit ihrem Faktor
  function neu(data, teamA, teamB, opts = {}) {
    if ((data.format || 1) < FORMAT) throw new Error('Spieldaten sind noch im alten Format – bitte im Editor neu speichern.');
    const o = { lp: opts.lp ?? standard(data.regeln, 'kampf_lp'), noerten: opts.noerten ?? standard(data.regeln, 'kampf_noerten') };
    const mk = (t) => ({ name: t.name, figs: t.figs.map((f) => figur(data, f, o)), active: 0 });
    const teams = { A: mk(teamA), B: mk(teamB) };
    const maxRunden = data.regeln.max_runden * Math.max(teams.A.figs.length, teams.B.figs.length);
    return { regeln: data.regeln, opts: o, maxRunden, runde: 1, teams, over: false, winner: null, needSwitch: [], history: [] };
  }
  const aktiv = (s, side) => s.teams[side].figs[s.teams[side].active];
  const bank = (s, side) => s.teams[side].figs.map((f, i) => ({ f, i })).filter(({ f, i }) => !f.ko && i !== s.teams[side].active);

  // aktive Effekte einer Figur in dieser Runde
  const mod = (s, f, art) => f.fx.reduce((x, e) => x + (e.art === art && e.von <= s.runde && s.runde <= e.bis ? e.wert : 0), 0);
  const tempoVon = (s, f) => f.tempo + mod(s, f, 'tempo');
  const schadet = (a) => a.kat === 'angriff' && a.ausgaenge.some((o) => o.wert > 0);
  const trefferChance = (s, f, a) => (a.wuerfe.chance >= 100 && !mod(s, f, 'chance') ? 100 : step5(a.wuerfe.chance + (a.kat === 'angriff' ? mod(s, f, 'chance') : 0)));
  function ausweichChance(s, fy, a, fx) {
    const R = s.regeln;
    const tempo = a.sonder.fest || !fx ? 0 : (tempoVon(s, fy) - tempoVon(s, fx)) * R.ausweichen_pro_tempo;
    const c = a.wuerfe.chance + tempo + mod(s, fy, 'ausweichen');
    return step5(a.sonder.fest ? clamp(c, 5, 95) : clamp(c, R.ausweichen_min, R.ausweichen_max));
  }

  // Welche Aktionen sind gerade möglich?
  function optionen(s, side) {
    const f = aktiv(s, side), opp = aktiv(s, OTHER[side]);
    return {
      aktionen: f.aktionen.map((a, i) => ({ i, a, ok: f.noerten >= a.kosten,
        chance: a.kat === 'ausweichen' ? ausweichChance(s, f, a, opp) : trefferChance(s, f, a) })),
      wechseln: bank(s, side).map(({ f: b, i }) => ({ i, name: b.name }))
    };
  }
  function gueltig(s, side, act) {
    if (!act) return false;
    const o = optionen(s, side);
    if (act.typ === 'aktion') return !!(o.aktionen[act.i] && o.aktionen[act.i].ok);
    if (act.typ === 'wechseln') return o.wechseln.some((w) => w.i === act.i);
    return false;
  }

  // ---------- Würfel-Helfer ----------
  function rad(a, rng) {                    // Glücksrad: Ausgang nach Anteil
    const o = a.ausgaenge;
    if (o.length === 1) return { i: 0, wert: o[0].wert };
    const tot = o.reduce((x, y) => x + Math.max(0, y.anteil), 0) || 1;
    let r = rng() * tot;
    for (let i = 0; i < o.length; i++) { r -= Math.max(0, o[i].anteil); if (r < 0) return { i, wert: o[i].wert }; }
    return { i: o.length - 1, wert: o[o.length - 1].wert };
  }
  function anzahl(a, rng) {                 // wie oft gewürfelt wird (Kette: Höchstzahl)
    const w = a.wuerfe;
    if (w.art === 'mehrfach' || w.art === 'kette') return clamp(w.n || 1, 1, 8);
    if (w.art === 'zufall') { const lo = clamp(w.n || 1, 1, 8), hi = clamp(Math.max(w.bis || lo, lo), 1, 8); return lo + Math.floor(rng() * (hi - lo + 1)); }
    return 1;
  }

  // ---------- Eine Runde auswerten ----------
  function runde(s, actA, actB, rng = Math.random) {
    if (s.over) throw new Error('Kampf ist vorbei');
    if (s.needSwitch.length) throw new Error('Erst ausgeknockte Figur ersetzen');
    const R = s.regeln, act = { A: actA, B: actB }, ev = [];
    for (const side of ['A', 'B']) if (!gueltig(s, side, act[side])) throw new Error(`Ungültige Aktion für ${side}`);
    const push = (e) => { ev.push(e); return e; };
    const fi = (side) => s.teams[side].active;
    const idx = (side, f) => s.teams[side].figs.indexOf(f);
    const nVal = (side, f, why) => push({ t: 'noerten', side, fi: idx(side, f), value: f.noerten, text: why });
    const lpVal = (side, f, text, dmg) => push({ t: 'lp', side, fi: idx(side, f), value: f.lp, dmg, text });
    const ko = (side, f) => { if (f.lp <= 0 && !f.ko) { f.lp = 0; f.ko = true; push({ t: 'ko', side, fi: idx(side, f), text: `${f.name} ist k.o.!` }); } };
    const wurf = (side, a, chance, label, okText, failText) => {
      if (chance >= 100) return true;
      const r = d20(rng), ok = r >= need(chance);
      push({ t: 'wurf', side, kat: a.kat, label: label || a.name, chance, need: need(chance), roll: r, ok, text: ok ? okText : failText });
      return ok;
    };
    const radWurf = (side, a, label) => {
      const x = rad(a, rng);
      if (a.ausgaenge.length > 1) push({ t: 'rad', side, kat: a.kat, label: label || a.name, i: x.i, wert: x.wert, ausgaenge: a.ausgaenge, text: `Glücksrad: ${x.wert}` });
      return x.wert;
    };
    // Effekte einer Aktion: wann = immer | erfolg | fehlschlag
    function wirken(side, a, ausgang) {
      for (const e of a.effekte) {
        const wann = e.wann || 'immer';
        if (wann !== 'immer' && wann !== ausgang) continue;
        const zs = e.ziel === 'gegner' ? OTHER[side] : side, f = aktiv(s, zs), d = FX[e.art];
        if (!d || f.ko) continue;
        if (e.art === 'heilen') { const h = Math.min(e.wert, f.lpMax - f.lp); if (h > 0) { f.lp += h; lpVal(zs, f, `${f.name} heilt ${h} LP.`); } continue; }
        if (e.art === 'noerten') { const b = f.noerten; f.noerten = clamp(f.noerten + e.wert, 0, f.noertenMax); if (f.noerten !== b) nVal(zs, f, `${f.name}: ${f.noerten > b ? '+' : '−'}${Math.abs(f.noerten - b)} Nörten`); continue; }
        const r = Math.max(1, e.runden || 1);
        f.fx.push({ art: e.art, wert: e.wert, von: s.runde + 1, bis: s.runde + r, quelle: a.name });
        push({ t: 'effekt', side: zs, text: `${f.name}: ${fxText(e)}.` });
      }
    }
    const aktion = (side) => (act[side].typ === 'aktion' ? aktiv(s, side).aktionen[act[side].i] : null);

    // 1. Kosten zahlen
    for (const side of ['A', 'B']) {
      const a = aktion(side), f = aktiv(s, side);
      if (a && a.kosten) { f.noerten -= a.kosten; nVal(side, f, `${f.name}: −${a.kosten} Nörten`); }
    }
    // 2. Auswechseln passiert zuerst – die neue Figur steckt den Angriff ein
    const wechsel = { A: false, B: false };
    for (const side of ['A', 'B']) if (act[side].typ === 'wechseln') {
      const from = aktiv(s, side); s.teams[side].active = act[side].i; wechsel[side] = true;
      push({ t: 'wechsel', side, fi: act[side].i, text: `${from.name} geht raus, ${aktiv(s, side).name} kommt rein!` });
    }
    const A = { A: aktion('A'), B: aktion('B') };
    const kat = (side) => (A[side] ? A[side].kat : null);

    // 3. Angriffe
    const wasHit = { A: false, B: false }, attacked = { A: false, B: false }, rolled = { A: false, B: false };
    let order = ['A', 'B'].filter((x) => kat(x) === 'angriff');
    if (order.length === 2) {
      const pa = A.A.sonder.zuerst ? 1 : 0, pb = A.B.sonder.zuerst ? 1 : 0;
      const ta = tempoVon(s, aktiv(s, 'A')), tb = tempoVon(s, aktiv(s, 'B'));
      if (pb > pa || (pb === pa && (tb > ta || (tb === ta && rng() < 0.5)))) order = ['B', 'A'];
      const first = aktiv(s, order[0]), w = A[order[0]].sonder.zuerst && !A[order[1]].sonder.zuerst;
      push({ t: 'info', text: w ? `${first.name} ist blitzschnell und greift zuerst an.` : `${first.name} ist schneller und greift zuerst an.` });
    }
    for (const X of order) {
      const Y = OTHER[X], fx = aktiv(s, X), fy = aktiv(s, Y), a = A[X], d = wechsel[Y] ? null : A[Y];
      if (fx.ko) { push({ t: 'info', text: `${fx.name} ist k.o. – der Angriff fällt aus.` }); continue; }
      push({ t: 'angriff', side: X, text: `${fx.name} setzt ${a.name} ein!` });
      const chance = trefferChance(s, fx, a);
      if (!schadet(a)) {                                       // Attacke ohne Schaden (nur Effekte)
        const ok = wurf(X, a, chance, a.name, 'Klappt!', 'Daneben!');
        wirken(X, a, ok ? 'erfolg' : 'fehlschlag');
        continue;
      }
      attacked[Y] = true;
      let factor = 1, block = 0, schild = 0, blockOk = false;
      if (d && d.kat === 'ausweichen') {
        rolled[Y] = true;
        if (a.sonder.unausweichlich) {
          push({ t: 'info', side: Y, text: `${a.name} lässt sich nicht ausweichen!` });
          wirken(Y, d, 'fehlschlag');
          factor = d.sonder.halb ? 0.5 : R.getroffen_faktor;
        } else {
          const dc = ausweichChance(s, fy, d, fx);
          const ok = wurf(Y, d, dc, d.name, `${fy.name} weicht aus!`, `${fy.name} wird erwischt!`);
          wirken(Y, d, ok ? 'erfolg' : 'fehlschlag');
          if (ok) {
            if (d.sonder.gegenschlag > 0 && !fy.ko) {
              fx.lp = Math.max(0, fx.lp - d.sonder.gegenschlag);
              lpVal(X, fx, `Gegenschlag! ${fx.name} verliert ${d.sonder.gegenschlag} LP.`, d.sonder.gegenschlag); ko(X, fx);
            }
            wirken(X, a, 'fehlschlag');
            continue;
          }
          factor = d.sonder.halb ? 0.5 : R.getroffen_faktor;
        }
      } else if (d && d.kat === 'verteidigung') {
        rolled[Y] = true;
        blockOk = wurf(Y, d, d.wuerfe.chance, d.name, 'Abwehr klappt!', 'Abwehr misslingt!');
        if (blockOk) {
          const v = radWurf(Y, d), durch = 1 - clamp(a.sonder.durchschlag || 0, 0, 100) / 100;
          if (d.sonder.schild) schild = Math.round(v * durch); else block = clamp(v, 0, 100) * durch;
          if (durch < 1) push({ t: 'info', side: X, text: `${a.name} schlägt durch die Abwehr!` });
        } else factor = R.verteidigung_fehlschlag_faktor ?? 1;
        wirken(Y, d, blockOk ? 'erfolg' : 'fehlschlag');
      } else if (d && d.kat === 'auftanken') factor = R.getroffen_faktor;

      const schutz = clamp(mod(s, fy, 'schutz'), 0, 100);
      const boost = 1 + mod(s, fx, 'schaden') / 100;
      const n = anzahl(a, rng);
      if (a.wuerfe.art === 'zufall') push({ t: 'info', side: X, text: `${a.name}: ${n} Würfe!` });
      let hits = 0, total = 0;
      for (let h = 0; h < n; h++) {
        const label = n > 1 || a.wuerfe.art === 'kette' ? `${a.name} ${h + 1}/${n}` : a.name;
        const ok = wurf(X, a, chance, label, 'Treffer!', a.wuerfe.art === 'kette' ? 'Daneben – Kette reißt!' : 'Daneben!');
        if (!ok) { if (a.wuerfe.art === 'kette') break; continue; }
        const base = radWurf(X, a, label) + (a.wuerfe.art === 'kette' ? (a.wuerfe.steigerung || 0) * hits : 0);
        hits++;
        let dmg = base * boost * factor * (1 - block / 100) * (1 - schutz / 100);
        dmg = Math.round(dmg + 1e-9);
        if (base > 0 && dmg < 1 && block < 100 && schutz < 100) dmg = 1;
        let absorbed = 0;
        if (schild > 0) { absorbed = Math.min(schild, dmg); schild -= absorbed; dmg -= absorbed; }
        total += dmg; fy.lp = Math.max(0, fy.lp - dmg);
        const why = absorbed ? ` (${absorbed} geschluckt)` : factor > 1 ? ' (ungeschützt!)' : block > 0 ? ' (abgewehrt)' : factor < 1 ? ' (halb)' : '';
        lpVal(Y, fy, `${fy.name} verliert ${dmg} LP${why}.`, dmg);
        if (a.sonder.lebensraub > 0 && dmg > 0 && !fx.ko) {
          const heal = Math.min(Math.round(dmg * a.sonder.lebensraub / 100), fx.lpMax - fx.lp);
          if (heal > 0) { fx.lp += heal; lpVal(X, fx, `${fx.name} saugt ${heal} LP ab.`); }
        }
        if (fy.lp <= 0) break;
      }
      wirken(X, a, hits ? 'erfolg' : 'fehlschlag');
      if (hits && a.sonder.rueckstoss > 0) { fx.lp = Math.max(0, fx.lp - a.sonder.rueckstoss); lpVal(X, fx, `Rückstoß: ${fx.name} verliert ${a.sonder.rueckstoss} LP.`, a.sonder.rueckstoss); }
      if (hits) wasHit[Y] = true;
      if (d && d.kat === 'verteidigung' && blockOk && hits && fy.lp > 0) {
        fy.fx.push({ art: 'chance', wert: R.konter_treffer, von: s.runde + 1, bis: s.runde + 1, quelle: 'Konter' });
        fx.noerten = Math.max(0, fx.noerten - R.konter_noerten);
        push({ t: 'konter', side: Y, text: `Konter! ${fy.name} trifft nächste Runde +${R.konter_treffer} %, ${fx.name} verliert ${R.konter_noerten} Nörten.` });
        nVal(X, fx, '');
      }
      ko(Y, fy); ko(X, fx);
    }

    // 4. Verteidigung / Ausweichen ohne Angriff, Auftanken
    for (const side of ['A', 'B']) {
      const f = aktiv(s, side), a = A[side];
      if (!a || f.ko || wechsel[side]) continue;
      if ((a.kat === 'verteidigung' || a.kat === 'ausweichen') && !attacked[side]) {
        push({ t: 'info', side, text: `${f.name}: ${a.name} geht ins Leere.` });
        wirken(side, a, null);
      }
      if (a.kat === 'ausweichen' && attacked[side] && !rolled[side]) wirken(side, a, null);
      if (a.kat === 'auftanken') {
        const o = kat(OTHER[side]);
        const mult = wasHit[side] ? R.auftanken_getroffen_faktor : o === 'verteidigung' && !wechsel[OTHER[side]] ? R.auftanken_gegen_verteidigen_faktor : 1;
        const n = anzahl(a, rng);
        let sum = 0, okN = 0;
        for (let h = 0; h < n; h++) {
          const ok = wurf(side, a, a.wuerfe.chance, n > 1 ? `${a.name} ${h + 1}/${n}` : a.name, 'Prost!', 'Verschüttet!');
          if (!ok) { if (a.wuerfe.art === 'kette') break; continue; }
          sum += radWurf(side, a, a.name) + (a.wuerfe.art === 'kette' ? (a.wuerfe.steigerung || 0) * okN : 0); okN++;
        }
        const amount = Math.round(sum * mult + 1e-9), before = f.noerten;
        f.noerten = clamp(f.noerten + amount, 0, f.noertenMax);
        const note = wasHit[side] ? ' (gestört)' : mult > 1 ? ' (in Ruhe!)' : '';
        nVal(side, f, amount > 0 ? `${f.name}: ${a.name} +${f.noerten - before} Nörten${note}.` : `${f.name}: ${a.name} bringt nichts.`);
        if (a.sonder.lp > 0 && okN) {
          const h = Math.min(Math.round(a.sonder.lp * mult), f.lpMax - f.lp);
          if (h > 0) { f.lp += h; lpVal(side, f, `${f.name} erholt sich: +${h} LP.`); }
        }
        wirken(side, a, sum > 0 ? 'erfolg' : 'fehlschlag');
      }
    }

    // 5. Rundenende: Nachschaden, Heilung, Nörten pro Runde
    for (const side of ['A', 'B']) {
      const f = aktiv(s, side);
      if (f.ko) continue;
      const g = mod(s, f, 'gift'), r = mod(s, f, 'regen'), t = mod(s, f, 'tank');
      if (g > 0) { f.lp = Math.max(0, f.lp - g); lpVal(side, f, `${f.name} verliert ${g} LP Nachschaden.`, g); ko(side, f); }
      if (r > 0 && !f.ko) { const h = Math.min(r, f.lpMax - f.lp); if (h > 0) { f.lp += h; lpVal(side, f, `${f.name} heilt ${h} LP.`); } }
      if (t > 0 && !f.ko) { const b = f.noerten; f.noerten = Math.min(f.noertenMax, f.noerten + t); if (f.noerten > b) nVal(side, f, `${f.name}: +${f.noerten - b} Nörten.`); }
    }
    for (const side of ['A', 'B']) for (const f of s.teams[side].figs) f.fx = f.fx.filter((e) => e.bis > s.runde);
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

  // Zufalls-Spieler (für Tests und Probekämpfe): erst Kategorie, dann Aktion
  function zufall(s, side, rng = Math.random) {
    const o = optionen(s, side), ok = o.aktionen.filter((x) => x.ok);
    const kats = [...new Set(ok.map((x) => x.a.kat))];
    if (o.wechseln.length && rng() < 0.08) return { typ: 'wechseln', i: o.wechseln[0].i };
    const w = kats.flatMap((k) => (k === 'angriff' ? [k, k] : [k]));
    const k = w[Math.floor(rng() * w.length)], list = ok.filter((x) => x.a.kat === k);
    return { typ: 'aktion', i: list[Math.floor(rng() * list.length)].i };
  }

  // ---------- Kennzahlen für Editor und Karten ----------
  function erwartung(a0) {
    const a = aktionBauen(a0, []), p = a.wuerfe.chance / 100, w = a.wuerfe;
    const tot = a.ausgaenge.reduce((x, o) => x + Math.max(0, o.anteil), 0) || 1;
    const avg = a.ausgaenge.reduce((x, o) => x + o.wert * Math.max(0, o.anteil), 0) / tot;
    const mx = Math.max(...a.ausgaenge.map((o) => o.wert)), zeroOut = a.ausgaenge.filter((o) => o.wert <= 0).reduce((x, o) => x + Math.max(0, o.anteil), 0) / tot;
    const st = w.art === 'kette' ? w.steigerung || 0 : 0;
    let ev = 0, max = 0, nichts = 0;
    if (w.art === 'kette') {
      const n = clamp(w.n || 1, 1, 8);
      for (let k = 1; k <= n; k++) ev += Math.pow(p, k) * (avg + st * (k - 1));
      max = n * mx + st * n * (n - 1) / 2; nichts = 1 - p;
    } else {
      const lo = w.art === 'einfach' ? 1 : clamp(w.n || 1, 1, 8), hi = w.art === 'zufall' ? clamp(Math.max(w.bis || lo, lo), 1, 8) : lo;
      const n = (lo + hi) / 2;
      ev = n * p * avg; max = hi * mx;
      const q = 1 - p + p * zeroOut;
      nichts = 0; for (let k = lo; k <= hi; k++) nichts += Math.pow(q, k) / (hi - lo + 1);
    }
    return { ev, max, nichts, avg, chance: a.wuerfe.chance, proNoerti: a.kosten > 0 ? ev / a.kosten : null };
  }

  const api = { FORMAT, KAT, MAX_PRO_KAT, FX, fxText, ausbau, optionText, aktionBauen, figur, neu, optionen, gueltig, runde, ersetzen, aktiv, bank, zufall, need, step5, erwartung, ausweichChance, mod };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NoertiKampf = api;
})(typeof window !== 'undefined' ? window : globalThis);
