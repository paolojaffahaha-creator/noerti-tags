/* Nörti Arena – Feier-Momente: Level-up-Fenster und Starter-Zeremonie (gemeinsam für Figurenseite, Sammlung und Arena).
   Braucht common.js (Noerti) und kampf.js (NoertiKampf, für die Belohnungstexte aus dem Level-Pfad). Stil: app/style.css → "Feier". */
(function () {
  const { esc } = window.Noerti;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  const ICON = { lp_faktor: '♥', noerten_faktor: '🍺', tempo: '⚡', lernt: '✨', verbessern: '⬆', optik: '★' };
  const MEILENSTEIN = [5, 10, 15, 20];

  // Belohnungen eines Levels aus dem Level-Pfad: { fest: [karte], wahl: [karte] | null } – karte = { i, t, d }
  function belohnung(data, typeId, level) {
    const t = data && data.typen && data.typen[typeId], K = window.NoertiKampf;
    const opts = (t && t.pfad && t.pfad[level]) || [];
    const karte = (o) => ({ i: ICON[o.art] || '✨', t: K ? K.optionText(t, o) : o.art, d: o.art === 'optik' ? 'nur Aussehen' : o.art === 'lernt' ? 'neue Aktion im Kampf' : '' });
    if (!opts.length) return { fest: [{ i: '★', t: `Level ${level}`, d: 'weiter so!' }], wahl: null };
    return opts.length === 1 ? { fest: [karte(opts[0])], wahl: null } : { fest: [], wahl: opts.map(karte) };
  }

  function konfetti(box) {
    if (reduced()) return;
    for (let k = 0; k < 26; k++) {
      const i = document.createElement('i'); if (k % 3 === 0) i.className = 'sq';
      const s = 8 + Math.random() * 8;
      Object.assign(i.style, { left: Math.random() * 100 + '%', width: s + 'px', height: s + 'px', animationDuration: (1.6 + Math.random() * 1.6) + 's', animationDelay: (Math.random() * 0.5) + 's' });
      box.appendChild(i);
    }
  }

  // Ein Level-up. u = { img, name, to, fest: [karte], wahl: [karte] | null, rest, onPick: async (index) => {} }
  // Wahl-Level: onPick speichert; schlägt es fehl, bleibt das Fenster offen. Ohne onPick: Hinweis „später wählen“.
  function levelUp(u) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'feier' + (MEILENSTEIN.includes(u.to) ? ' meilenstein' : '');
      bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', `${u.name}: Level ${u.to}`);
      const wahl = u.wahl && u.onPick ? u.wahl : null;
      const fest = u.wahl && !u.onPick ? [] : u.fest || [];
      const kartenHtml = (l, btn) => l.map((c, i) => `<${btn ? `button type="button" data-i="${i}" aria-pressed="false"` : 'div'} class="rk" style="animation-delay:${0.35 + i * 0.12}s">
          <span class="ri">${esc(c.i)}</span><span><b>${esc(c.t)}</b>${c.d ? `<span>${esc(c.d)}</span>` : ''}</span></${btn ? 'button' : 'div'}>`).join('');
      bg.innerHTML = `<div class="strahlen"></div><div class="konfetti"></div>
        ${u.rest ? `<span class="kette">noch ${u.rest} Level-up</span>` : ''}
        <div class="stempel">LEVEL UP!</div>
        ${u.img ? `<img class="held" src="${esc(u.img)}" alt="">` : ''}
        <div class="zahlen"><span>${u.to - 1}</span><span class="pfeil">➜</span><span class="neu">${u.to}</span></div>
        <div class="wer">${esc(u.name)} ${MEILENSTEIN.includes(u.to) ? 'erreicht einen Meilenstein!' : 'wird stärker'}</div>
        <div class="karten">
          ${wahl ? `<div class="hinweis">Wähle eine Belohnung – die Wahl ist endgültig.</div>${kartenHtml(wahl, true)}` : kartenHtml(fest, false)}
          ${u.wahl && !u.onPick ? `<div class="hinweis">Auf Level ${u.to} gibt es eine Wahl – die triffst du, wenn du die Figur das nächste Mal antippst.</div>` : ''}
        </div>
        <button class="btn-main" id="feier-ok" ${wahl ? 'disabled' : ''}>${wahl ? 'BELOHNUNG NEHMEN' : 'WEITER'}</button>`;
      document.body.appendChild(bg);
      konfetti(bg.querySelector('.konfetti'));
      buzz([60, 40, 120]);
      let pick = null;
      const ok = bg.querySelector('#feier-ok');
      bg.querySelectorAll('button.rk').forEach((b) => b.onclick = () => {
        pick = +b.dataset.i;
        bg.querySelectorAll('button.rk').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        ok.disabled = false;
      });
      ok.onclick = async () => {
        if (wahl) {
          ok.disabled = true; ok.textContent = 'SPEICHERN …';
          try { await u.onPick(pick); }
          catch (e) { ok.disabled = false; ok.textContent = 'BELOHNUNG NEHMEN'; window.Noerti.toast(window.Noerti.errMsg(e), 'err'); return; }
        }
        bg.remove(); resolve(pick);
      };
      setTimeout(() => ok.focus({ preventScroll: true }), 50);
    });
  }

  // Mehrere Level hintereinander (von → bis). opts = { data, typeId, img, name, gewaehlt: wahlen-Objekt, onPick: async (level, index) }
  async function kette(von, bis, opts) {
    for (let l = von + 1; l <= bis; l++) {
      const b = belohnung(opts.data, opts.typeId, l), schon = opts.gewaehlt && opts.gewaehlt[l] != null;
      await levelUp({ img: opts.img, name: opts.name, to: l, rest: bis - l,
        fest: schon && b.wahl ? [b.wahl[opts.gewaehlt[l]]].filter(Boolean) : b.fest,
        wahl: schon ? null : b.wahl,
        onPick: !schon && b.wahl && opts.onPick ? (i) => opts.onPick(l, i) : null });
    }
  }

  // Starter-Zeremonie: gibt den gewählten Namen zurück. o = { img, vorschlag, geschenk, onName: async (name) => {} }
  function starter(o) {
    return new Promise((resolve) => {
      const bg = document.createElement('div'); bg.className = 'zeremonie';
      bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', 'Dein Starter-Nörti');
      bg.innerHTML = `<div class="inhalt">
        <span class="chip stern">⭐ STARTER-NÖRTI</span>
        <div class="spot">${o.img ? `<img src="${esc(o.img)}" alt="">` : '<span class="disp">?</span>'}</div>
        <h2>${o.gewaehlt ? 'Dein Starter steht fest!' : 'Dein allererster Nörti!'}</h2>
        <p>Er begleitet dich von Anfang an und wächst schneller als alle anderen.</p>
        <ul class="vorteile">
          <li><span class="ic">×2</span><span><b>Doppelte XP</b> in jedem Kampf, solange er dir gehört</span></li>
          <li><span class="ic">+${o.geschenk || 90}</span><span><b>Start-Geschenk</b>: ${o.geschenk || 90} XP – gleich geht es ein paar Level hoch</span></li>
          <li><span class="ic">★</span><span><b>Starter-Stern</b>: goldener Rahmen in Sammlung, Arena und Freundebuch</span></li>
        </ul>
        <form id="zf" class="actions" style="width:100%">
          <label class="namefeld" for="zn">Wie soll er heißen?<input id="zn" maxlength="24" value="${esc(o.vorschlag || '')}" autocomplete="off"></label>
          <button class="btn-main" type="submit" id="zok"></button>
        </form></div>`;
      document.body.appendChild(bg);
      buzz([40, 30, 40, 30, 160]);
      const inp = bg.querySelector('#zn'), btn = bg.querySelector('#zok');
      const upd = () => { btn.textContent = `${(inp.value.trim() || o.vorschlag || 'ER').toUpperCase()} WIRD MEIN STARTER`; };
      inp.oninput = upd; upd();
      bg.querySelector('#zf').onsubmit = async (ev) => {
        ev.preventDefault();
        const n = inp.value.trim() || o.vorschlag || '';
        btn.disabled = true;
        try { if (o.onName) await o.onName(n); } catch (e) { btn.disabled = false; window.Noerti.toast(window.Noerti.errMsg(e), 'err'); return; }
        bg.remove(); resolve(n);
      };
    });
  }

  window.Noerti.feier = { levelUp, kette, starter, belohnung };
})();
