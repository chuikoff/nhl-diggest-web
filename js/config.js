// NHL Diggest — API config (static GitHub Pages, browser CORS-aware).
// Prefer direct api-web.nhle.com; ESPN is the CORS-friendly fallback.
window.NHL_API_BASE = 'https://api-web.nhle.com';
window.NHL_STATS_BASE = 'https://api.nhle.com';
window.ESPN_SITE_API = 'https://site.api.espn.com';
window.ESPN_WEB_API = 'https://site.web.api.espn.com';
window.ESPN_CORE_API = 'https://sports.core.api.espn.com';

// Season: NHL uses YYYYYYYY (start+end). gameType 01=preseason, 02=regular, 03=playoffs.
window.NHL_SEASON = '20262027';
window.NHL_PREV_SEASON = '20252026';
window.NHL_GAME_TYPE_PRE = '1';
window.NHL_GAME_TYPE_REG = '2';

// ESPN season year is the ending calendar year of the campaign (2025 => 2024-25).
window.ESPN_SEASON_PREV = 2025; // last completed regular season with full stats
window.ESPN_SEASON_CUR = 2026;  // 2025-26
window.ESPN_SEASON_NEXT = 2027; // 2026-27 (in progress)

window.NHL_TZ = 'Europe/Moscow';

// Deep-link bots for match-start reminders (Mini App → bot start payload).
window.NHL_TG_BOT = 'nhldig_bot';
window.NHL_MAX_BOT = 'id463223580832_bot';
