/* Nörti Arena als App: Service Worker anmelden + „App installieren“-Knopf in der Kopfzeile.
   Android/Chrome/Edge: echter Installationsdialog. iPhone/iPad: kurze Anleitung (Teilen → Zum Home-Bildschirm). */
(function () {
  const ROOT = new URL('../', document.currentScript.src).href;
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register(ROOT + 'sw.js', { scope: ROOT }).catch(() => {}));
  }

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) { document.documentElement.classList.add('is-app'); return; }

  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;

  function pill() {
    let b = document.getElementById('installApp');
    if (b) return b;
    const nav = document.querySelector('header.top .navr');
    if (!nav) return null;
    b = document.createElement('button');
    b.id = 'installApp'; b.type = 'button'; b.className = 'pill qpill install-pill';
    b.title = 'Als App installieren'; b.setAttribute('aria-label', 'Nörti Arena als App installieren');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v11m0 0-4.5-4.5M12 14l4.5-4.5M5 16v3h14v-3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    b.addEventListener('click', install);
    nav.prepend(b);
    return b;
  }

  async function install() {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({}));
      deferred = null;
      if (outcome === 'accepted') document.getElementById('installApp')?.remove();
      return;
    }
    howto();
  }

  function howto() {
    const d = document.createElement('dialog');
    d.className = 'install-dlg';
    const share = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px"><path d="M12 15V3m0 0L8 7m4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    d.innerHTML = `<img src="${ROOT}app/icons/icon-192.png" alt="" width="72" height="72">
      <h2>Nörti Arena als App</h2>
      ${ios ? `<ol><li>Unten in Safari auf <b>Teilen</b> ${share} tippen</li><li><b>Zum Home-Bildschirm</b> wählen</li><li>Oben rechts <b>Hinzufügen</b></li></ol>
        <p class="small muted">Geht nur in Safari. In einem anderen Browser: Seite zuerst in Safari öffnen.</p>`
      : `<ol><li>Browser-Menü öffnen (<b>⋮</b> oben rechts)</li><li><b>App installieren</b> bzw. <b>Zum Startbildschirm hinzufügen</b> wählen</li></ol>`}
      <form method="dialog"><button class="btn-main">Alles klar</button></form>`;
    document.body.append(d);
    d.addEventListener('close', () => d.remove());
    d.showModal();
  }

  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; pill(); });
  addEventListener('appinstalled', () => { deferred = null; document.getElementById('installApp')?.remove(); });
  if (ios) {
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', pill); else pill();
  }
})();
