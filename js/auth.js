/**
 * Optional PWA/browser login. No passwords.
 * Ask the bot API for a one-time code, user confirms in Telegram or Max,
 * then poll until a session token is stored in localStorage.
 * HTTPS pages never call an http base (mixed content).
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'nhl-diggest-session';
  const listeners = new Set();

  function readSession() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object' || !raw.token) return null;
      return {
        token: String(raw.token),
        platform: raw.platform === 'max' ? 'max' : 'telegram',
        platformUserId: raw.platformUserId != null ? raw.platformUserId : null,
        userId: raw.userId != null ? raw.userId : null
      };
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    try {
      if (!session || !session.token) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch { /* private mode */ }
    listeners.forEach(fn => {
      try { fn(readSession()); } catch { /* ignore */ }
    });
  }

  function configuredBase() {
    return String(window.NHL_AUTH_BASE || '').trim().replace(/\/$/, '');
  }

  function base() {
    const raw = configuredBase();
    if (raw) {
      // Never call plain HTTP from an HTTPS page (mixed content).
      if (location.protocol === 'https:' && /^http:/i.test(raw)) return '';
      return raw;
    }
    // Unconfigured: same-origin only when this page itself is not HTTPS
    // (VPS nginx on :80, or a local http server that proxies /api).
    if (location.protocol === 'http:' && location.host) return location.origin;
    return '';
  }

  function token() {
    return readSession()?.token || '';
  }

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const root = base();
    if (!root) {
      const err = new Error('no-base');
      err.code = 'no-base';
      throw err;
    }
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && token()) headers.Authorization = 'Bearer ' + token();
    const res = await fetch(root + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 401) {
      // Only drop a stored session when this request actually used it.
      // Mini App /api/auth/miniapp 401 must keep err.data.reason for diagnostics.
      if (auth) writeSession(null);
      const err = new Error((data && data.error) || 'unauthorized');
      err.status = 401;
      err.data = data;
      throw err;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('http-' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.NHL_AUTH = {
    base,
    available: () => Boolean(base()),
    token,
    session: readSession,
    loggedIn: () => Boolean(token() && base()),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start(platform) {
      return request('/api/auth/start', { method: 'POST', body: { platform }, auth: false });
    },
    poll(code) {
      return request('/api/auth/poll?code=' + encodeURIComponent(code), { auth: false });
    },
    acceptToken(session) {
      writeSession(session);
    },
    async logout() {
      const current = token();
      if (current && base()) {
        try { await request('/api/auth/session', { method: 'DELETE' }); } catch { /* still clear locally */ }
      }
      writeSession(null);
    },
    me() { return request('/api/auth/me'); },
    miniappLogin({ platform, init_data }) {
      return request('/api/auth/miniapp', {
        method: 'POST',
        body: { platform, init_data },
        auth: false
      });
    },
    async getFavorites() {
      const data = await request('/api/auth/favorites');
      return {
        teams: Array.isArray(data?.teams) ? data.teams : [],
        favorite_teams: Array.isArray(data?.favorite_teams) ? data.favorite_teams : [],
        players: Array.isArray(data?.players) ? data.players : []
      };
    },
    putFavorites(fav, { clear = false } = {}) {
      const teams = Array.isArray(fav?.teams) ? fav.teams : [];
      const players = Array.isArray(fav?.players) ? fav.players : [];
      // Never auto-send clear:true — that defeated the server empty-PUT guard and
      // could wipe bot favorite_teams when localStorage was still empty on boot.
      // Only an explicit clear (user removed the last favorite) may wipe.
      const body = { teams, players };
      if (!teams.length && !players.length) {
        if (!clear) {
          return Promise.resolve({ teams: [], players: [], skipped: true });
        }
        body.clear = true;
      }
      return request('/api/auth/favorites', {
        method: 'PUT',
        body
      });
    }
  };
})();
