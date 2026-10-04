// NHL Diggest — API config (static GitHub Pages, browser CORS-aware).
// Prefer direct api-web.nhle.com; ESPN is the CORS-friendly fallback.
window.NHL_API_BASE = 'https://api-web.nhle.com';
// Optional VPS finished-game cache (bot aiohttp); disabled in the Mini App by default.
// Use HTTPS (nginx/TLS) for GitHub Pages — plain http:// is mixed-content blocked.
// Placeholder until TLS: http://31.77.11.22:8765
window.NHL_CACHE_BASE = '';
// Optional login + favorites API (same aiohttp as the game cache).
// HTTPS origin so GitHub Pages (https://chuikoff.github.io) can call it.
// nginx on hockeydigest.duckdns.org proxies /api to 127.0.0.1:8765.
// When this is set, NHL_AUTH.available() is true and the Telegram/Max
// login buttons are enabled. From an http page with this empty, the client
// falls back to location.origin.
window.NHL_AUTH_BASE = 'https://hockeydigest.duckdns.org';
window.NHL_STATS_BASE = 'https://api.nhle.com';
window.ESPN_SITE_API = 'https://site.api.espn.com';
window.ESPN_WEB_API = 'https://site.web.api.espn.com';
window.ESPN_CORE_API = 'https://sports.core.api.espn.com';

// Season: NHL uses YYYYYYYY (start+end). gameType 01=preseason, 02=regular, 03=playoffs.
// NHL campaign runs roughly Sep–Jun. Before September, "current" is still the season
// that started the previous calendar year.
(function applyDateBasedSeason(now) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1–12
  // Jul–Aug = offseason after Cup → still previous campaign until Sep flip.
  const startYear = m >= 9 ? y : y - 1;
  const endYear = startYear + 1;
  const nhlId = String(startYear) + String(endYear);
  const prevStart = startYear - 1;
  const prevEnd = startYear;
  const nhlPrev = String(prevStart) + String(prevEnd);

  window.NHL_SEASON = nhlId;
  window.NHL_PREV_SEASON = nhlPrev;
  window.NHL_SEASON_START_YEAR = startYear;
  window.NHL_SEASON_LABEL = startYear + '/' + String(endYear).slice(-2); // e.g. 2026/27
  window.NHL_PREV_SEASON_LABEL = prevStart + '/' + String(prevEnd).slice(-2);

  // ESPN season year = ending calendar year of the campaign (2027 => 2026-27).
  window.ESPN_SEASON_CUR = endYear;
  window.ESPN_SEASON_PREV = prevEnd;
  window.ESPN_SEASON_NEXT = endYear + 1;
})(new Date());

window.NHL_GAME_TYPE_PRE = '1';
window.NHL_GAME_TYPE_REG = '2';

window.NHL_TZ = 'Europe/Moscow';

// Deep-link bots for match-start reminders (Mini App → bot start payload).
window.NHL_TG_BOT = 'nhldig_bot';
window.NHL_MAX_BOT = 'id463223580832_bot';
