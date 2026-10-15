'use strict';

// ---------- Abgleich über OneDrive (Microsoft Graph) ----------
// App-Registrierung „Zeiterfassung“ im Entra-ID-Mandanten von ScheppConsult (Firmen-OneDrive).
// Leere Client-ID = Abgleich noch nicht eingerichtet.
const ONEDRIVE_CLIENT_ID = '2dd85a3a-473f-4170-9a05-15276df453fe';
const ONEDRIVE_TENANT = '71133e6c-59aa-4423-be28-f57eb7de5fb5';

const Sync = (() => {
  const SKEY = 'zeiterfassung.sync';
  const AUTH = `https://login.microsoftonline.com/${ONEDRIVE_TENANT}/oauth2/v2.0`;
  const SCOPE = 'Files.ReadWrite User.Read offline_access';
  const FILE = 'https://graph.microsoft.com/v1.0/me/drive/root:/Apps/Zeiterfassung/zeiterfassung.json';
  const redirectUri = () => new URL('./', location.href).href;

  let s = readStore();
  let busy = false, again = false, timer = null;
  let status = s.refresh ? 'idle' : 'off'; // off | idle | syncing | error | login
  let lastError = '';

  function readStore() { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } }
  function writeStore() { localStorage.setItem(SKEY, JSON.stringify(s)); }
  const configured = () => !!ONEDRIVE_CLIENT_ID;
  const connected = () => !!s.refresh;

  // --- Anmeldung (OAuth 2.0 Authorization Code mit PKCE) ---
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

  async function login(prompt = 'select_account') {
    const verifier = randomString(), st = randomString();
    sessionStorage.setItem('zeit.pkce', JSON.stringify({ verifier, state: st, prompt }));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const p = new URLSearchParams({
      client_id: ONEDRIVE_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
      scope: SCOPE, state: st, code_challenge: challenge, code_challenge_method: 'S256', prompt,
    });
    if (s.user && prompt === 'none') p.set('login_hint', s.user);
    location.assign(`${AUTH}/authorize?${p}`);
  }

  async function tokenRequest(params) {
    const res = await fetch(`${AUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: ONEDRIVE_CLIENT_ID, scope: SCOPE, ...params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error_description || data.error || res.status); e.code = data.error; throw e; }
    s.access = data.access_token;
    s.exp = Date.now() + (data.expires_in - 120) * 1000;
    if (data.refresh_token) s.refresh = data.refresh_token;
    writeStore();
  }

  // Rückkehr von der Microsoft-Anmeldung verarbeiten
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    const saved = JSON.parse(sessionStorage.getItem('zeit.pkce') || '{}');
    sessionStorage.removeItem('zeit.pkce');
    history.replaceState(null, '', location.pathname);
    if (q.get('state') !== saved.state) return;
    if (q.has('error')) {
      // Stille Erneuerung ging nicht: Nutzer muss sich einmal aktiv anmelden
      status = 'login'; lastError = q.get('error_description') || q.get('error');
      if (saved.prompt !== 'none') toast('Anmeldung abgebrochen');
      return;
    }
    try {
      await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier });
      const me = await graph('https://graph.microsoft.com/v1.0/me');
      s.user = me.userPrincipalName || me.mail || '';
      writeStore();
      status = 'idle';
      if (saved.prompt !== 'none') toast('Mit OneDrive verbunden');
    } catch (e) { status = 'error'; lastError = e.message; }
  }

  async function accessToken() {
    if (s.access && Date.now() < s.exp) return s.access;
    try {
      await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh });
      return s.access;
    } catch (e) {
      if (e.code === 'invalid_grant' || e.code === 'interaction_required') {
        // Für Web-Apps gilt die Anmeldung bei Microsoft nur 24 Stunden; still erneuern, einmal pro Sitzung
        if (!sessionStorage.getItem('zeit.silentTried') && navigator.onLine) {
          sessionStorage.setItem('zeit.silentTried', '1');
          await login('none');
          throw new Error('redirect');
        }
        status = 'login';
      }
      throw e;
    }
  }

  async function graph(url, opts = {}) {
    const token = await accessToken();
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
    if (opts.raw) return res;
    if (!res.ok) throw new Error(`OneDrive ${res.status}`);
    return res.json();
  }

  // --- Zusammenführen: pro Tag gewinnt die jüngste Änderung, gelöschte Tage als Grabstein ---
  function merge(local, remote) {
    const out = {
      ...local,
      days: {}, deleted: {},
      settings: (remote.settingsAt || 0) > (local.settingsAt || 0) ? remote.settings : local.settings,
      settingsAt: Math.max(local.settingsAt || 0, remote.settingsAt || 0),
    };
    const keys = new Set([...Object.keys(local.days || {}), ...Object.keys(local.deleted || {}), ...Object.keys(remote.days || {}), ...Object.keys(remote.deleted || {})]);
    for (const k of keys) {
      const cands = [
        [local.days?.[k], local.days?.[k]?.updatedAt || 0],
        [remote.days?.[k], remote.days?.[k]?.updatedAt || 0],
        [null, local.deleted?.[k] || -1],
        [null, remote.deleted?.[k] || -1],
      ].filter(([d, t]) => d || t >= 0);
      cands.sort((a, b) => b[1] - a[1] || (b[0] ? 1 : 0) - (a[0] ? 1 : 0));
      const [day, t] = cands[0];
      if (day) out.days[k] = day; else out.deleted[k] = t;
    }
    return out;
  }

  const fingerprint = st => JSON.stringify([st.days, st.deleted || {}, st.settings, st.settingsAt || 0]);

  async function run() {
    if (!configured() || !connected() || !navigator.onLine) return;
    if (busy) { again = true; return; }
    busy = true; status = 'syncing'; refreshUi();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let remote = { days: {}, deleted: {}, settings: state.settings, settingsAt: 0 }, etag = null;
        const meta = await graph(FILE, { raw: true });
        if (meta.ok) {
          const m = await meta.json();
          etag = m.eTag;
          const dl = await fetch(m['@microsoft.graph.downloadUrl']);
          if (!dl.ok) throw new Error('Download fehlgeschlagen');
          remote = await dl.json();
        } else if (meta.status !== 404) throw new Error(`OneDrive ${meta.status}`);

        // Lokalen Stand frisch lesen (Änderungen in anderen Tabs)
        const merged = merge(load(), remote);
        if (fingerprint(merged) !== fingerprint(load())) {
          state = merged;
          localStorage.setItem(KEY, JSON.stringify(state));
          if (!document.querySelector('#editor').open) render();
        }
        if (fingerprint(merged) !== fingerprint(remote) || !etag) {
          const token = await accessToken();
          const put = await fetch(`${FILE}:/content`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
            body: JSON.stringify(merged),
          });
          if (put.status === 412) continue; // anderes Gerät war schneller: neu laden und zusammenführen
          if (!put.ok) throw new Error(`Hochladen fehlgeschlagen (${put.status})`);
        }
        s.lastSync = Date.now(); writeStore();
        status = 'idle'; lastError = '';
        break;
      }
    } catch (e) {
      if (e.message !== 'redirect') { if (status !== 'login') status = 'error'; lastError = e.message; }
    } finally {
      busy = false; refreshUi();
      if (again) { again = false; schedule(500); }
    }
  }

  function schedule(ms = 2500) {
    if (!connected()) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  function disconnect() {
    s = {}; localStorage.removeItem(SKEY);
    status = 'off'; refreshUi();
  }

  function refreshUi() { if (view === 'settings' && !document.querySelector('#editor').open) render(); }

  function statusHtml() {
    if (!configured()) return `<p class="hint" style="margin:0">Der OneDrive-Abgleich ist noch nicht eingerichtet. Bis dahin liegen die Daten nur auf diesem Gerät.</p>`;
    if (!connected()) return `<p class="hint" style="margin:0 0 10px">Verbinde die App mit deinem OneDrive, damit Handy und PC denselben Stand haben. Die Daten liegen dort im Ordner „Apps/Zeiterfassung“.</p>
      <button class="btn primary block" data-act="od-login">Mit OneDrive verbinden</button>`;
    const last = s.lastSync ? new Date(s.lastSync).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'noch nie';
    const line = {
      idle: `Zuletzt abgeglichen: ${last}`,
      syncing: 'Gleiche ab …',
      error: `<span class="badge warn">Fehler</span> ${esc(lastError)} · zuletzt ok: ${last}`,
      login: '<span class="badge warn">Anmeldung abgelaufen</span> Bitte neu anmelden.',
    }[status] || '';
    return `<p style="margin:0 0 4px">Verbunden${s.user ? ` als <b>${esc(s.user)}</b>` : ''}</p>
      <p class="hint" style="margin:0 0 10px">${line}</p>
      <div class="btn-row">
        ${status === 'login' ? '<button class="btn primary" data-act="od-login">Neu anmelden</button>' : '<button class="btn" data-act="od-sync">Jetzt abgleichen</button>'}
        <button class="btn" data-act="od-logout">Trennen</button>
      </div>`;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'od-login') { sessionStorage.removeItem('zeit.silentTried'); login(); }
    if (b.dataset.act === 'od-sync') run();
    if (b.dataset.act === 'od-logout' && confirm('OneDrive-Abgleich auf diesem Gerät trennen? Die Daten bleiben auf dem Gerät und in OneDrive erhalten.')) disconnect();
  });

  async function init() {
    if (!configured()) return;
    await handleRedirect();
    refreshUi();
    schedule(300);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
    window.addEventListener('online', () => schedule(300));
    setInterval(() => schedule(0), 5 * 60 * 1000);
  }

  return { init, schedule, statusHtml };
})();

Sync.init();
