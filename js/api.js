/**
 * Live NHL data for the static Mini App.
 *
 * Browser CORS (tested 2026-09-29):
 *   api-web.nhle.com / api.nhle.com — NO Access-Control-Allow-Origin (blocked in browsers).
 *   site.api.espn.com, site.web.api.espn.com, sports.core.api.espn.com — ACAO: * (works).
 *
 * Strategy: try NHL api-web first (same paths as the Python bot). On CORS/network
 * failure, fall back to ESPN public APIs. Mock data is used only if both fail.
 */
(() => {
  'use strict';

  const NHL = () => (window.NHL_API_BASE || 'https://api-web.nhle.com').replace(/\/$/, '');
  const ESPN_SITE = () => (window.ESPN_SITE_API || 'https://site.api.espn.com').replace(/\/$/, '');
  const ESPN_WEB = () => (window.ESPN_WEB_API || 'https://site.web.api.espn.com').replace(/\/$/, '');
  const ESPN_CORE = () => (window.ESPN_CORE_API || 'https://sports.core.api.espn.com').replace(/\/$/, '');

  // ESPN scoreboard/standings/athletes use short codes (LA, TB, NJ, SJ, UTAH).
  // NHL api-web + assets/nhl-trophies.json + cap-hits.json use LAK, TBL, NJD, SJS, UTA.
  // Without this map, team cards opened from ESPN fallbacks miss Cups / retired #s.
  const ESPN_TO_NHL_ABBREV = {
    LA: 'LAK',
    TB: 'TBL',
    NJ: 'NJD',
    SJ: 'SJS',
    UTAH: 'UTA'
  };

  function canonicalNhlAbbrev(abbrev) {
    const key = String(abbrev || '').trim().toUpperCase();
    if (!key) return '';
    return ESPN_TO_NHL_ABBREV[key] || key;
  }

  const ESPN_SLUG = { LAK: 'la', TBL: 'tb', NJD: 'nj', SJS: 'sj', WSH: 'wsh', MTL: 'mtl', UTA: 'utah' };
  const LIVE = new Set(['LIVE', 'CRIT']);
  const FINAL = new Set(['OFF', 'FINAL', 'OVER']);

  const CACHE_BASE = () => String(window.NHL_CACHE_BASE || '').replace(/\/$/, '');

  async function fetchCacheGamePayload(gameId) {
    const base = CACHE_BASE();
    if (!base || gameId == null || gameId === '') return null;
    try {
      return await fetchJson(`${base}/api/games/${encodeURIComponent(gameId)}`, 8000);
    } catch (error) {
      console.info('[NHL Diggest] VPS cache miss/unavailable', error?.message || error);
      return null;
    }
  }

  function detailFromCachePayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    // Accept either flat detail or { detail, game } wrappers.
    const detail = payload.detail && typeof payload.detail === 'object' ? payload.detail : payload;
    if (!detail.scoring && !detail.skaters && !detail.goalies && !detail.threeStars && !detail.boxscore) {
      return null;
    }
    const { game: _gameStub, ...rest } = detail;
    return { source: rest.source || 'nhl-cache', ...rest };
  }

  function stubFromCachePayload(payload, gameId) {
    if (!payload || typeof payload !== 'object') return null;
    const stub = payload.game || payload.detail?.game;
    if (stub && (stub.id != null || stub.away || stub.home)) {
      return { ...stub, id: stub.id != null ? stub.id : (Number(gameId) || gameId), status: stub.status || 'Final' };
    }
    return null;
  }

  function gameLooksFinished(game) {
    if (!game) return false;
    if (game.status === 'Final') return true;
    const state = String(game.gameState || game.state || '').toUpperCase();
    return FINAL.has(state);
  }

  const cache = new Map();

  // --- Season resolution (current campaign, not last completed) ---
  // Prefer NHL /v1/standings-season when CORS allows; else date-based config.js defaults.
  let seasonReady = null;

  function nhlSeasonId() {
    return String(window.NHL_SEASON || '20262027');
  }

  function nhlPrevSeasonId() {
    return String(window.NHL_PREV_SEASON || '20252026');
  }

  function espnSeasonYear() {
    const cur = Number(window.ESPN_SEASON_CUR);
    if (Number.isFinite(cur) && cur >= 2026) return cur;
    const fromNhl = Number(String(window.NHL_SEASON || '').slice(4));
    if (Number.isFinite(fromNhl) && fromNhl >= 2026) return fromNhl;
    return 2027;
  }

  function seasonLabelShort(seasonId) {
    const id = String(seasonId || nhlSeasonId());
    if (id.length === 8) return `${id.slice(0, 4)}/${id.slice(6)}`;
    return window.NHL_SEASON_LABEL || id;
  }

  function seasonNoteNhl() {
    return `регулярный ${window.NHL_SEASON_LABEL || seasonLabelShort()}`;
  }

  function seasonNoteEspn() {
    return `ESPN · ${window.NHL_SEASON_LABEL || seasonLabelShort()}`;
  }

  function applySeasonFromId(seasonId, prevId) {
    const id = String(seasonId || '');
    if (!/^\d{8}$/.test(id)) return;
    const startYear = Number(id.slice(0, 4));
    const endYear = Number(id.slice(4));
    window.NHL_SEASON = id;
    window.NHL_SEASON_START_YEAR = startYear;
    window.NHL_SEASON_LABEL = `${startYear}/${String(endYear).slice(-2)}`;
    window.ESPN_SEASON_CUR = endYear;
    window.ESPN_SEASON_NEXT = endYear + 1;
    const prev = String(prevId || '');
    if (/^\d{8}$/.test(prev)) {
      window.NHL_PREV_SEASON = prev;
      window.NHL_PREV_SEASON_LABEL = `${prev.slice(0, 4)}/${prev.slice(6)}`;
      window.ESPN_SEASON_PREV = Number(prev.slice(4));
    } else {
      const ps = startYear - 1;
      const pe = startYear;
      window.NHL_PREV_SEASON = `${ps}${pe}`;
      window.NHL_PREV_SEASON_LABEL = `${ps}/${String(pe).slice(-2)}`;
      window.ESPN_SEASON_PREV = pe;
    }
  }

  function pickSeasonFromStandingsMeta(payload, todayIso) {
    const seasons = payload?.seasons || [];
    if (!seasons.length) return null;
    const today = todayIso || new Date().toISOString().slice(0, 10);
    // Prefer season whose standings window covers today; else latest with start <= today.
    let best = null;
    for (const row of seasons) {
      const id = String(row.id || '');
      const start = row.standingsStart || '';
      const end = row.standingsEnd || '';
      if (!/^\d{8}$/.test(id)) continue;
      if (start && end && start <= today && today <= end) return { id, prev: null, row };
      if (start && start <= today) best = { id, prev: null, row };
    }
    if (best) return best;
    const last = seasons[seasons.length - 1];
    return last?.id ? { id: String(last.id), prev: null, row: last } : null;
  }

  async function resolveSeasonFromNhl() {
    try {
      const data = await fetchJson(`${NHL()}/v1/standings-season`);
      const today = data.currentDate || new Date().toISOString().slice(0, 10);
      const picked = pickSeasonFromStandingsMeta(data, today);
      if (!picked) return;
      const seasons = data.seasons || [];
      const idx = seasons.findIndex(s => String(s.id) === picked.id);
      const prev = idx > 0 ? String(seasons[idx - 1].id) : null;
      applySeasonFromId(picked.id, prev);
    } catch (error) {
      // Expected in browsers (NHL api-web has no CORS). Date-based config stays.
      console.info('[NHL Diggest] season from NHL unavailable, using date-based', error?.message || error);
    }
  }

  async function ensureSeason() {
    if (!seasonReady) seasonReady = resolveSeasonFromNhl();
    await seasonReady;
  }


  // NHL and ESPN do not expose nationality in exactly the same shape. Keep the
  // check in one place so every player surface (including game box scores) uses
  // the same country-code and birth-country rules.
  const RUSSIAN_COUNTRY_RE = /(?:^|[\s_./-])(RUS|RU|RUSSIA|RUSSIAN|РОССИЯ|USSR|CCCP|СССР)(?:$|[\s_./-])/i;
  const RUSSIAN_NAME_FALLBACKS = new Set([
    'alexander ovechkin', 'alex ovechkin', 'artemi panarin', 'nikita kucherov',
    'evgeni malkin', 'yevgeni malkin', 'evgeny malkin', 'andrei svechnikov',
    'kirill kaprizov', 'matvei michkov', 'mikhail sergachev', 'mikhail sergachyov',
    'ivan provo rov', 'ivan provorov', 'dmitry orlov', 'nikita zadorov',
    'vladislav namestnikov', 'evgeny dadonov', 'valeri nichushkin', 'ilya lyubushkin',
    'igor shesterkin', 'ilya sorokin', 'semen varlamov', 'andrei vasilevskiy',
    'andrey vasilevskiy', 'alexander radulov', 'ilya kovalchuk', 'pavel datsyuk',
    'sergei fedorov', 'igor larionov', 'alexei kovalev', 'pavel bure', 'valeri bure',
    'slava kozlov', 'viacheslav kozlov', 'viacheslav fetisov', 'nikolai kulemin',
    'vitaly kratsov', 'yegor shangovich', 'nikolai goldobin', 'anatoli golyshev',
    // Active / common NHL Russians (boxscore + leaders; short names matched by last token)
    'pavel dorofeyev', 'vladislav gavrikov', 'marat khusnutdinov', 'vasily podkolzin',
    'alexander nikishin', 'alex nikishin', 'yegor chinakhov', 'kirill marchenko',
    'daniil tarasov', 'alexandar georgiev', 'alexander georgiev', 'pyotr kochetkov',
    'ivan fedotov', 'arseniy gusev', 'nikita chibrikov', 'yegor sharangovich',
    'yegor shangovich', 'alexander alexeyev', 'alex alexeyev', 'dmitri voronkov',
    'dmitry voronkov', 'vasiliy glotov', 'nikita okhotyuk', 'arsenii gritsyuk',
    'nikolai kovalenko', 'alexander romanov', 'alex romanov', 'vladislav kolyachonok',
    'bogdan konyushkov', 'danila yurov', 'matvei blinovsky', 'prokhor poltapov',
    // Ivan Demidov (Montreal; NHL ID 8484984), including boxscore name variants.
    'ivan demidov', 'i demidov', 'demidov ivan', 'иван демидов', 'и демидов'
  ]);

  // NHL playerIds for Russian nationals (boxscore rows often lack birthCountry).
  const RUSSIAN_PLAYER_IDS = new Set([
    '8471214', '8471215', '8478864', '8478550', '8476883', '8476453', '8478048',
    '8478009', '8480830', '8479410', '8484387', '8477507', '8481617', '8481604',
    '8482177', '8478882', '8482142', '8480839', '8481554', '8482158', '8480012',
    '8481032', '8477424', '8477942', '8480009', '8484984'
  ]);

  function normalizedName(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
  }

  function countryValueIsRussian(value, depth = 0) {
    if (depth > 3 || value == null) return false;
    if (typeof value === 'string' || typeof value === 'number') {
      return RUSSIAN_COUNTRY_RE.test(String(value).trim()) || /\b(russia|russian)\b/i.test(String(value));
    }
    if (Array.isArray(value)) return value.some(item => countryValueIsRussian(item, depth + 1));
    if (typeof value === 'object') {
      return Object.entries(value).some(([key, item]) => {
        if (/name|code|country|national|citizenship|flag|default|display|abbr|iso|alt|href|slug/i.test(key)) {
          return countryValueIsRussian(item, depth + 1);
        }
        return false;
      });
    }
    return false;
  }

  function russianNameFallbackMatch(name) {
    const norm = normalizedName(name);
    if (!norm) return false;
    if (RUSSIAN_NAME_FALLBACKS.has(norm)) return true;
    // NHL boxscore often uses "I. Shesterkin" / shortName — match by last token.
    const parts = norm.split(' ').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (last.length < 4) return false;
    for (const full of RUSSIAN_NAME_FALLBACKS) {
      const fullParts = full.split(' ').filter(Boolean);
      const fullLast = fullParts[fullParts.length - 1] || '';
      if (fullLast === last) return true;
    }
    return false;
  }

  function isRussianPlayer(player) {
    const rawName = typeof player === 'string'
      ? player
      : player?.name || player?.displayName || player?.fullName || player?.shortName ||
        playerName(player?.firstName, player?.lastName);
    const name = typeof rawName === 'object' ? loc(rawName) : rawName;
    if (russianNameFallbackMatch(name)) return true;
    if (!player || typeof player === 'string') return false;
    // Prefer NHL playerId (boxscore). Do not use ESPN athlete.id here — different namespace.
    const nhlId = String(player.nhlId || player.playerId || '').trim();
    if (nhlId && RUSSIAN_PLAYER_IDS.has(nhlId)) return true;
    return [
      player.nationality, player.countryCode, player.birthCountry, player.birthPlace,
      player.birthplace, player.country, player.citizenship, player.flag,
      player.displayBirthPlace, player.birthPlaceDisplay,
      player.birth?.country, player.birth?.countryCode, player.birth?.place
    ].some(countryValueIsRussian);
  }


  // --- National flags (birthCountry / nationality / citizenship) ---
  // NHL uses IOC/ISO-3166 alpha-3 (RUS, CAN, …). ESPN site.web often only has
  // free-text "City, ON/AB/NS" or "Moscow, USSR"; core API has birthCountry +
  // birthPlace.country. Harden with ISO map, province/state→country, city hints.
  const COUNTRY_ISO2 = {
    RUS: 'ru', RU: 'ru', RUSSIA: 'ru', USSR: 'ru', CCCP: 'ru', 'SOVIET UNION': 'ru',
    CAN: 'ca', CA: 'ca', CANADA: 'ca',
    USA: 'us', US: 'us', 'UNITED STATES': 'us', 'UNITED STATES OF AMERICA': 'us', 'U.S.A': 'us', 'U.S.A.': 'us',
    SWE: 'se', SE: 'se', SWEDEN: 'se',
    FIN: 'fi', FI: 'fi', FINLAND: 'fi',
    CZE: 'cz', CZ: 'cz', 'CZECH REPUBLIC': 'cz', CZECHIA: 'cz', TCH: 'cz',
    SVK: 'sk', SK: 'sk', SLOVAKIA: 'sk',
    CHE: 'ch', SUI: 'ch', SWITZERLAND: 'ch', CH: 'ch',
    DEU: 'de', GER: 'de', DE: 'de', GERMANY: 'de', FRG: 'de', GDR: 'de',
    LVA: 'lv', LAT: 'lv', LV: 'lv', LATVIA: 'lv',
    BLR: 'by', BY: 'by', BELARUS: 'by',
    UKR: 'ua', UA: 'ua', UKRAINE: 'ua',
    DNK: 'dk', DEN: 'dk', DK: 'dk', DENMARK: 'dk',
    NOR: 'no', NO: 'no', NORWAY: 'no',
    AUT: 'at', AT: 'at', AUSTRIA: 'at',
    SVN: 'si', SLO: 'si', SI: 'si', SLOVENIA: 'si',
    GBR: 'gb', GB: 'gb', 'UNITED KINGDOM': 'gb', 'GREAT BRITAIN': 'gb', ENGLAND: 'gb', SCOTLAND: 'gb', WALES: 'gb',
    AUS: 'au', AU: 'au', AUSTRALIA: 'au',
    FRA: 'fr', FR: 'fr', FRANCE: 'fr',
    POL: 'pl', PL: 'pl', POLAND: 'pl',
    HUN: 'hu', HU: 'hu', HUNGARY: 'hu',
    KAZ: 'kz', KZ: 'kz', KAZAKHSTAN: 'kz',
    LTU: 'lt', LT: 'lt', LITHUANIA: 'lt',
    EST: 'ee', EE: 'ee', ESTONIA: 'ee',
    NLD: 'nl', NED: 'nl', NL: 'nl', NETHERLANDS: 'nl', HOLLAND: 'nl',
    ITA: 'it', IT: 'it', ITALY: 'it',
    JPN: 'jp', JP: 'jp', JAPAN: 'jp',
    KOR: 'kr', KR: 'kr', 'SOUTH KOREA': 'kr', KOREA: 'kr',
    CHN: 'cn', CN: 'cn', CHINA: 'cn',
    BGR: 'bg', BUL: 'bg', BG: 'bg', BULGARIA: 'bg',
    HRV: 'hr', CRO: 'hr', HR: 'hr', CROATIA: 'hr',
    SRB: 'rs', RS: 'rs', SERBIA: 'rs', YUG: 'rs',
    BEL: 'be', BE: 'be', BELGIUM: 'be',
    IRL: 'ie', IE: 'ie', IRELAND: 'ie',
    NZL: 'nz', NZ: 'nz', 'NEW ZEALAND': 'nz',
    BRA: 'br', BR: 'br', BRAZIL: 'br',
    MEX: 'mx', MX: 'mx', MEXICO: 'mx',
    ISR: 'il', IL: 'il', ISRAEL: 'il',
    OAR: 'ru', ROC: 'ru',
    SVKIA: 'sk',
    LIE: 'li', LIECHTENSTEIN: 'li',
    AND: 'ad', ANDORRA: 'ad',
    ISL: 'is', IS: 'is', ICELAND: 'is',
    GRE: 'gr', GRC: 'gr', GR: 'gr', GREECE: 'gr',
    TUR: 'tr', TR: 'tr', TURKEY: 'tr', TURKIYE: 'tr',
    RSA: 'za', ZAF: 'za', 'SOUTH AFRICA': 'za',
    PHI: 'ph', PHL: 'ph', PH: 'ph', PHILIPPINES: 'ph',
    TPE: 'tw', TWN: 'tw', TAIWAN: 'tw',
    HKG: 'hk', HK: 'hk', 'HONG KONG': 'hk'
  };

  // ESPN displayBirthPlace often ends with a province/state code instead of a country.
  const REGION_TO_ISO2 = {
    // Canada
    ON: 'ca', AB: 'ca', BC: 'ca', MB: 'ca', SK: 'ca', QC: 'ca', PQ: 'ca',
    NS: 'ca', NB: 'ca', NL: 'ca', NF: 'ca', PE: 'ca', PEI: 'ca', NT: 'ca', NU: 'ca', YT: 'ca',
    ONTARIO: 'ca', ALBERTA: 'ca', 'BRITISH COLUMBIA': 'ca', MANITOBA: 'ca', SASKATCHEWAN: 'ca',
    QUEBEC: 'ca', QUÉBEC: 'ca', 'NOVA SCOTIA': 'ca', 'NEW BRUNSWICK': 'ca',
    'NEWFOUNDLAND': 'ca', 'NEWFOUNDLAND AND LABRADOR': 'ca', 'PRINCE EDWARD ISLAND': 'ca',
    // USA
    AL: 'us', AK: 'us', AZ: 'us', AR: 'us', CA: 'us', CO: 'us', CT: 'us', DE: 'us', FL: 'us',
    GA: 'us', HI: 'us', ID: 'us', IL: 'us', IN: 'us', IA: 'us', KS: 'us', KY: 'us', LA: 'us',
    ME: 'us', MD: 'us', MA: 'us', MI: 'us', MN: 'us', MS: 'us', MO: 'us', MT: 'us', NE: 'us',
    NV: 'us', NH: 'us', NJ: 'us', NM: 'us', NY: 'us', NC: 'us', ND: 'us', OH: 'us', OK: 'us',
    OR: 'us', PA: 'us', RI: 'us', SC: 'us', SD: 'us', TN: 'us', TX: 'us', UT: 'us', VT: 'us',
    VA: 'us', WA: 'us', WV: 'us', WI: 'us', WY: 'us', DC: 'us',
    // Note: CA is both Canada ISO2 and California — handled after country map / with context.
    MINNESOTA: 'us', MICHIGAN: 'us', MASSACHUSETTS: 'us', 'NEW YORK': 'us', 'NEW JERSEY': 'us',
    PENNSYLVANIA: 'us', ILLINOIS: 'us', WISCONSIN: 'us', 'NORTH DAKOTA': 'us', 'SOUTH DAKOTA': 'us',
    COLORADO: 'us', FLORIDA: 'us', TEXAS: 'us', CALIFORNIA: 'us', 'RHODE ISLAND': 'us'
  };

  // Common hockey birth cities when country/region is missing from the string.
  const CITY_TO_ISO2 = {
    MOSCOW: 'ru', 'ST PETERSBURG': 'ru', 'SAINT PETERSBURG': 'ru', 'ST. PETERSBURG': 'ru',
    MAGNITOGORSK: 'ru', YAROSLAVL: 'ru', CHELYABINSK: 'ru', KAZAN: 'ru', OMSK: 'ru',
    UFA: 'ru', NOVOSIBIRSK: 'ru', SAMARA: 'ru', TOLYATTI: 'ru', TOGLIATTI: 'ru',
    NIZHNEKAMSK: 'ru', CHEREPOVETS: 'ru', VOSKRESENSK: 'ru', PODOLSK: 'ru',
    KHABAROVSK: 'ru', VLADIVOSTOK: 'ru', PERM: 'ru', EKATERINBURG: 'ru', YEKATERINBURG: 'ru',
    NIZHNY: 'ru', 'NIZHNY NOVGOROD': 'ru', NOVOKUZNETSK: 'ru', TVER: 'ru',
    TORONTO: 'ca', MONTREAL: 'ca', VANCOUVER: 'ca', CALGARY: 'ca', EDMONTON: 'ca',
    OTTAWA: 'ca', WINNIPEG: 'ca', HALIFAX: 'ca', QUEBEC: 'ca', 'QUEBEC CITY': 'ca',
    'RICHMOND HILL': 'ca', 'COLE HARBOUR': 'ca', LONDON: 'ca', WINDSOR: 'ca',
    HELSINKI: 'fi', TAMPERE: 'fi', TURKU: 'fi', OULU: 'fi', ESPOO: 'fi',
    STOCKHOLM: 'se', GOTHENBURG: 'se', GOTEBORG: 'se', 'GÖTEBORG': 'se', MALMO: 'se',
    PRAGUE: 'cz', BRNO: 'cz', BRATISLAVA: 'sk',
    RIGA: 'lv', MINSK: 'by', KIEV: 'ua', KYIV: 'ua',
    BERN: 'ch', ZURICH: 'ch', 'ZÜRICH': 'ch', GENEVA: 'ch',
    BERLIN: 'de', MUNICH: 'de', 'MÜNCHEN': 'de', COLOGNE: 'de',
    BRNO: 'cz', PARDUBICE: 'cz',
  };

  const COUNTRY_LABEL_RU = {
    ru: 'Россия', ca: 'Канада', us: 'США', se: 'Швеция', fi: 'Финляндия',
    cz: 'Чехия', sk: 'Словакия', ch: 'Швейцария', de: 'Германия', lv: 'Латвия',
    by: 'Беларусь', ua: 'Украина', dk: 'Дания', no: 'Норвегия', at: 'Австрия',
    si: 'Словения', gb: 'Великобритания', au: 'Австралия', fr: 'Франция',
    pl: 'Польша', hu: 'Венгрия', kz: 'Казахстан', lt: 'Литва', ee: 'Эстония',
    nl: 'Нидерланды', it: 'Италия', jp: 'Япония', kr: 'Южная Корея', cn: 'Китай',
    bg: 'Болгария', hr: 'Хорватия', rs: 'Сербия', be: 'Бельгия', ie: 'Ирландия',
    nz: 'Новая Зеландия', br: 'Бразилия', mx: 'Мексика', il: 'Израиль',
    li: 'Лихтенштейн', is: 'Исландия', gr: 'Греция', tr: 'Турция', za: 'ЮАР',
    ph: 'Филиппины', tw: 'Тайвань', hk: 'Гонконг', ad: 'Андорра'
  };

  function normalizeCountryKey(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[._]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function iso2FromCountryToken(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const key = normalizeCountryKey(raw);
    if (COUNTRY_ISO2[key]) return COUNTRY_ISO2[key];
    // Free-text: "Moscow, Russia" / "Helsinki, Finland" / "Richmond Hill, ON"
    const parts = key.split(',').map(part => part.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (COUNTRY_ISO2[part]) return COUNTRY_ISO2[part];
      // Prefer Canadian provinces over ambiguous US state codes when trailing token.
      if (REGION_TO_ISO2[part] && part !== 'CA') return REGION_TO_ISO2[part];
      // Trailing "CA" in "City, CA" is California (US) in ESPN style; "CAN" already handled.
      if (part === 'CA' && parts.length > 1) return 'us';
    }
    for (const [name, iso2] of Object.entries(COUNTRY_ISO2)) {
      if (name.length > 3 && key.includes(name)) return iso2;
    }
    // City-only fallback (first segment or whole string)
    const city = normalizeCountryKey(parts[0] || key);
    if (CITY_TO_ISO2[city]) return CITY_TO_ISO2[city];
    for (const [name, iso2] of Object.entries(CITY_TO_ISO2)) {
      if (name.length > 4 && city.includes(name)) return iso2;
    }
    return '';
  }

  function flagEmojiFromIso2(iso2) {
    const cc = String(iso2 || '').toLowerCase();
    if (!/^[a-z]{2}$/.test(cc)) return '';
    const upper = cc.toUpperCase();
    return String.fromCodePoint(...[...upper].map(ch => 127397 + ch.charCodeAt(0)));
  }

  function extractCountryCandidates(player = {}) {
    const out = [];
    const push = (value) => {
      if (value == null || value === '') return;
      out.push(value);
    };
    push(player.birthCountry);
    push(player.nationality);
    push(player.countryCode);
    push(player.country);
    push(player.citizenship);
    push(player.citizenOf);
    push(player.displayBirthPlace);
    push(player.birthPlace);
    push(player.birthplace);
    push(player.birthPlaceDisplay);
    push(player.birthCity);
    push(player.birth?.country);
    push(player.birth?.countryCode);
    push(player.birth?.place);
    // Nested ESPN / NHL shapes
    const bp = player.birthPlace;
    if (bp && typeof bp === 'object') {
      push(bp.country);
      push(bp.countryCode);
      push(bp.abbreviation);
      push(bp.state);
      push(bp.city);
      if (bp.city || bp.state || bp.country) {
        push([bp.city, bp.state, bp.country].filter(Boolean).join(', '));
      }
    }
    const bc = player.birthCountry;
    if (bc && typeof bc === 'object') {
      push(bc.abbreviation);
      push(bc.code);
      push(bc.name);
      push(bc.default);
    }
    return out;
  }

  function resolvePlayerFlag(player = {}) {
    let iso2 = '';
    for (const value of extractCountryCandidates(player)) {
      if (typeof value === 'object' && value) {
        iso2 = iso2FromCountryToken(
          value.abbreviation || value.code || value.default || value.name || value.country || loc(value)
        );
      } else {
        iso2 = iso2FromCountryToken(value);
      }
      if (iso2) break;
    }
    if (!iso2 && player?.name && RUSSIAN_NAME_FALLBACKS.has(normalizedName(player.name))) {
      iso2 = 'ru';
    }
    if (!iso2) return null;
    const emoji = flagEmojiFromIso2(iso2);
    return {
      iso2,
      emoji,
      label: COUNTRY_LABEL_RU[iso2] || iso2.toUpperCase(),
      img: `https://flagcdn.com/w40/${iso2}.png`
    };
  }

  // --- Trophies: club cups + national medals (individual awards stay separate) ---
  const MEDAL_LABEL_RU = { gold: 'золото', silver: 'серебро', bronze: 'бронза', appearance: 'участие' };
  const MEDAL_RANK = { gold: 0, silver: 1, bronze: 2, appearance: 3 };

  function calendarYearLabel(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const m = text.match(/(\d{4})/);
    return m ? m[1] : text;
  }

  function clubTrophyCanonical(name) {
    const n = String(name || '').toLowerCase().replace(/[“”"]/g, '"');
    // Club trophies: NHL Stanley Cup + KHL Gagarin Cup. AHL Calder Cup omitted (unreliable).
    if (/stanley\s*cup/.test(n)) return { key: 'stanley', name: 'Кубок Стэнли' };
    if (/gagarin/.test(n)) return { key: 'gagarin', name: 'Кубок Гагарина' };
    return null;
  }

  function nationalTrophyCanonical(name) {
    const n = String(name || '').toLowerCase();
    if (/olympic|olympiad|олимп/.test(n)) return { key: 'olympics', name: 'Олимпиада' };
    if (/world\s*junior|wjc|u-?20|мчм|юниор/.test(n)) return { key: 'wjc', name: 'МЧМ (U20)' };
    if (/\bu-?18\b|world\s*u18|юнош/.test(n)) return { key: 'u18', name: 'U18' };
    if (/world\s*championship|\bwc\b|чемпионат мира|\bчм\b/.test(n)) {
      return { key: 'wc', name: 'ЧМ' };
    }
    return null;
  }

  function awardBucket(name) {
    if (clubTrophyCanonical(name)) return 'club';
    if (nationalTrophyCanonical(name)) return 'national';
    return 'individual';
  }

  // Curated NATIONAL + sparse All-Star / KHL Gagarin fallbacks.
  // Primary national + First All-Star coverage: assets/nhl-trophies.json (all nationalities).
  // Stanley Cup: NHL landing awards and/or nhl-trophies.json.
  // Keyed by NHL playerId; optional `names` for ESPN-only lookups.
  // AHL Calder Cup omitted. KHL Gagarin Cup kept via curated + API name match.
  const CURATED_PLAYER_TROPHIES = {
    '8471214': { // Alexander Ovechkin
      names: ['alexander ovechkin', 'alex ovechkin'],
      national: [
        { key: 'olympics', medal: 'appearance', seasons: ['2006', '2010', '2014'] },
        { key: 'wc', medal: 'gold', seasons: ['2008', '2012', '2014'] },
        { key: 'wc', medal: 'silver', seasons: ['2010', '2015'] },
        { key: 'wc', medal: 'bronze', seasons: ['2005', '2007', '2016', '2019'] },
        { key: 'wjc', medal: 'gold', seasons: ['2003'] },
        { key: 'wjc', medal: 'silver', seasons: ['2005'] },
        { key: 'u18', medal: 'silver', seasons: ['2002'] },
        { key: 'u18', medal: 'bronze', seasons: ['2003'] }
      ],
      club: [
      ],
      individual: [
        { name: 'NHL First All-Star Team', seasons: ['2005/06', '2006/07', '2007/08', '2008/09', '2009/10', '2012/13', '2014/15', '2018/19'] },
        { name: 'NHL Second All-Star Team', seasons: ['2010/11', '2012/13', '2013/14', '2015/16'] },
        { name: 'NHL All-Star Game', seasons: ['2007', '2008', '2009', '2011', '2015', '2017', '2018', '2022', '2023'] }
      ]
    },
    '8471215': { // Evgeni Malkin
      names: ['evgeni malkin', 'yevgeni malkin', 'evgeny malkin'],
      national: [
        { key: 'olympics', medal: 'appearance', seasons: ['2006', '2010', '2014'] },
        { key: 'wc', medal: 'gold', seasons: ['2012', '2014'] },
        { key: 'wc', medal: 'silver', seasons: ['2010', '2015'] },
        { key: 'wc', medal: 'bronze', seasons: ['2005', '2007', '2019'] },
        { key: 'wjc', medal: 'silver', seasons: ['2005', '2006'] },
        { key: 'u18', medal: 'gold', seasons: ['2004'] },
        { key: 'u18', medal: 'bronze', seasons: ['2003'] }
      ],
      club: [
      ],
      individual: []
    },
    '8478864': { // Kirill Kaprizov
      names: ['kirill kaprizov'],
      national: [
        { key: 'olympics', medal: 'gold', seasons: ['2018'] },
        { key: 'wc', medal: 'bronze', seasons: ['2019'] },
        { key: 'wjc', medal: 'silver', seasons: ['2016'] },
        { key: 'wjc', medal: 'bronze', seasons: ['2017'] }
      ],
      club: [
        { key: 'gagarin', seasons: ['2018/19'] }
      ],
      individual: []
    },
    '8478550': { // Artemi Panarin
      names: ['artemi panarin'],
      national: [
        { key: 'wc', medal: 'silver', seasons: ['2015'] },
        { key: 'wc', medal: 'bronze', seasons: ['2016', '2017'] },
        { key: 'wjc', medal: 'gold', seasons: ['2011'] }
      ],
      club: [
        { key: 'gagarin', seasons: ['2014/15'] }
      ],
      individual: []
    },
    '8476883': { // Andrei Vasilevskiy
      names: ['andrei vasilevskiy', 'andrey vasilevskiy'],
      national: [
        { key: 'wc', medal: 'gold', seasons: ['2014'] },
        { key: 'wc', medal: 'bronze', seasons: ['2017', '2019'] },
        { key: 'wjc', medal: 'bronze', seasons: ['2013', '2014'] }
      ],
      club: [
        { key: 'gagarin', seasons: ['2010/11'] }
      ],
      individual: []
    },
    '8476453': { // Nikita Kucherov
      names: ['nikita kucherov'],
      national: [
        { key: 'olympics', medal: 'appearance', seasons: ['2014'] },
        { key: 'wc', medal: 'gold', seasons: ['2014'] },
        { key: 'wc', medal: 'bronze', seasons: ['2017', '2019'] },
        { key: 'wjc', medal: 'bronze', seasons: ['2013'] },
        { key: 'u18', medal: 'bronze', seasons: ['2011'] }
      ],
      club: [
      ],
      individual: []
    },
    '8478048': { // Igor Shesterkin
      names: ['igor shesterkin', 'igor shestyorkin'],
      national: [
        { key: 'wjc', medal: 'silver', seasons: ['2015'] }
      ],
      club: [],
      individual: []
    },
    '8478009': { // Ilya Sorokin
      names: ['ilya sorokin'],
      national: [
        { key: 'olympics', medal: 'gold', seasons: ['2018'] },
        { key: 'wc', medal: 'bronze', seasons: ['2019'] },
        { key: 'wjc', medal: 'bronze', seasons: ['2015'] }
      ],
      club: [
        { key: 'gagarin', seasons: ['2013/14'] }
      ],
      individual: []
    },
    '8480830': { // Andrei Svechnikov
      names: ['andrei svechnikov'],
      national: [
        { key: 'wjc', medal: 'bronze', seasons: ['2018'] },
        { key: 'u18', medal: 'bronze', seasons: ['2017'] }
      ],
      club: [],
      individual: []
    },
    '8479410': { // Mikhail Sergachev
      names: ['mikhail sergachev', 'mikhail sergachyov'],
      national: [
        { key: 'olympics', medal: 'appearance', seasons: ['2022'] },
        { key: 'wjc', medal: 'silver', seasons: ['2016'] },
        { key: 'u18', medal: 'bronze', seasons: ['2015'] }
      ],
      club: [
      ],
      individual: []
    },
    '8484387': { // Matvei Michkov
      names: ['matvei michkov'],
      national: [
        { key: 'wjc', medal: 'silver', seasons: ['2023'] },
        { key: 'u18', medal: 'silver', seasons: ['2021'] }
      ],
      club: [],
      individual: []
    }
  };

  const NATIONAL_KEY_META = {
    olympics: { name: 'Олимпиада' },
    wc: { name: 'ЧМ' },
    wjc: { name: 'МЧМ (U20)' },
    u18: { name: 'U18' }
  };

  const CLUB_KEY_META = {
    stanley: { name: 'Кубок Стэнли' },
    gagarin: { name: 'Кубок Гагарина' }
  };

  function curatedEntryForPlayer(nhlId, name) {
    const idKey = nhlId != null && nhlId !== '' ? String(nhlId) : '';
    if (idKey && CURATED_PLAYER_TROPHIES[idKey]) return CURATED_PLAYER_TROPHIES[idKey];
    const needle = normalizedName(name);
    if (!needle) return null;
    return Object.values(CURATED_PLAYER_TROPHIES).find(entry =>
      (entry.names || []).some(alias => normalizedName(alias) === needle)
    ) || null;
  }

  function pushTrophy(map, { key, name, medal, seasons, seasonMode }) {
    if (!key && !name) return;
    const label = name || (medal
      ? (NATIONAL_KEY_META[key]?.name || key)
      : (CLUB_KEY_META[key]?.name || NATIONAL_KEY_META[key]?.name || key));
    const mapKey = `${key || label}::${medal || ''}`;
    if (!map.has(mapKey)) {
      map.set(mapKey, {
        key: key || '',
        name: label,
        medal: medal || '',
        medalLabel: medal ? (MEDAL_LABEL_RU[medal] || medal) : '',
        seasons: new Set()
      });
    }
    const row = map.get(mapKey);
    (seasons || []).forEach(season => {
      let text = '';
      if (seasonMode === 'calendar') {
        text = calendarYearLabel(
          season?.seasonId ?? season?.season?.displayName ?? season?.season?.year ?? season?.year ?? season
        );
      } else if (seasonMode === 'raw') {
        text = String(season ?? '').trim();
      } else {
        text = awardSeasonLabel(
          season?.seasonId ?? season?.season?.displayName ?? season?.season?.year ?? season?.year ?? season
        );
      }
      if (text && text !== '[object Object]') row.seasons.add(text);
    });
  }

  function finalizeTrophyMap(map, { national = false } = {}) {
    return [...map.values()]
      .map(row => ({
        key: row.key,
        name: row.name,
        medal: row.medal,
        medalLabel: row.medalLabel,
        seasons: [...row.seasons].sort((a, b) => b.localeCompare(a))
      }))
      .filter(row => row.seasons.length)
      .sort((a, b) => {
        if (national) {
          const order = { olympics: 0, wc: 1, wjc: 2, u18: 3 };
          const ka = order[a.key] ?? 9;
          const kb = order[b.key] ?? 9;
          if (ka !== kb) return ka - kb;
          return (MEDAL_RANK[a.medal] ?? 9) - (MEDAL_RANK[b.medal] ?? 9);
        }
        const order = { stanley: 0, gagarin: 1 };
        const ka = order[a.key] ?? 9;
        const kb = order[b.key] ?? 9;
        if (ka !== kb) return ka - kb;
        return (b.seasons[0] || '').localeCompare(a.seasons[0] || '');
      });
  }

  function expandCuratedList(list, kind) {
    return (list || []).map(item => {
      if (kind === 'national') {
        const meta = NATIONAL_KEY_META[item.key] || { name: item.key };
        return {
          key: item.key,
          name: meta.name,
          medal: item.medal || '',
          seasons: item.seasons || [],
          seasonMode: 'calendar'
        };
      }
      const meta = CLUB_KEY_META[item.key] || { name: item.key };
      return {
        key: item.key,
        name: meta.name,
        seasons: item.seasons || [],
        seasonMode: 'raw'
      };
    });
  }

  function splitAwardEntries(entries = []) {
    const individual = [];
    const club = [];
    const national = [];
    entries.forEach(entry => {
      const rawName = awardName(entry?.name || entry?.trophy);
      if (!rawName) return;
      const name = canonicalAwardName(rawName) || rawName;
      const seasons = entry.seasons || [];
      const bucket = awardBucket(name);
      if (bucket === 'club') {
        const canon = clubTrophyCanonical(name);
        club.push({
          key: canon.key,
          name: canon.name,
          seasons,
          seasonMode: 'nhl'
        });
      } else if (bucket === 'national') {
        const canon = nationalTrophyCanonical(name);
        let medal = '';
        const lower = name.toLowerCase();
        if (/gold|золот/.test(lower)) medal = 'gold';
        else if (/silver|серебр/.test(lower)) medal = 'silver';
        else if (/bronze|бронз/.test(lower)) medal = 'bronze';
        national.push({
          key: canon.key,
          name: canon.name,
          medal,
          seasons,
          seasonMode: 'calendar'
        });
      } else {
        individual.push({ name, seasons });
      }
    });
    return { individual, club, national };
  }

  function normalizeAwards(entries = []) {
    const { individual } = splitAwardEntries(entries);
    const byName = new Map();
    individual.forEach(entry => {
      const name = canonicalAwardName(entry?.name || entry?.trophy);
      if (!name) return;
      const seasons = (entry.seasons || []).map(season => {
        if (season && typeof season === 'object' && season.__rawSeason != null) {
          return String(season.__rawSeason).trim();
        }
        return awardSeasonLabel(
          season?.seasonId ?? season?.season?.displayName ?? season?.season?.year ?? season?.year ?? season
        );
      }).filter(Boolean);
      if (!byName.has(name)) byName.set(name, new Set());
      seasons.forEach(season => byName.get(name).add(season));
    });
    return [...byName.entries()]
      .map(([name, seasons]) => ({
        name,
        seasons: [...seasons].sort((a, b) => b.localeCompare(a))
      }))
      .filter(award => award.seasons.length)
      .sort((a, b) => allStarSortKey(a.name) - allStarSortKey(b.name)
        || (b.seasons[0] || '').localeCompare(a.seasons[0] || '')
        || a.name.localeCompare(b.name));
  }

  function allStarSortKey(name) {
    const n = String(name || '').toLowerCase();
    if (/first/.test(n) && /all[-\s]?star/.test(n)) return 0;
    if (/second/.test(n) && /all[-\s]?star/.test(n)) return 1;
    if (/all[-\s]?star\s*game/.test(n)) return 2;
    if (/all[-\s]?rookie/.test(n)) return 3;
    return 8;
  }

  function canonicalAwardName(value) {
    const name = awardName(value);
    if (!name) return '';
    const n = name.toLowerCase().replace(/[“”"]/g, '"');
    if (/first/.test(n) && /all[-\s]?star/.test(n) && /team/.test(n)) return 'NHL First All-Star Team';
    if (/second/.test(n) && /all[-\s]?star/.test(n) && /team/.test(n)) return 'NHL Second All-Star Team';
    if (/all[-\s]?star/.test(n) && /game/.test(n) && !/team/.test(n) && !/skills|breakaway|shot/.test(n)) {
      return 'NHL All-Star Game';
    }
    if (/all[-\s]?rookie/.test(n)) return 'NHL All-Rookie Team';
    if (/maurice|rocket/.test(n) && /richard/.test(n)) return 'Maurice “Rocket” Richard Trophy';
    return name;
  }

  let trophyIndexPromise = null;
  let trophyIndexCache = null;

  function trophyIndexUrl() {
    try {
      const base = document.currentScript?.src || window.location.href;
      return new URL('../assets/nhl-trophies.json', base.includes('/js/') ? base : './js/api.js').href;
    } catch {
      return './assets/nhl-trophies.json';
    }
  }

  async function loadTrophyIndex() {
    if (trophyIndexCache) return trophyIndexCache;
    if (trophyIndexPromise) return trophyIndexPromise;
    trophyIndexPromise = (async () => {
      try {
        const response = await fetch('./assets/nhl-trophies.json', { cache: 'force-cache' });
        if (!response.ok) throw new Error(`trophy index ${response.status}`);
        trophyIndexCache = await response.json();
      } catch (error) {
        console.warn('[NHL Diggest] trophy index load failed', error);
        trophyIndexCache = {
          stanleyByPlayerId: {},
          stanleyByName: {},
          teamTrophiesByAbbrev: {},
          retiredNumbersByAbbrev: {},
          firstAllStarByPlayerId: {},
          firstAllStarByName: {},
          secondAllStarByPlayerId: {},
          secondAllStarByName: {},
          nationalByPlayerId: {},
          nationalByName: {}
        };
      }
      return trophyIndexCache;
    })();
    return trophyIndexPromise;
  }

  let capHitsPromise = null;
  let capHitsCache = null;

  function capHitsUrl() {
    try {
      const base = document.currentScript?.src || window.location.href;
      return new URL('../assets/cap-hits.json', base.includes('/js/') ? base : './js/api.js').href;
    } catch {
      return './assets/cap-hits.json';
    }
  }

  async function loadCapHitsIndex() {
    if (capHitsCache) return capHitsCache;
    if (capHitsPromise) return capHitsPromise;
    capHitsPromise = (async () => {
      try {
        const response = await fetch('./assets/cap-hits.json', { cache: 'force-cache' });
        if (!response.ok) throw new Error(`cap-hits ${response.status}`);
        capHitsCache = await response.json();
      } catch (error) {
        console.warn('[NHL Diggest] cap-hits load failed', error);
        capHitsCache = { teams: {}, playersByNhlId: {}, playersByName: {} };
      }
      return capHitsCache;
    })();
    return capHitsPromise;
  }

  function normalizedPlayerKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function mapPuckpediaPlayerContract(entry) {
    if (!entry || entry.capHit == null) return null;
    const capHit = formatMoneyUsd(entry.capHit);
    let through = '';
    if (entry.expiryStatus && entry.expiryYear) through = `${entry.expiryStatus} ${entry.expiryYear}`;
    else if (entry.expiryYear) through = String(entry.expiryYear);
    else if (entry.expiryStatus) through = String(entry.expiryStatus);
    const out = {
      capHit: capHit || '',
      signed: '',
      through,
      source: 'puckpedia'
    };
    return out.capHit || out.through ? out : null;
  }

  async function loadPuckpediaContract({ nhlId, name } = {}) {
    const index = await loadCapHitsIndex();
    const byId = index?.playersByNhlId || {};
    const idKey = nhlId != null && nhlId !== '' ? String(nhlId) : '';
    if (idKey && byId[idKey]) return mapPuckpediaPlayerContract(byId[idKey]);
    const key = normalizedPlayerKey(name);
    const byName = index?.playersByName || {};
    if (key && byName[key]) return mapPuckpediaPlayerContract(byName[key]);
    return null;
  }

  async function loadPuckpediaTeamCap(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    if (!key) return null;
    const index = await loadCapHitsIndex();
    const raw = (index?.teams || {})[key];
    if (!raw) return null;
    return mapTeamSalaryCap({
      capHit: raw.capHit,
      capSpace: raw.capSpace ?? raw.currentSpace,
      salaryCap: raw.ceiling
    });
  }

  function lookupStanleySeasons(index, nhlId, name) {
    if (!index) return [];
    const idKey = nhlId != null && nhlId !== '' ? String(nhlId) : '';
    const fromId = idKey ? (index.stanleyByPlayerId || {})[idKey] : null;
    if (fromId?.length) return fromId.slice();
    const needle = normalizedName(name);
    if (!needle) return [];
    const fromName = (index.stanleyByName || {})[needle];
    return fromName?.length ? fromName.slice() : [];
  }

  function lookupIndexList(index, idMapKey, nameMapKey, nhlId, name) {
    if (!index) return null;
    const idKey = nhlId != null && nhlId !== '' ? String(nhlId) : '';
    const fromId = idKey ? (index[idMapKey] || {})[idKey] : null;
    if (fromId?.length) return fromId;
    const needle = normalizedName(name);
    if (!needle) return null;
    const fromName = (index[nameMapKey] || {})[needle];
    return fromName?.length ? fromName : null;
  }

  function lookupFirstAllStarSeasons(index, nhlId, name) {
    const list = lookupIndexList(index, 'firstAllStarByPlayerId', 'firstAllStarByName', nhlId, name);
    return list ? list.slice() : [];
  }

  function lookupSecondAllStarSeasons(index, nhlId, name) {
    const list = lookupIndexList(index, 'secondAllStarByPlayerId', 'secondAllStarByName', nhlId, name);
    return list ? list.slice() : [];
  }

  function lookupNationalEntries(index, nhlId, name) {
    const list = lookupIndexList(index, 'nationalByPlayerId', 'nationalByName', nhlId, name);
    return list ? list.map(item => ({ ...item, seasons: (item.seasons || []).slice() })) : [];
  }

  function teamTrophiesForAbbrev(index, abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    const rows = (index?.teamTrophiesByAbbrev || {})[key] || [];
    // Team cards: Stanley Cup championships only (no conference/presidents trophies).
    return rows.filter(row => {
      const k = String(row?.key || '').toLowerCase();
      const n = String(row?.name || '').toLowerCase();
      return k === 'stanley' || /stanley|стэнли|стенли/.test(n);
    }).map(row => ({
      key: 'stanley',
      name: row.name || 'Кубок Стэнли',
      seasons: Array.isArray(row.seasons) ? row.seasons.slice() : []
    })).filter(row => row.seasons.length);
  }

  function retiredNumbersForAbbrev(index, abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    return (index?.retiredNumbersByAbbrev || {})[key] || [];
  }

  function buildPlayerTrophies({
    awardEntries = [],
    nhlId = '',
    name = '',
    stanleySeasons = [],
    firstAllStarSeasons = [],
    secondAllStarSeasons = [],
    nationalEntries = []
  } = {}) {
    const split = splitAwardEntries(awardEntries);
    const curated = curatedEntryForPlayer(nhlId, name);
    const clubMap = new Map();
    const nationalMap = new Map();

    // Live API awards first (NHL landing Stanley Cup, ESPN individual, etc.)
    split.club.forEach(item => pushTrophy(clubMap, item));
    split.national.forEach(item => pushTrophy(nationalMap, item));

    // Nationality-agnostic Stanley Cup index (NHL records) — fills ESPN CORS path
    // and any Cup winner missing from landing awards.
    if (stanleySeasons?.length) {
      pushTrophy(clubMap, {
        key: 'stanley',
        name: 'Кубок Стэнли',
        seasons: stanleySeasons,
        seasonMode: 'raw'
      });
    }

    // Multi-nationality national medals/appearances from trophy index (not Russia-only).
    (nationalEntries || []).forEach(item => {
      pushTrophy(nationalMap, {
        key: item.key,
        name: NATIONAL_KEY_META[item.key]?.name || item.key,
        medal: item.medal || '',
        seasons: item.seasons || [],
        seasonMode: 'calendar'
      });
    });

    // Curated: national medals + KHL Gagarin fallbacks (index wins on overlap via Set merge).
    if (curated) {
      expandCuratedList(curated.club, 'club').forEach(item => pushTrophy(clubMap, item));
      expandCuratedList(curated.national, 'national').forEach(item => pushTrophy(nationalMap, item));
    }

    const individualEntries = split.individual.map(item => ({ name: item.name, seasons: item.seasons }));

    // Root cause fix: ESPN often returns only Second All-Star Team. Previously any
    // All-Star presence skipped curated First Team entirely. Always merge First/Second
    // from the historical index (Hockey-Reference / Wikipedia), then curated gaps.
    function pushIndividualAward(awardName, seasons) {
      if (!awardName || !seasons?.length) return;
      individualEntries.push({
        name: awardName,
        seasons: seasons.map(season => ({ __rawSeason: String(season) }))
      });
    }
    pushIndividualAward('NHL First All-Star Team', firstAllStarSeasons);
    pushIndividualAward('NHL Second All-Star Team', secondAllStarSeasons);

    if (curated?.individual?.length) {
      curated.individual.forEach(item => {
        if (!item?.name) return;
        const canon = canonicalAwardName(item.name) || item.name;
        const have = individualEntries.some(entry => {
          const existing = canonicalAwardName(entry.name) || entry.name;
          return existing === canon;
        });
        // Fill curated award only when API/index did not already supply that exact award.
        if (!have) {
          pushIndividualAward(canon, item.seasons || []);
        }
      });
    }

    return {
      club: finalizeTrophyMap(clubMap),
      national: finalizeTrophyMap(nationalMap, { national: true }),
      individual: normalizeAwards(individualEntries)
    };
  }

  function formatMoneyUsd(value, { allowZero = false, allowNegative = false } = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    if (num === 0) return (allowZero || allowNegative) ? '$0' : '';
    if (num < 0 && !allowNegative) return '';
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    if (abs >= 1_000_000) {
      const m = abs / 1_000_000;
      return `${sign}$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2)}M`;
    }
    if (abs >= 1_000) return `${sign}$${Math.round(abs / 1000)}K`;
    return `${sign}$${Math.round(abs)}`;
  }

  function mapNhlContract(landing = {}) {
    const raw = landing.contract || landing.playerContract || landing.currentContract || null;
    if (!raw || typeof raw !== 'object') return null;
    const capHit = raw.capHit ?? raw.avgAnnual ?? raw.aav ?? raw.averageAnnualValue ?? raw.salary;
    const signed = raw.signingDate || raw.signedDate || raw.dateSigned || raw.contractSigningDate || '';
    const expiry = raw.expirationYear || raw.expiryYear || raw.contractExpiry || raw.throughSeason
      || raw.seasonEnd || raw.endSeason || raw.expirationSeason || '';
    const through = raw.throughSeasonLabel || (expiry
      ? (String(expiry).length === 8
        ? `${String(expiry).slice(0, 4)}/${String(expiry).slice(6)}`
        : String(expiry))
      : '');
    const out = {
      capHit: formatMoneyUsd(capHit) || (typeof capHit === 'string' ? capHit : ''),
      signed: signed ? String(signed).slice(0, 10) : '',
      through: through || ''
    };
    return out.capHit || out.signed || out.through ? out : null;
  }

  async function loadEspnContract(espnId) {
    if (!espnId) return null;
    try {
      const data = await fetchJson(`${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/athletes/${espnId}/contracts?lang=en&region=us`);
      const items = data?.items || [];
      if (!items.length) return null;
      let contract = items[0];
      const ref = (contract?.$ref || '').replace('http://', 'https://');
      if (ref) {
        try { contract = await fetchJson(ref); } catch { /* keep stub */ }
      }
      const capHit = contract?.capHit || contract?.averageYearly || contract?.salary || contract?.value;
      const signed = contract?.signingDate || contract?.dateSigned || contract?.startDate || '';
      const end = contract?.endDate || contract?.expirationDate || contract?.throughDate || '';
      const seasons = contract?.seasons || contract?.season || '';
      let through = '';
      if (seasons) through = String(Array.isArray(seasons) ? seasons[seasons.length - 1] : seasons);
      else if (end) through = String(end).slice(0, 10);
      const out = {
        capHit: formatMoneyUsd(capHit) || (typeof capHit === 'string' ? capHit : ''),
        signed: signed ? String(signed).slice(0, 10) : '',
        through
      };
      return out.capHit || out.signed || out.through ? out : null;
    } catch {
      return null;
    }
  }


  function loc(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object') return value.default || value.en || Object.values(value)[0] || '';
    return String(value);
  }

  function playerName(first, last) {
    return `${loc(first)} ${loc(last)}`.trim();
  }

  function logoFor(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    const slug = ESPN_SLUG[key] || key.toLowerCase();
    if (!slug) return '';
    return `https://a.espncdn.com/i/teamlogos/nhl/500/${slug}.png`;
  }

  // Primary mug / jersey accents for circular headshots (UI, not official brand guide).
  const TEAM_COLORS = {
    ANA: '#F47A38', ARI: '#8C2633', BOS: '#FFB81C', BUF: '#003087',
    CGY: '#D2001C', CAR: '#CC0000', CHI: '#CF0A2C', COL: '#6F263D',
    CBJ: '#002654', DAL: '#006847', DET: '#CE1126', EDM: '#FC4C02',
    FLA: '#C8102E', LAK: '#A2AAAD', MIN: '#154734', MTL: '#AF1E2D',
    NSH: '#FFB81C', NJD: '#CE1126', NYI: '#00539B', NYR: '#0038A8',
    OTT: '#C52032', PHI: '#F74902', PIT: '#FCB514', SJS: '#006D75',
    SEA: '#99D9D9', STL: '#002F87', TBL: '#002868', TOR: '#00205B',
    UTA: '#6AC7EE', VAN: '#00205B', VGK: '#B4975A', WPG: '#041E42',
    WSH: '#C8102E'
  };

  function teamColorFor(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    return TEAM_COLORS[key] || '#2a3d55';
  }

  async function fetchJson(url, timeoutMs = 12000) {
    const supportsAbort = typeof AbortController === 'function';
    const controller = supportsAbort ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort?.(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function cached(key, loader) {
    if (cache.has(key)) return cache.get(key);
    const value = await loader();
    cache.set(key, value);
    return value;
  }

  function mskDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  function shiftDate(dateKey, days) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + days));
    return next.toISOString().slice(0, 10);
  }

  function formatMskTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }


  function gameStatus(gameState) {
    const state = String(gameState || '').toUpperCase();
    if (LIVE.has(state)) return 'Live';
    if (FINAL.has(state)) return 'Final';
    return 'FUT';
  }

  function periodLabel(game, status) {
    const desc = game.periodDescriptor || {};
    const num = desc.number;
    const type = String(desc.periodType || '').toUpperCase();
    if (status === 'FUT') return '';
    if (status === 'Live') {
      const clock = loc(game.clock?.timeRemaining) || loc(game.clock?.inIntermission);
      if (type === 'OT') return clock ? `OT ${clock}` : 'OT';
      if (type === 'SO') return 'SO';
      return clock ? `${num || ''} · ${clock}`.trim() : `${num || ''}`.trim();
    }
    // Final: only surface OT/SO; regulation stays blank under the score.
    if (game.gameOutcome?.lastPeriodType === 'OT' || type === 'OT') return 'OT';
    if (game.gameOutcome?.lastPeriodType === 'SO' || type === 'SO') return 'SO';
    return '';
  }

  function mapNhlTeam(team) {
    const short = loc(team?.abbrev).toUpperCase();
    // Scoreboard uses { name: { default } }; schedule uses placeName/commonName.
    const place = loc(team?.placeName) || loc(team?.commonName) || loc(team?.name) || short;
    const nick = loc(team?.commonName) || loc(team?.teamName) || loc(team?.name) || short;
    return {
      name: place,
      nick,
      short,
      logo: logoFor(short),
      score: team?.score == null || team?.score === '' ? null : Number(team.score)
    };
  }

  function mapNhlGame(game) {
    const status = gameStatus(game.gameState);
    const type = Number(game.gameType);
    const time = status === 'Final'
      ? 'Завершён'
      : status === 'Live'
        ? 'LIVE'
        : formatMskTime(game.startTimeUTC) || '—';
    return {
      id: game.id,
      gameType: type,
      preseason: type === 1,
      status,
      time,
      period: periodLabel(game, status),
      venue: loc(game.venue?.default) || loc(game.venue),
      startTimeUTC: game.startTimeUTC || '',
      threeMinRecap: game.threeMinRecap || '',
      condensedGame: game.condensedGame || '',
      away: mapNhlTeam(game.awayTeam),
      home: mapNhlTeam(game.homeTeam)
    };
  }

  function extractNhlGames(payload, dateKey) {
    let games = payload?.games;
    if (!Array.isArray(games)) {
      const week = payload?.gameWeek || [];
      const day = week.find(item => item.date === dateKey) || week[0];
      games = day?.games || [];
    }
    return games.map(mapNhlGame);
  }

  function parseEspnScore(rawScore, { allowZero = true } = {}) {
    if (rawScore == null || rawScore === '') return null;
    if (typeof rawScore === 'object') {
      const nested = rawScore.value ?? rawScore.displayValue ?? rawScore.score;
      return parseEspnScore(nested, { allowZero });
    }
    const scoreNum = Number(rawScore);
    if (!Number.isFinite(scoreNum)) return null;
    if (!allowZero && scoreNum === 0) return null;
    return scoreNum;
  }

  function mapEspnEvent(event) {
    const comp = (event.competitions || [])[0] || {};
    const competitors = comp.competitors || [];
    const awayRaw = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
    const homeRaw = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
    const statusType = event.status?.type || comp.status?.type || {};
    const typeName = String(statusType.name || '');
    const state = String(statusType.state || '');
    const completed = Boolean(statusType.completed);
    let status = 'FUT';
    if (completed || state === 'post' || /FINAL|STATUS_FINAL/.test(typeName)) status = 'Final';
    else if (
      state === 'in'
      || /IN_PROGRESS|STATUS_IN_PROGRESS|STATUS_END_PERIOD|HALFTIME|STATUS_HALFTIME/.test(typeName)
    ) status = 'Live';
    const seasonType = Number(event.season?.type || event.seasonType?.type || event.seasonType);
    const mapSide = raw => {
      const team = raw.team || {};
      const short = canonicalNhlAbbrev(team.abbreviation);
      const display = team.displayName || team.name || short;
      const parts = display.split(' ');
      const nick = team.shortDisplayName || team.name || parts[parts.length - 1] || short;
      const place = display.replace(new RegExp(`\\s*${nick}$`), '') || display;
      // Scoreboard uses string scores; team schedule uses { value, displayValue }.
      // Scheduled games often send "0" — keep null so UI shows tip-off time, not 0:0.
      const scoreNum = parseEspnScore(raw.score, { allowZero: status !== 'FUT' });
      return { name: place || display, nick, short, logo: logoFor(short), score: scoreNum };
    };
    let period = '';
    if (status === 'Live') {
      period = statusType.shortDetail || statusType.detail || 'LIVE';
    } else if (status === 'Final') {
      const detail = String(statusType.shortDetail || statusType.altDetail || '');
      if (/SO/i.test(detail)) period = 'SO';
      else if (/OT/i.test(detail)) period = 'OT';
      else period = '';
    }
    return {
      id: event.id,
      gameType: seasonType,
      preseason: seasonType === 1,
      status,
      time: status === 'Final' ? 'Завершён' : status === 'Live' ? 'LIVE' : formatMskTime(event.date),
      period,
      venue: loc(comp.venue?.fullName) || loc(comp.venue?.displayName),
      startTimeUTC: event.date || '',
      away: mapSide(awayRaw),
      home: mapSide(homeRaw),
      espn: true
    };
  }

  async function scoreNhl(dateKey) {
    return fetchJson(`${NHL()}/v1/score/${dateKey}`);
  }

  async function scheduleNhl(dateKey) {
    return fetchJson(`${NHL()}/v1/schedule/${dateKey}`);
  }

  async function scoreEspn(dateKey) {
    const compact = dateKey.replace(/-/g, '');
    const data = await fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${compact}`);
    return (data.events || []).map(mapEspnEvent);
  }

  async function fetchGamesEtDate(dateKey) {
    return cached(`games-et:${dateKey}`, async () => {
      try {
        const payload = await scoreNhl(dateKey);
        return { games: extractNhlGames(payload, dateKey), source: 'nhl', error: false };
      } catch (nhlError) {
        try {
          const payload = await scheduleNhl(dateKey);
          return { games: extractNhlGames(payload, dateKey), source: 'nhl', error: false };
        } catch {
          try {
            return { games: await scoreEspn(dateKey), source: 'espn', error: false };
          } catch (espnError) {
            console.warn('[NHL Diggest] schedule fetch failed', nhlError, espnError);
            return { games: null, source: 'mock', error: true };
          }
        }
      }
    });
  }

  function gameBelongsToMskDate(game, dateKey) {
    const iso = game?.startTimeUTC || '';
    if (!iso) return false;
    const tip = new Date(iso);
    if (Number.isNaN(tip.getTime())) return false;
    return mskDateKey(tip) === dateKey;
  }

  async function gamesForDate(dateKey) {
    return cached(`games:${dateKey}`, async () => {
      // NHL/ESPN bucket by North-American game date, but the Mini App day switcher
      // is Europe/Moscow. Overnight ET tip-offs (00:00–06:00 MSK) belong on the
      // next MSK calendar day — fetch adjacent ET dates and filter by MSK start.
      const etDates = [shiftDate(dateKey, -1), dateKey, shiftDate(dateKey, 1)];
      const results = await Promise.all(etDates.map(fetchGamesEtDate));
      const seen = new Set();
      const games = [];
      let source = 'mock';
      let anyOk = false;
      results.forEach(result => {
        if (!result || result.error || !Array.isArray(result.games)) return;
        anyOk = true;
        source = result.source || source;
        result.games.forEach(game => {
          const id = String(game.id ?? '');
          if (!id || seen.has(id)) return;
          if (!gameBelongsToMskDate(game, dateKey)) return;
          seen.add(id);
          games.push(game);
        });
      });
      if (!anyOk) return { games: null, source: 'mock', error: true };
      games.sort((a, b) => String(a.startTimeUTC || '').localeCompare(String(b.startTimeUTC || '')));
      return { games, source, error: false };
    });
  }

  function standingRow(team) {
    const abbrev = loc(team.teamAbbrev).toUpperCase();
    const name = loc(team.teamName) || abbrev;
    const wins = Number(team.wins || 0);
    const losses = Number(team.losses || 0);
    const ot = Number(team.otLosses || 0);
    const points = Number(team.points || 0);
    return { name, abbrev, wins, losses, ot, points, gp: Number(team.gamesPlayed || 0) };
  }

  function groupStandings(rows) {
    const byDivision = new Map();
    const byConference = new Map();
    rows.forEach(row => {
      const div = row.division || 'NHL';
      const conf = row.conference || 'NHL';
      if (!byDivision.has(div)) byDivision.set(div, []);
      if (!byConference.has(conf)) byConference.set(conf, []);
      byDivision.get(div).push(row);
      byConference.get(conf).push(row);
    });
    const sortTeams = list => list.slice().sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
    const division = [...byDivision.entries()].map(([title, teams]) => ({
      title: `${title} Division`,
      code: teams[0]?.conference === 'Eastern' ? 'EAST' : teams[0]?.conference === 'Western' ? 'WEST' : '',
      teams: sortTeams(teams)
    }));
    const order = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
    division.sort((a, b) => order.indexOf(a.title.replace(' Division', '')) - order.indexOf(b.title.replace(' Division', '')));
    const conference = [...byConference.entries()].map(([title, teams]) => ({
      title: `${title} Conference`,
      code: title === 'Eastern' ? 'EAST' : 'WEST',
      teams: sortTeams(teams)
    }));
    conference.sort((a, b) => a.title.localeCompare(b.title));
    const played = rows.reduce((sum, row) => sum + row.gp, 0);
    return { division, conference, played, sourceNote: '' };
  }

  async function standingsNhl(path) {
    const data = await fetchJson(`${NHL()}${path}`);
    const rows = (data.standings || []).map(team => ({
      ...standingRow(team),
      division: team.divisionName || '',
      conference: team.conferenceName || ''
    }));
    return rows;
  }

  async function standingsEspn() {
    const data = await fetchJson(`${ESPN_SITE()}/apis/v2/sports/hockey/nhl/standings?level=3`);
    const rows = [];
    (data.children || []).forEach(conf => {
      const conference = String(conf.name || '').replace(' Conference', '');
      (conf.children || []).forEach(div => {
        const division = String(div.name || '').replace(' Division', '');
        ((div.standings || {}).entries || []).forEach(entry => {
          const stats = Object.fromEntries((entry.stats || []).map(stat => [stat.name, stat.value]));
          const team = entry.team || {};
          const abbrev = canonicalNhlAbbrev(team.abbreviation);
          rows.push({
            name: team.displayName || team.name || abbrev,
            abbrev,
            wins: Number(stats.wins || 0),
            losses: Number(stats.losses || 0),
            ot: Number(stats.otLosses ?? stats.overtimeLosses ?? 0),
            points: Number(stats.points || 0),
            gp: Number(stats.gamesPlayed || 0),
            division,
            conference
          });
        });
      });
    });
    return rows;
  }

  async function loadStandings() {
    return cached('standings', async () => {
      await ensureSeason();
      try {
        const now = await standingsNhl('/v1/standings/now');
        const grouped = groupStandings(now);
        if (grouped.played > 0) {
          grouped.sourceNote = `текущий · ${window.NHL_SEASON_LABEL || seasonLabelShort()}`;
          grouped.source = 'nhl';
          return grouped;
        }
        // Empty /now only during true offseason (before Sep flip). Do not pin a stale end-date.
        const month = new Date().getMonth() + 1;
        if (month >= 7 && month <= 8) {
          try {
            const meta = await fetchJson(`${NHL()}/v1/standings-season`);
            const seasons = meta.seasons || [];
            const prev = seasons.length >= 2 ? seasons[seasons.length - 2] : null;
            const end = prev?.standingsEnd;
            if (end) {
              const rows = await standingsNhl(`/v1/standings/${end}`);
              const prevGrouped = groupStandings(rows);
              prevGrouped.sourceNote = `регулярный ${window.NHL_PREV_SEASON_LABEL || seasonLabelShort(nhlPrevSeasonId())}`;
              prevGrouped.source = 'nhl-prev';
              if (prevGrouped.played > 0) return prevGrouped;
            }
          } catch { /* fall through */ }
        }
        // In-season with 0 GP yet: still return the empty current table.
        grouped.sourceNote = `текущий · ${window.NHL_SEASON_LABEL || seasonLabelShort()}`;
        grouped.source = 'nhl';
        if (grouped.division.length) return grouped;
      } catch (nhlError) {
        try {
          const rows = await standingsEspn();
          const grouped = groupStandings(rows);
          grouped.sourceNote = grouped.played > 0
            ? `ESPN · ${window.NHL_SEASON_LABEL || seasonLabelShort()}`
            : 'ESPN · сезон ещё не начат';
          grouped.source = 'espn';
          if (grouped.division.length) return grouped;
        } catch (espnError) {
          console.warn('[NHL Diggest] standings failed', nhlError, espnError);
        }
      }
      return null;
    });
  }

  function mapLeader(row, value) {
    const name = playerName(row.firstName, row.lastName) || loc(row.name);
    return {
      name,
      nhlId: row.id || row.playerId || null,
      team: loc(row.teamName) || loc(row.teamAbbrev),
      abbrev: canonicalNhlAbbrev(row.teamAbbrev),
      position: row.position || '',
      value,
      headshot: row.headshot || '',
      isRussian: isRussianPlayer(row)
    };
  }

  function formatToi(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value ?? '—');
    if (num > 400) {
      const total = Math.round(num);
      const hours = Math.floor(total / 60);
      const mins = total % 60;
      return `${hours}:${String(mins).padStart(2, '0')}`;
    }
    const mins = Math.floor(num);
    const secs = Math.round((num - mins) * 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function formatGaa(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : String(value ?? '—');
  }

  function formatSv(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value ?? '—');
    return num >= 1 ? num.toFixed(3) : num.toFixed(3).replace(/^0/, '');
  }

  const SKATER_BOARDS = [
    { id: 'points', label: 'Очки', nhl: 'points' },
    { id: 'goals', label: 'Голы', nhl: 'goals' },
    { id: 'assists', label: 'Передачи', nhl: 'assists' },
    { id: 'hits', label: 'Силовые', espnSort: 'defensive.hits:desc', stat: 'hits' },
    { id: 'plusMinus', label: '+/−', nhl: 'plusMinus' },
    { id: 'pim', label: 'Штрафы', nhl: 'penaltyMins' },
    { id: 'blocks', label: 'Блоки', espnSort: 'defensive.blockedShots:desc', stat: 'blockedShots' },
    { id: 'toi', label: 'Время', nhl: 'toi', format: formatToi }
  ];

  const GOALIE_BOARDS = [
    { id: 'gaa', label: 'GAA', nhl: 'goalsAgainstAverage', format: formatGaa },
    { id: 'shutouts', label: 'Сухие', nhl: 'shutouts' },
    { id: 'sv', label: 'SV%', nhl: 'savePctg', format: formatSv },
    { id: 'wins', label: 'Победы', nhl: 'wins' }
  ];

  async function nhlCategory(kind, category) {
    await ensureSeason();
    const gameType = window.NHL_GAME_TYPE_REG || '2';
    const path = kind === 'goalie' ? 'goalie-stats-leaders' : 'skater-stats-leaders';
    const season = nhlSeasonId(); // force current campaign (e.g. 20262027)
    const qs = `categories=${encodeURIComponent(category)}&limit=15`;
    // Prefer explicit seasonId (no 307). /current is backup (redirects to same season).
    let data;
    try {
      data = await fetchJson(`${NHL()}/v1/${path}/${season}/${gameType}?${qs}`);
    } catch {
      data = await fetchJson(`${NHL()}/v1/${path}/current?${qs}`);
    }
    const rows = data[category] || data[Object.keys(data)[0]] || [];
    return rows.slice(0, 15);
  }

  async function espnByAthlete(sort, limit = 15) {
    await ensureSeason();
    const season = espnSeasonYear();
    const url = `${ESPN_WEB()}/apis/common/v3/sports/hockey/nhl/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=${limit}&sort=${encodeURIComponent(sort)}&season=${season}&seasontype=2`;
    const data = await fetchJson(url);
    return data.athletes || [];
  }

  async function coreStat(athleteId, name) {
    await ensureSeason();
    const season = espnSeasonYear();
    const url = `${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/seasons/${season}/types/2/athletes/${athleteId}/statistics/0?lang=en`;
    const data = await fetchJson(url);
    const categories = data?.splits?.categories || [];
    for (const category of categories) {
      for (const stat of category.stats || []) {
        if (stat.name === name) return stat.displayValue ?? stat.value;
      }
    }
    return null;
  }

  async function espnHitsOrBlocks(statName, sort, limit = 12) {
    const athletes = await espnByAthlete(sort, limit);
    const rows = await Promise.all(athletes.map(async entry => {
      const athlete = entry.athlete || {};
      if ((athlete.position || {}).abbreviation === 'G') return null;
      const value = await coreStat(athlete.id, statName);
      const abbrev = canonicalNhlAbbrev(athlete.team?.abbreviation || athlete.teamAbbreviation || '');
      return {
        name: athlete.displayName,
        espnId: athlete.id || null,
        team: athlete.teamShortName || athlete.teamName || abbrev,
        abbrev,
        position: (athlete.position || {}).abbreviation || '',
        value: value ?? '—',
        headshot: athlete.headshot?.href || '',
        isRussian: isRussianPlayer(athlete)
      };
    }));
    return rows.filter(Boolean);
  }

  function skaterFromEspn(entry) {
    const athlete = entry.athlete || {};
    if ((athlete.position || {}).abbreviation === 'G') return null;
    const buckets = Object.fromEntries((entry.categories || []).map(item => [item.name, item]));
    const names = {
      general: ['games', 'plusMinus', 'timeOnIcePerGame', 'shifts', 'production', 'wins', 'losses', 'timeOnIce'],
      offensive: ['goals', 'assists', 'points'],
      penalties: ['penaltyMinutes']
    };
    const pick = (bucket, index) => (buckets[bucket]?.totals || [])[index];
    const abbrev = canonicalNhlAbbrev(athlete.team?.abbreviation || athlete.teamAbbreviation || '');
    return {
      name: athlete.displayName,
      espnId: athlete.id || null,
      team: athlete.teamShortName || athlete.teamName || abbrev,
      abbrev,
      position: (athlete.position || {}).abbreviation || '',
      headshot: athlete.headshot?.href || '',
      debutYear: athlete.debutYear || null,
      goals: pick('offensive', 0),
      assists: pick('offensive', 1),
      points: pick('offensive', 2),
      plusMinus: pick('general', 1),
      toi: pick('general', names.general.indexOf('timeOnIce')),
      pim: pick('penalties', 0),
      isRussian: isRussianPlayer(athlete)
    };
  }

  async function loadBoard(group, boardId) {
    await ensureSeason();
    const key = `board:${nhlSeasonId()}:${espnSeasonYear()}:${group}:${boardId}`;
    return cached(key, async () => {
      if (group === 'goalies') {
        const board = GOALIE_BOARDS.find(item => item.id === boardId) || GOALIE_BOARDS[0];
        try {
          const rows = await nhlCategory('goalie', board.nhl);
          return {
            source: 'nhl',
            note: seasonNoteNhl(),
            players: rows.map(row => ({
              ...mapLeader(row, board.format ? board.format(row.value) : row.value),
              position: 'G'
            }))
          };
        } catch {
          const coreName = { gaa: 'avgGoalsAgainst', shutouts: 'shutouts', sv: 'savePct', wins: 'wins' }[board.id] || 'wins';
          const season = espnSeasonYear();
          const data = await fetchJson(`${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/seasons/${season}/types/2/leaders?limit=12`);
          const category = (data.categories || []).find(item => item.name === coreName);
          const leaders = category?.leaders || [];
          const players = [];
          for (const leader of leaders.slice(0, 12)) {
            const athRef = (leader.athlete?.$ref || '').replace('http://', 'https://');
            const teamRef = (leader.team?.$ref || '').replace('http://', 'https://');
            const [athlete, team] = await Promise.all([
              athRef ? fetchJson(athRef) : Promise.resolve({}),
              teamRef ? fetchJson(teamRef) : Promise.resolve({})
            ]);
            const raw = leader.displayValue ?? leader.value;
            players.push({
              name: athlete.displayName || '—',
              espnId: athlete.id || null,
              team: team.shortDisplayName || team.displayName || team.abbreviation || '',
              abbrev: canonicalNhlAbbrev(team.abbreviation),
              position: 'G',
              value: board.format ? board.format(raw) : raw,
              headshot: athlete.headshot?.href || '',
              isRussian: isRussianPlayer(athlete)
            });
          }
          return { source: 'espn', note: seasonNoteEspn(), players };
        }
      }

      const board = SKATER_BOARDS.find(item => item.id === boardId) || SKATER_BOARDS[0];
      if (board.espnSort) {
        try {
          const players = await espnHitsOrBlocks(board.stat, board.espnSort, 12);
          if (players.length) return { source: 'espn', note: seasonNoteEspn(), players };
        } catch (error) {
          console.warn('[NHL Diggest] espn stat board failed', error);
        }
      }
      try {
        if (!board.nhl) throw new Error('no nhl category');
        const rows = await nhlCategory('skater', board.nhl);
        return {
          source: 'nhl',
          note: seasonNoteNhl(),
          players: rows.map(row => ({
            ...mapLeader(row, board.format ? board.format(row.value) : row.value)
          }))
        };
      } catch (nhlError) {
        const sortMap = {
          points: 'offensive.points:desc',
          goals: 'offensive.goals:desc',
          assists: 'offensive.assists:desc',
          plusMinus: 'general.plusMinus:desc',
          pim: 'penalties.penaltyMinutes:desc',
          toi: 'general.timeOnIce:desc'
        };
        const sort = sortMap[board.id];
        if (!sort) throw nhlError;
        const athletes = await espnByAthlete(sort, board.id === 'toi' ? 30 : 15);
        const players = athletes.map(skaterFromEspn).filter(Boolean).slice(0, 15).map(player => ({
          ...player,
          value: board.id === 'toi' ? player.toi : player[board.id === 'pim' ? 'pim' : board.id]
        }));
        return { source: 'espn', note: seasonNoteEspn(), players };
      }
    });
  }

  async function loadRookies(boardId) {
    await ensureSeason();
    return cached(`rookies:${nhlSeasonId()}:${espnSeasonYear()}:${boardId}`, async () => {
      const sortMap = {
        points: 'offensive.points:desc',
        goals: 'offensive.goals:desc',
        assists: 'offensive.assists:desc',
        plusMinus: 'general.plusMinus:desc',
        pim: 'penalties.penaltyMinutes:desc',
        hits: 'defensive.hits:desc',
        blocks: 'defensive.blockedShots:desc',
        toi: 'general.timeOnIcePerGame:desc'
      };
      const athletes = await espnByAthlete(sortMap[boardId] || sortMap.points, 80);
      const debutFloor = Number(window.NHL_SEASON_START_YEAR || nhlSeasonId().slice(0, 4)) || 2026;
      const rookies = athletes.filter(entry => {
        const athlete = entry.athlete || {};
        if ((athlete.position || {}).abbreviation === 'G') return false;
        const debut = Number(athlete.debutYear);
        if (debut && debut >= debutFloor) return true;
        // ESPN omits debutYear for several recent first-years; age <= 21 is a conservative proxy.
        return !debut && Number(athlete.age) > 0 && Number(athlete.age) <= 21;
      });
      const needsCore = boardId === 'hits' || boardId === 'blocks';
      const needsScoring = boardId === 'points' || boardId === 'goals' || boardId === 'assists';
      const players = [];
      for (const entry of rookies) {
        const mapped = skaterFromEspn(entry);
        if (!mapped) continue;

        // Do not show scoreless rookies on offensive boards. ESPN can expose
        // points and G/A inconsistently, so accept either production signal.
        const goals = Number(mapped.goals) || 0;
        const assists = Number(mapped.assists) || 0;
        const points = Number(mapped.points) || 0;
        if (needsScoring && (boardId === 'points' ? points <= 0 && goals + assists <= 0 : goals + assists <= 0)) {
          continue;
        }

        if (needsCore) {
          mapped.value = await coreStat(entry.athlete.id, boardId === 'hits' ? 'hits' : 'blockedShots');
        } else if (boardId === 'toi') {
          mapped.value = mapped.toi;
        } else if (boardId === 'pim') {
          mapped.value = mapped.pim;
        } else {
          mapped.value = mapped[boardId];
        }
        players.push(mapped);
        if (players.length === 12) break;
      }
      return { source: 'espn', note: `новички · ${seasonNoteEspn()}`, players };
    });
  }

  function rosterIndexFromPayload(payload, source) {
    const rows = source === 'nhl'
      ? [
          ...(payload?.forwards || []),
          ...(payload?.defensemen || []),
          ...(payload?.goalies || [])
        ]
      : (payload?.athletes || []).flatMap(group => Array.isArray(group?.items)
        ? group.items
        : (group?.id != null ? [group] : []));
    const index = new Map();
    rows.forEach(row => {
      const id = row?.id;
      if (id != null && id !== '') index.set(String(id), row);
    });
    return index;
  }

  function mergePlayerIdentity(player, rosterIndex) {
    if (!player || !rosterIndex) return player || {};
    const id = player.playerId ?? player.id ?? player.committedByPlayer?.playerId ?? player.committedByPlayer?.id;
    const profile = id == null ? null : rosterIndex.get(String(id));
    if (!profile) return player;
    // Boxscore payloads carry stats and initials; roster payloads carry birthCountry.
    // Preserve the game row while filling identity fields from the matching player id.
    const merged = { ...profile, ...player };
    ['birthCountry', 'birthPlace', 'birthCity', 'firstName', 'lastName', 'displayName', 'fullName'].forEach(key => {
      if (merged[key] == null || merged[key] === '') merged[key] = profile[key];
    });
    return merged;
  }

  async function gameRosterIndex(game, source) {
    const abbrevs = [...new Set([game?.away?.short, game?.home?.short].map(value => String(value || '').toUpperCase()).filter(Boolean))];
    const payloads = await Promise.all(abbrevs.map(async abbrev => {
      const path = source === 'nhl'
        ? `${NHL()}/v1/roster/${abbrev}/current`
        : `${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/teams/${espnTeamSlug(abbrev)}/roster`;
      try { return await fetchJson(path); } catch { return null; }
    }));
    const index = new Map();
    payloads.forEach(payload => rosterIndexFromPayload(payload, source).forEach((row, id) => index.set(id, row)));
    return index;
  }

  async function gameDetail(game) {
    const key = `detail:${game.id}`;
    return cached(key, async () => {
      // Prefer VPS cache for finished (or unknown-status deep-link) games.
      if (gameLooksFinished(game) || !game.status) {
        const cachedPayload = await fetchCacheGamePayload(game.id);
        const fromCache = detailFromCachePayload(cachedPayload);
        if (fromCache) return fromCache;
      }
      if (!game.espn) {
        try {
          const [landing, box, rosterIndex] = await Promise.all([
            fetchJson(`${NHL()}/v1/gamecenter/${game.id}/landing`),
            fetchJson(`${NHL()}/v1/gamecenter/${game.id}/boxscore`),
            gameRosterIndex(game, 'nhl')
          ]);
          const detail = { source: 'nhl', ...normalizeNhlDetail(landing, box, game, rosterIndex) };
          detail.recap = extractNhlGameRecap(game, landing);
          if (!detail.recap?.embed) {
            const espnRecap = await findEspnRecapForGame(game);
            if (espnRecap) detail.recap = espnRecap;
          }
          return detail;
        } catch (error) {
          console.warn('[NHL Diggest] NHL game detail failed', error);
        }
      }
      try {
        const [summary, rosterIndex] = await Promise.all([
          fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/summary?event=${game.id}`),
          gameRosterIndex(game, 'espn')
        ]);
        const detail = { source: 'espn', ...normalizeEspnDetail(summary, game, rosterIndex) };
        detail.recap = extractEspnGameRecap(summary.videos || []) || extractNhlGameRecap(game);
        return detail;
      } catch (error) {
        console.warn('[NHL Diggest] ESPN game detail failed', error);
        return null;
      }
    });
  }


  function humanizeInfraction(value) {
    const text = loc(value);
    if (!text) return '';
    if (/^[A-Z][A-Za-z/ -]*$/.test(text) && !/[_-]/.test(text)) return text;
    return text
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function nhlCommittedPlayerName(pen) {
    if (pen?.firstName || pen?.lastName) return playerName(pen.firstName, pen.lastName);
    const committed = pen?.committedByPlayer;
    if (committed == null) return '';
    if (typeof committed === 'string' || typeof committed === 'number') return String(committed);
    if (committed.firstName || committed.lastName) return playerName(committed.firstName, committed.lastName);
    return loc(committed.name) || loc(committed);
  }

  function nhlGoalHighlight(goal) {
    const share = loc(goal?.highlightClipSharingUrl) || loc(goal?.highlightClipSharingUrlFr);
    if (share) return { url: share, embed: false, source: 'nhl' };
    const clipId = goal?.highlightClip || goal?.discreteClip;
    if (clipId) return { url: `https://www.nhl.com/video/c-${clipId}`, embed: false, source: 'nhl' };
    return null;
  }

  function isEspnPenaltyPlay(play) {
    const type = play?.type || {};
    if (type.penaltyMinutes != null && type.penaltyMinutes !== '') return true;
    if (type.penaltyType) return true;
    const typeText = String(type.text || type.abbreviation || '');
    if (/penalt/i.test(typeText)) return true;
    if (/\bpenalty\b/i.test(play?.text || '')) return true;
    return false;
  }

  function espnVideoHref(video) {
    const links = video?.links || {};
    const source = links.source || {};
    const pick = item => {
      if (!item) return '';
      if (typeof item === 'string' && /^https?:/i.test(item)) return item;
      if (typeof item === 'object' && item.href && /^https?:/i.test(item.href)) return item.href;
      return '';
    };
    for (const key of ['HD', 'href', 'full', 'mezzanine', 'flash']) {
      const href = pick(source[key]);
      if (href && /\.mp4(\?|$)/i.test(href)) return href;
    }
    for (const key of ['HD', 'href', 'full', 'mezzanine', 'flash']) {
      const href = pick(source[key]);
      if (href) return href;
    }
    return pick(links.web) || pick(links.mobile) || '';
  }

  function attachEspnHighlights(scoring, videos) {
    const pool = (videos || [])
      .map(video => {
        const href = espnVideoHref(video);
        if (!href) return null;
        const headline = String(video.headline || video.description || '');
        if (/game highlights/i.test(headline)) return null;
        return {
          headline,
          nameKey: normalizedName(headline),
          url: href,
          embed: /\.mp4(\?|$)/i.test(href),
          source: 'espn'
        };
      })
      .filter(Boolean);
    scoring.forEach(goal => {
      if (goal.highlight) return;
      const scorerKey = normalizedName(goal.scorer);
      if (!scorerKey) return;
      const parts = scorerKey.split(' ').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      const idx = pool.findIndex(item => {
        if (item.nameKey.includes(scorerKey)) return true;
        if (last.length > 2 && item.nameKey.includes(last) && parts.every(part => part.length < 3 || item.nameKey.includes(part))) {
          return true;
        }
        return last.length > 3 && item.nameKey.includes(last);
      });
      if (idx < 0) return;
      const [match] = pool.splice(idx, 1);
      goal.highlight = { url: match.url, embed: match.embed, source: match.source };
    });
  }

  function formatFoPct(value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) {
      const raw = String(value).trim();
      if (!raw) return '';
      return /%$/.test(raw) ? raw : `${raw}%`;
    }
    // NHL faceoffWinningPctg is 0–1; ESPN faceoffPercent is usually 0–100.
    const pct = n >= 0 && n <= 1 ? n * 100 : n;
    const rounded = Math.round(pct * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded}%`;
  }

  function mapNhlSkaterRow(player, teamShort, rosterIndex) {
    const name = loc(player.name);
    const goals = Number(player.goals || 0);
    const assists = Number(player.assists || 0);
    return {
      team: teamShort,
      number: player.sweaterNumber != null ? String(player.sweaterNumber) : '',
      name,
      nhlId: player.playerId || null,
      isRussian: isRussianPlayer({ ...mergePlayerIdentity(player, rosterIndex), name }),
      position: player.position || '',
      goals,
      assists,
      points: player.points != null ? Number(player.points) : goals + assists,
      plusMinus: player.plusMinus ?? '',
      sog: player.sog ?? '',
      pim: player.pim ?? '',
      hits: player.hits ?? '',
      blocks: player.blockedShots ?? '',
      faceoffPct: formatFoPct(player.faceoffWinningPctg),
      toi: player.toi || ''
    };
  }

  function mapNhlGoalieRow(goalie, teamShort, rosterIndex) {
    const name = loc(goalie.name);
    const saves = goalie.saves;
    const shotsAgainst = goalie.shotsAgainst;
    return {
      team: teamShort,
      number: goalie.sweaterNumber != null ? String(goalie.sweaterNumber) : '',
      name,
      nhlId: goalie.playerId || null,
      isRussian: isRussianPlayer({ ...mergePlayerIdentity(goalie, rosterIndex), name }),
      saves: goalie.saveShotsAgainst
        || (saves != null && shotsAgainst != null ? `${saves}/${shotsAgainst}` : (saves ?? '—')),
      shotsAgainst: shotsAgainst ?? '',
      goalsAgainst: goalie.goalsAgainst ?? '',
      sv: goalie.savePctg != null ? formatSv(goalie.savePctg) : '',
      decision: goalie.decision || '',
      toi: goalie.toi || ''
    };
  }

  function normalizeNhlDetail(landing, box, game, rosterIndex) {
    const summary = landing.summary || {};
    const scoring = [];
    (summary.scoring || []).forEach(period => {
      const desc = period.periodDescriptor || {};
      const label = desc.periodType === 'OT' ? 'OT' : desc.periodType === 'SO' ? 'SO' : `${desc.number || ''}`.trim();
      (period.goals || []).forEach(goal => {
        const scorer = playerName(goal.firstName, goal.lastName);
        const scorerIdentity = mergePlayerIdentity({ ...goal, name: scorer }, rosterIndex);
        const entry = {
          period: careerPeriodLabel(label || desc.number || '—'),
          time: goal.timeInPeriod || '',
          team: loc(goal.teamAbbrev).toUpperCase(),
          scorer,
          scorerShort: loc(goal.name) || scorer,
          scorerId: goal.playerId || goal.nhlPlayerId || null,
          scorerRussian: isRussianPlayer(scorerIdentity),
          headshot: goal.headshot || '',
          awayScore: goal.awayScore != null ? Number(goal.awayScore) : null,
          homeScore: goal.homeScore != null ? Number(goal.homeScore) : null,
          goalsToDate: goal.goalsToDate != null ? Number(goal.goalsToDate) : null,
          assists: (goal.assists || []).map(assist => {
            const name = playerName(assist.firstName, assist.lastName);
            return {
              name,
              shortName: loc(assist.name) || name,
              nhlId: assist.playerId || null,
              isRussian: isRussianPlayer(mergePlayerIdentity({ ...assist, name }, rosterIndex))
            };
          }).filter(assist => assist.name),
          strength: goal.strength || ''
        };
        const highlight = nhlGoalHighlight(goal);
        if (highlight) entry.highlight = highlight;
        scoring.push(entry);
      });
    });
    const penalties = [];
    (summary.penalties || []).forEach(period => {
      const desc = period.periodDescriptor || {};
      const label = desc.periodType === 'OT' ? 'OT' : desc.periodType === 'SO' ? 'SO' : `${desc.number || ''}`;
      (period.penalties || []).forEach(pen => {
        const who = nhlCommittedPlayerName(pen);
        const playerIdentity = mergePlayerIdentity({ ...pen, name: who }, rosterIndex);
        penalties.push({
          period: careerPeriodLabel(label || desc.number || '—'),
          time: pen.timeInPeriod || '',
          team: loc(pen.teamAbbrev || pen.committedByTeam).toUpperCase(),
          player: who,
          playerRussian: isRussianPlayer(playerIdentity),
          minutes: pen.duration || pen.penaltyMinutes || '',
          infraction: humanizeInfraction(pen.descKey) || humanizeInfraction(pen.type) || ''
        });
      });
    });
    const pbg = box.playerByGameStats || {};
    const boxscore = {};
    const goalies = [];
    const skaters = [];
    ['away', 'home'].forEach(side => {
      const keyName = `${side}Team`;
      const team = game[side];
      const sideStats = pbg[keyName] || {};
      const teamBox = box[keyName] || {};
      const players = [...(sideStats.forwards || []), ...(sideStats.defense || [])];
      const shots = teamBox.sog != null
        ? Number(teamBox.sog)
        : players.reduce((sum, player) => sum + Number(player.sog || 0), 0);
      const hits = players.reduce((sum, player) => sum + Number(player.hits || 0), 0);
      boxscore[team.short] = { shots, hits, faceoff: '—', powerPlay: '—' };
      players.forEach(player => {
        skaters.push(mapNhlSkaterRow(player, team.short, rosterIndex));
      });
      (sideStats.goalies || []).forEach(goalie => {
        goalies.push(mapNhlGoalieRow(goalie, team.short, rosterIndex));
      });
    });
    const threeStars = mapNhlThreeStars(summary.threeStars || [], skaters, goalies, scoring, rosterIndex);
    return {
      venue: loc(landing.venue) || game.venue || '',
      attendance: '',
      scoring,
      penalties,
      boxscore,
      goalies,
      skaters,
      threeStars
    };
  }

  function normalizeEspnDetail(summary, game, rosterIndex) {
    const plays = summary.plays || [];
    const scoring = plays.filter(play => play.scoringPlay).map(play => {
      const participants = play.participants || [];
      const scorer = participants.find(item => item.type === 'scorer') || participants[0];
      const assists = participants.filter(item => item.type === 'assister' || item.type === 'assist').map(item => ({
        name: item.athlete?.displayName || '',
        shortName: item.athlete?.shortName || item.athlete?.displayName || '',
        espnId: item.athlete?.id || null,
        isRussian: isRussianPlayer(mergePlayerIdentity(item.athlete || {}, rosterIndex))
      })).filter(item => item.name);
      const text = play.text || '';
      const teamId = String(play.team?.id || '');
      const ath = scorer?.athlete || {};
      return {
        period: careerPeriodLabel(play.period?.displayValue || play.period?.number || ''),
        time: play.clock?.displayValue || '',
        team: teamId,
        scorer: ath.displayName || ath.fullName || text.split(' Goal')[0] || text,
        scorerShort: ath.shortName || ath.displayName || '',
        scorerId: ath.id || null,
        scorerEspn: true,
        scorerRussian: isRussianPlayer(mergePlayerIdentity(ath, rosterIndex)),
        headshot: ath.headshot?.href || '',
        awayScore: play.awayScore != null ? Number(play.awayScore) : null,
        homeScore: play.homeScore != null ? Number(play.homeScore) : null,
        goalsToDate: scorer?.ytdGoals != null ? Number(scorer.ytdGoals) : null,
        assists,
        strength: /power play|power-play|\bpp\b/i.test(text)
          ? 'pp'
          : (/short/i.test(text) || /short/i.test(String(play.strength?.text || play.strength || ''))) ? 'sh' : ''
      };
    });
    const box = summary.boxscore || {};
    const boxscore = {};
    (box.teams || []).forEach(teamBlock => {
      const short = canonicalNhlAbbrev(teamBlock.team?.abbreviation);
      const stats = Object.fromEntries((teamBlock.statistics || []).map(stat => [stat.name, stat.displayValue]));
      const pp = stats.powerPlayGoals != null && stats.powerPlayOpportunities != null
        ? `${stats.powerPlayGoals}/${stats.powerPlayOpportunities}`
        : '—';
      boxscore[short] = {
        shots: stats.shotsTotal ?? '—',
        hits: stats.hits ?? '—',
        faceoff: stats.faceoffPercent != null ? `${stats.faceoffPercent}%` : (stats.faceoffsWon ?? '—'),
        powerPlay: pp
      };
    });
    const teamIdToAbbrev = {};
    (box.players || []).forEach(block => {
      teamIdToAbbrev[String(block.team?.id)] = canonicalNhlAbbrev(block.team?.abbreviation);
    });
    scoring.forEach(goal => {
      if (teamIdToAbbrev[goal.team]) goal.team = teamIdToAbbrev[goal.team];
    });
    const skaters = [];
    const goalies = [];
    (box.players || []).forEach(block => {
      const short = canonicalNhlAbbrev(block.team?.abbreviation);
      (block.statistics || []).forEach(group => {
        const keys = group.keys || group.names || [];
        const index = name => keys.indexOf(name);
        const groupName = String(group.name || '');
        if (groupName === 'goalies' || /goalie/i.test(groupName)) {
          (group.athletes || []).forEach(entry => {
            const athlete = entry.athlete || {};
            const stats = entry.stats || [];
            const saves = stats[index('saves')];
            const shotsAgainst = stats[index('shotsAgainst')];
            goalies.push({
              team: short,
              number: athlete.jersey != null ? String(athlete.jersey) : '',
              name: athlete.displayName || '',
              espnId: athlete.id || null,
              isRussian: isRussianPlayer(mergePlayerIdentity(athlete, rosterIndex)),
              saves: saves != null && shotsAgainst != null
                ? `${saves}/${shotsAgainst}`
                : (saves || '—'),
              shotsAgainst: shotsAgainst ?? '',
              goalsAgainst: stats[index('goalsAgainst')] ?? '',
              sv: stats[index('savePct')] || '',
              decision: '',
              toi: stats[index('timeOnIce')] || ''
            });
          });
          return;
        }
        if (!/^(forwards|defenses|defense|skaters)$/i.test(groupName)) return;
        (group.athletes || []).forEach(entry => {
          const athlete = entry.athlete || {};
          const stats = entry.stats || [];
          const goals = Number(stats[index('goals')] || 0);
          const assists = Number(stats[index('assists')] || 0);
          const sog = index('shotsTotal') >= 0 ? stats[index('shotsTotal')] : (stats[index('shots')] ?? '');
          skaters.push({
            team: short,
            number: athlete.jersey != null ? String(athlete.jersey) : '',
            name: athlete.displayName || '',
            espnId: athlete.id || null,
            isRussian: isRussianPlayer(mergePlayerIdentity(athlete, rosterIndex)),
            position: athlete.position?.abbreviation || athlete.position || '',
            goals,
            assists,
            points: goals + assists,
            plusMinus: index('plusMinus') >= 0 ? stats[index('plusMinus')] : '',
            sog,
            pim: index('penaltyMinutes') >= 0 ? stats[index('penaltyMinutes')] : '',
            hits: index('hits') >= 0 ? stats[index('hits')] : '',
            blocks: index('blockedShots') >= 0 ? stats[index('blockedShots')] : '',
            faceoffPct: formatFoPct(index('faceoffPercent') >= 0 ? stats[index('faceoffPercent')] : ''),
            toi: stats[index('timeOnIce')] || ''
          });
        });
      });
    });
    const penalties = [];
    plays.forEach(play => {
      if (!isEspnPenaltyPlay(play)) return;
      const type = play.type || {};
      const typeText = String(type.text || type.abbreviation || '');
      const athlete = (play.participants || [])[0]?.athlete || {};
      penalties.push({
        period: careerPeriodLabel(play.period?.displayValue || play.period?.number || ''),
        time: play.clock?.displayValue || '',
        team: teamIdToAbbrev[String(play.team?.id)] || '',
        player: athlete.displayName || '',
        playerRussian: isRussianPlayer(mergePlayerIdentity(athlete, rosterIndex)),
        minutes: type.penaltyMinutes || '',
        infraction: humanizeInfraction(typeText) || humanizeInfraction(type.penaltyType) || ''
      });
    });
    try {
      attachEspnHighlights(scoring, summary.videos || []);
    } catch (error) {
      console.warn('[NHL Diggest] ESPN highlight attach failed', error);
    }
    const threeStars = mapEspnThreeStars(summary, skaters, goalies, game, rosterIndex, teamIdToAbbrev, scoring);
    return {
      venue: summary.gameInfo?.venue?.fullName || game.venue || '',
      attendance: summary.gameInfo?.attendance ? String(summary.gameInfo.attendance) : '',
      scoring,
      penalties,
      boxscore,
      goalies,
      skaters,
      threeStars
    };
  }


  // All-time / career leaders (ESPN core leaders; CORS *).
  // Available categories: G, A, PTS, PIM, W, SO, GP.
  // GAA / SV% are derived from career stats of top win leaders (min GP).
  const CAREER_SKATER_BOARDS = [
    { id: 'points', label: 'Очки', abbr: 'PTS' },
    { id: 'goals', label: 'Голы', abbr: 'G' },
    { id: 'assists', label: 'Передачи', abbr: 'A' },
    { id: 'pim', label: 'Штрафы', abbr: 'PIM' }
  ];

  const CAREER_GOALIE_BOARDS = [
    { id: 'wins', label: 'Победы', abbr: 'W' },
    { id: 'shutouts', label: 'Сухие', abbr: 'SO' },
    { id: 'gaa', label: 'GAA', derived: 'avgGoalsAgainst', format: formatGaa, asc: true },
    { id: 'sv', label: 'SV%', derived: 'savePct', format: formatSv, asc: false }
  ];

  function findPlayerInPool(pool, { nhlId, espnId, name, team }) {
    const idNhl = nhlId != null && nhlId !== '' ? String(nhlId) : '';
    const idEspn = espnId != null && espnId !== '' ? String(espnId) : '';
    const nameKey = normalizedName(name);
    return (pool || []).find(row => {
      if (idNhl && String(row.nhlId || '') === idNhl) return true;
      if (idEspn && String(row.espnId || '') === idEspn) return true;
      if (nameKey && normalizedName(row.name) === nameKey && (!team || row.team === team)) return true;
      return false;
    }) || null;
  }

  function findSkaterStats(skaters, goalies, ids) {
    return findPlayerInPool(skaters, ids) || findPlayerInPool(goalies, ids);
  }

  function findGoalieRow(goalies, ids) {
    return findPlayerInPool(goalies, ids);
  }

  function isGoaliePosition(pos) {
    const p = String(pos || '').trim().toUpperCase();
    return p === 'G' || p === 'GOALIE' || p === 'GK';
  }

  function countScoringGoals(scoring, { nhlId, espnId, name }) {
    const idNhl = nhlId != null && nhlId !== '' ? String(nhlId) : '';
    const idEspn = espnId != null && espnId !== '' ? String(espnId) : '';
    const nameKey = normalizedName(name);
    let count = 0;
    (scoring || []).forEach(goal => {
      const sid = goal.scorerId != null && goal.scorerId !== '' ? String(goal.scorerId) : '';
      if (idNhl && sid === idNhl) {
        count += 1;
        return;
      }
      if (idEspn && sid === idEspn) {
        count += 1;
        return;
      }
      if (!nameKey) return;
      const names = [goal.scorer, goal.scorerShort].filter(Boolean);
      if (names.some(n => normalizedName(n) === nameKey)) count += 1;
    });
    return count;
  }

  function attachGoalieStarFields(base, goalieRow, scoring, ids, starGoals) {
    const fromScoring = countScoringGoals(scoring, ids);
    const declared = starGoals != null && starGoals !== '' ? Number(starGoals) : null;
    const goals = Math.max(Number.isFinite(declared) ? declared : 0, fromScoring);
    return {
      ...base,
      isGoalie: true,
      saves: goalieRow?.saves != null && goalieRow.saves !== '' ? goalieRow.saves : '—',
      goalsAgainst: goalieRow?.goalsAgainst != null && goalieRow.goalsAgainst !== ''
        ? goalieRow.goalsAgainst
        : '—',
      sv: goalieRow?.sv || '',
      toi: goalieRow?.toi || '—',
      decision: goalieRow?.decision || '',
      goals,
      assists: 0,
      pim: 0,
      plusMinus: '—'
    };
  }

  function mapNhlThreeStars(rawStars, skaters, goalies, scoring, rosterIndex) {
    const nameById = new Map();
    (scoring || []).forEach(goal => {
      if (goal.scorerId != null && goal.scorer) nameById.set(String(goal.scorerId), goal.scorer);
    });
    return (rawStars || []).map(star => {
      const nhlId = star.playerId || star.nhlPlayerId || null;
      const team = loc(star.teamAbbrev).toUpperCase();
      const shortName = loc(star.name);
      const identity = mergePlayerIdentity({ ...star, playerId: nhlId, name: shortName }, rosterIndex);
      const fullName = playerName(identity.firstName, identity.lastName)
        || (nhlId != null ? nameById.get(String(nhlId)) : '')
        || shortName;
      const displayName = fullName || shortName || '—';
      const ids = { nhlId, name: fullName || shortName, team };
      const goalieRow = findGoalieRow(goalies, ids);
      const position = star.position || identity.position || identity.positionCode || '';
      const isGoalie = !!goalieRow || isGoaliePosition(position);
      const base = {
        star: Number(star.star) || 0,
        name: displayName,
        team,
        nhlId,
        espnId: null,
        headshot: star.headshot || '',
        isRussian: isRussianPlayer({ ...identity, name: fullName || shortName, nhlId, playerId: nhlId })
      };
      if (isGoalie) {
        return attachGoalieStarFields(base, goalieRow, scoring, ids, star.goals);
      }
      const stats = findSkaterStats(skaters, goalies, ids);
      return {
        ...base,
        isGoalie: false,
        goals: star.goals != null ? Number(star.goals) : (stats?.goals ?? 0),
        assists: star.assists != null ? Number(star.assists) : (stats?.assists ?? 0),
        pim: stats?.pim != null && stats.pim !== '' ? Number(stats.pim) : 0,
        plusMinus: stats?.plusMinus != null && stats.plusMinus !== '' ? stats.plusMinus : '—',
        toi: stats?.toi || '—'
      };
    }).filter(row => row.star > 0 && row.name && row.name !== '—')
      .sort((a, b) => a.star - b.star);
  }

  function mapEspnThreeStars(summary, skaters, goalies, game, rosterIndex, teamIdToAbbrev = {}, scoring = []) {
    const featured = summary?.header?.competitions?.[0]?.status?.featuredAthletes || [];
    const rankOf = { firstStar: 1, secondStar: 2, thirdStar: 3 };
    const idToAbbrev = { ...teamIdToAbbrev };
    (summary?.header?.competitions?.[0]?.competitors || []).forEach(comp => {
      const id = String(comp.team?.id || comp.id || '');
      const abbr = canonicalNhlAbbrev(comp.team?.abbreviation);
      if (id && abbr) idToAbbrev[id] = abbr;
    });
    ['away', 'home'].forEach(side => {
      const team = game?.[side];
      if (team?.espnId && team?.short) idToAbbrev[String(team.espnId)] = String(team.short).toUpperCase();
    });
    return featured.map(item => {
      const rank = rankOf[item.name];
      if (!rank) return null;
      const ath = item.athlete || {};
      const teamBlock = item.team || {};
      const team = canonicalNhlAbbrev(teamBlock.abbreviation || idToAbbrev[String(teamBlock.id || '')] || '');
      const name = ath.fullName || ath.displayName || ath.shortName || '';
      const espnId = ath.id || item.playerId || null;
      const identity = mergePlayerIdentity(ath, rosterIndex);
      const ids = { espnId, name, team };
      const goalieRow = findGoalieRow(goalies, ids);
      const position = ath.position?.abbreviation || ath.position?.name || ath.position || identity.position || '';
      const isGoalie = !!goalieRow || isGoaliePosition(position);
      const base = {
        star: rank,
        name,
        team,
        nhlId: null,
        espnId,
        headshot: ath.headshot?.href || '',
        isRussian: isRussianPlayer({ ...identity, name, espnId })
      };
      if (isGoalie) {
        return attachGoalieStarFields(base, goalieRow, scoring, ids, null);
      }
      const stats = findSkaterStats(skaters, goalies, ids);
      return {
        ...base,
        isGoalie: false,
        goals: stats?.goals ?? 0,
        assists: stats?.assists ?? 0,
        pim: stats?.pim != null && stats.pim !== '' ? Number(stats.pim) : 0,
        plusMinus: stats?.plusMinus != null && stats.plusMinus !== '' ? stats.plusMinus : '—',
        toi: stats?.toi || '—'
      };
    }).filter(Boolean).sort((a, b) => a.star - b.star);
  }

  function periodHeadingLabel(raw) {
    const key = careerPeriodLabel(raw);
    if (key === 'OT') return 'Овертайм';
    if (key === 'SO') return 'Буллиты';
    const n = Number((String(key).match(/(\d+)/) || [])[1]);
    if (n === 1) return '1-й период';
    if (n === 2) return '2-й период';
    if (n === 3) return '3-й период';
    if (Number.isFinite(n) && n > 0) return `${n}-й период`;
    return key;
  }

    function careerPeriodLabel(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '—';
    const upper = text.toUpperCase();
    if (/\bOT\b|OVERTIME/.test(upper)) return 'OT';
    if (/\bSO\b|SHOOTOUT/.test(upper)) return 'SO';
    const num = Number((text.match(/(\d+)/) || [])[1]);
    if (Number.isFinite(num) && num > 0) return `P${num}`;
    return text;
  }

  function groupByPeriod(events) {
    const order = [];
    const buckets = new Map();
    (events || []).forEach(event => {
      const key = careerPeriodLabel(event.period);
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key).push({ ...event, period: key });
    });
    const rank = key => {
      if (key === 'OT') return 50;
      if (key === 'SO') return 60;
      const n = Number((String(key).match(/(\d+)/) || [])[1]);
      return Number.isFinite(n) ? n : 40;
    };
    order.sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
    return order.map(period => ({ period, events: buckets.get(period) }));
  }

  async function resolveAthleteLeader(leader) {
    const athRef = (leader.athlete?.$ref || '').replace('http://', 'https://');
    const athlete = athRef ? await fetchJson(athRef) : {};
    let teamAbbr = '';
    let teamName = '';
    const teamRef = (athlete.team?.$ref || leader.team?.$ref || '').replace('http://', 'https://');
    if (teamRef) {
      try {
        const team = await fetchJson(teamRef);
        teamAbbr = canonicalNhlAbbrev(team.abbreviation);
        teamName = team.shortDisplayName || team.displayName || teamAbbr;
      } catch { /* team optional for retired players */ }
    }
    return {
      name: athlete.displayName || athlete.fullName || '—',
      team: teamName || teamAbbr,
      abbrev: teamAbbr,
      position: (athlete.position || {}).abbreviation || '',
      headshot: athlete.headshot?.href || '',
      athleteId: athlete.id || '',
      espnId: athlete.id || null,
      isRussian: isRussianPlayer(athlete),
      raw: leader.displayValue ?? leader.value
    };
  }

  async function espnCareerLeaders(limit = 15) {
    return cached('espn:career-leaders', async () => {
      const data = await fetchJson(`${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/leaders?limit=${limit}`);
      return data.categories || [];
    });
  }

  function findCareerCategory(categories, abbr) {
    const target = String(abbr || '').toUpperCase();
    return (categories || []).find(item => String(item.abbreviation || '').toUpperCase() === target)
      || (categories || []).find(item => String(item.displayName || '').toUpperCase() === target);
  }

  async function loadCareerBoard(group, boardId) {
    const key = `career:${group}:${boardId}`;
    return cached(key, async () => {
      const categories = await espnCareerLeaders(15);
      if (group === 'goalies') {
        const board = CAREER_GOALIE_BOARDS.find(item => item.id === boardId) || CAREER_GOALIE_BOARDS[0];
        if (board.derived) {
          const winsCat = findCareerCategory(categories, 'W');
          const seeds = (winsCat?.leaders || []).slice(0, 20);
          const rows = [];
          for (const leader of seeds) {
            const base = await resolveAthleteLeader(leader);
            if (!base.athleteId) continue;
            try {
              const stats = await fetchJson(
                `${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/athletes/${base.athleteId}/statistics/0?lang=en`
              );
              const cats = stats?.splits?.categories || [];
              let value = null;
              let games = null;
              for (const cat of cats) {
                for (const stat of cat.stats || []) {
                  if (stat.name === board.derived) value = stat.displayValue ?? stat.value;
                  if (stat.name === 'games') games = Number(stat.value);
                }
              }
              if (value == null) continue;
              if (Number.isFinite(games) && games < 200) continue;
              rows.push({
                ...base,
                position: 'G',
                value: board.format ? board.format(value) : value,
                sortValue: Number(String(value).replace(/^0/, '') || value)
              });
            } catch { /* skip athlete */ }
          }
          rows.sort((a, b) => board.asc
            ? (a.sortValue - b.sortValue)
            : (b.sortValue - a.sortValue));
          return {
            source: 'espn',
            note: 'карьера · ESPN (мин. 200 игр)',
            players: rows.slice(0, 15).map(({ sortValue, ...player }) => player)
          };
        }
        const category = findCareerCategory(categories, board.abbr);
        const leaders = (category?.leaders || []).slice(0, 15);
        const players = [];
        for (const leader of leaders) {
          const base = await resolveAthleteLeader(leader);
          players.push({
            ...base,
            position: 'G',
            value: board.format ? board.format(base.raw) : base.raw
          });
        }
        return { source: 'espn', note: 'карьера · ESPN all-time', players };
      }

      const board = CAREER_SKATER_BOARDS.find(item => item.id === boardId) || CAREER_SKATER_BOARDS[0];
      const category = findCareerCategory(categories, board.abbr);
      const leaders = (category?.leaders || []).slice(0, 15);
      const players = [];
      for (const leader of leaders) {
        const base = await resolveAthleteLeader(leader);
        players.push({
          ...base,
          value: base.raw
        });
      }
      return { source: 'espn', note: 'карьера · ESPN all-time', players };
    });
  }

  // --- Team + Player screens (NHL first, ESPN CORS fallback) ---

  // NHL salary ceiling (USD). Used when a payroll figure is available to compute space.
  // Soft-empty when APIs omit team cap hit — public NHL/ESPN payloads currently do.
  const NHL_SALARY_CAP = {
    '20252026': 95_500_000,
    '20262027': 104_000_000
  };

  function currentSalaryCapCeiling() {
    const season = String(window.NHL_SEASON || window.NHL_PREV_SEASON || '20262027');
    return NHL_SALARY_CAP[season] || NHL_SALARY_CAP['20262027'] || 95_500_000;
  }

  function mapTeamSalaryCap(raw = {}) {
    const payroll = Number(
      raw.capHit ?? raw.teamCapHit ?? raw.payroll ?? raw.salaryCapHit ?? raw.totalCapHit ?? raw.capHitTotal
    );
    const spaceRaw = raw.capSpace ?? raw.salaryCapSpace ?? raw.space;
    const ceiling = Number(raw.salaryCap ?? raw.capCeiling ?? raw.upperLimit) || currentSalaryCapCeiling();
    const space = Number.isFinite(Number(spaceRaw))
      ? Number(spaceRaw)
      : (Number.isFinite(payroll) ? ceiling - payroll : NaN);
    if (!Number.isFinite(payroll) && !Number.isFinite(space)) return null;
    return {
      capHit: Number.isFinite(payroll) ? formatMoneyUsd(payroll, { allowZero: true }) : '',
      capSpace: Number.isFinite(space) ? formatMoneyUsd(space, { allowZero: true, allowNegative: true }) : '',
      ceiling: formatMoneyUsd(ceiling),
      rawCapHit: Number.isFinite(payroll) ? payroll : null,
      rawCapSpace: Number.isFinite(space) ? space : null,
      source: raw.source || ''
    };
  }

  async function loadTeamSalaryCap(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    // Prefer static PuckPedia snapshot (assets/cap-hits.json); ESPN/NHL public payloads omit payroll.
    const fromPuck = await loadPuckpediaTeamCap(key).catch(() => null);
    if (fromPuck) return { ...fromPuck, source: 'puckpedia' };
    try {
      const slug = espnTeamSlug(key);
      const teamPayload = await fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/teams/${slug}`).catch(() => null);
      const team = teamPayload?.team || {};
      const mapped = mapTeamSalaryCap(team.record || team.franchise || team);
      if (mapped) return mapped;
    } catch { /* soft */ }
    return null;
  }

  async function enrichTeamExtras(team) {
    if (!team) return team;
    const index = await loadTrophyIndex();
    team.trophies = teamTrophiesForAbbrev(index, team.abbrev);
    team.retiredNumbers = retiredNumbersForAbbrev(index, team.abbrev);
    if (!team.salaryCap) {
      team.salaryCap = await loadTeamSalaryCap(team.abbrev).catch(() => null);
    }
    return team;
  }


  function espnTeamSlug(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    return ESPN_SLUG[key] || key.toLowerCase();
  }

  function pickRecordSummary(record) {
    const items = record?.items || record || [];
    const list = Array.isArray(items) ? items : [];
    const total = list.find(item => item.type === 'total') || list[0] || {};
    const stats = Object.fromEntries((total.stats || []).map(stat => [stat.name, stat.value]));
    return {
      summary: total.summary || '',
      wins: Number(stats.wins || 0),
      losses: Number(stats.losses || 0),
      ot: Number(stats.otLosses ?? stats.overtimeLosses ?? 0),
      points: Number(stats.points || 0),
      gp: Number(stats.gamesPlayed || 0)
    };
  }

  function mapRosterPlayer(raw, source) {
    if (source === 'nhl') {
      const name = playerName(raw.firstName, raw.lastName);
      return {
        name,
        nhlId: raw.id || null,
        number: raw.sweaterNumber ?? '',
        position: raw.positionCode || '',
        shoots: raw.shootsCatches || '',
        height: raw.heightInCentimeters ? `${raw.heightInCentimeters} см` : '',
        weight: raw.weightInKilograms ? `${raw.weightInKilograms} кг` : '',
        headshot: raw.headshot || '',
        birthCountry: raw.birthCountry || '',
        isRussian: isRussianPlayer({ ...raw, name })
      };
    }
    const name = raw.displayName || `${raw.firstName || ''} ${raw.lastName || ''}`.trim();
    const birthCountry = raw.birthCountry?.abbreviation || raw.birthCountry || raw.birthPlace?.country || '';
    return {
      name,
      espnId: raw.id || null,
      number: raw.jersey ?? '',
      position: (raw.position || {}).abbreviation || '',
      shoots: raw.hand?.abbreviation || '',
      height: raw.displayHeight || '',
      weight: raw.displayWeight || '',
      headshot: raw.headshot?.href || raw.headshot || '',
      birthCountry,
      isRussian: isRussianPlayer({ ...raw, name, birthCountry, birthPlace: raw.birthPlace, displayBirthPlace: raw.displayBirthPlace })
    };
  }

  function mapTeamScheduleGame(game, abbrev, source) {
    if (source === 'nhl') {
      const mapped = mapNhlGame(game);
      mapped.threeMinRecap = game.threeMinRecap || '';
      mapped.condensedGame = game.condensedGame || '';
      const isHome = mapped.home.short === abbrev;
      mapped.opponent = isHome ? mapped.away : mapped.home;
      mapped.isHome = isHome;
      mapped.resultLabel = mapped.status === 'Final'
        ? `${mapped.away.score ?? 0}:${mapped.home.score ?? 0}`
        : mapped.time;
      return mapped;
    }
    const mapped = mapEspnEvent(game);
    const isHome = mapped.home.short === abbrev;
    mapped.opponent = isHome ? mapped.away : mapped.home;
    mapped.isHome = isHome;
    mapped.resultLabel = mapped.status === 'Final'
      ? `${mapped.away.score ?? 0}:${mapped.home.score ?? 0}`
      : mapped.time;
    return mapped;
  }

  function splitSchedule(games, limit = 6) {
    const upcoming = games.filter(g => g.status === 'FUT' || g.status === 'Live').slice(0, limit);
    const recent = games.filter(g => g.status === 'Final').slice(-limit).reverse();
    return { upcoming, recent };
  }

  function teamStatsFromEspnCategories(categories) {
    const flat = {};
    (categories || []).forEach(cat => {
      (cat.stats || []).forEach(stat => {
        flat[stat.name] = stat.displayValue ?? stat.value;
      });
    });
    const picks = [
      { key: 'games', label: 'Игры', abbr: 'GP' },
      { key: 'wins', label: 'Победы', abbr: 'W' },
      { key: 'losses', label: 'Поражения', abbr: 'L' },
      { key: 'overtimeLosses', label: 'OTL', abbr: 'OTL' },
      { key: 'goals', label: 'Голы', abbr: 'G' },
      { key: 'goalsAgainst', label: 'Пропущено', abbr: 'GA' },
      { key: 'points', label: 'Очки', abbr: 'PTS' },
      { key: 'powerPlayGoals', label: 'Голы в бол.', abbr: 'PPG' },
      { key: 'shotsTotal', label: 'Броски', abbr: 'SOG' },
      { key: 'shootingPct', label: '% бросков', abbr: 'S%' },
      { key: 'faceoffPercent', label: 'Вбрасывания %', abbr: 'FO%' },
      { key: 'penaltyMinutes', label: 'Штрафы', abbr: 'PIM' },
      { key: 'avgGoalsAgainst', label: 'GAA', abbr: 'GAA' },
      { key: 'savePct', label: 'SV%', abbr: 'SV%' }
    ];
    return picks
      .filter(item => flat[item.key] != null && flat[item.key] !== '')
      .map(item => ({ ...item, value: flat[item.key] }));
  }

  function teamStatsFromNhlClub(payload) {
    const skaters = payload?.skaters || [];
    const goalies = payload?.goalies || [];
    if (!skaters.length && !goalies.length) return [];
    const sum = (key) => skaters.reduce((acc, row) => acc + Number(row[key] || 0), 0);
    const gp = Math.max(0, ...skaters.map(row => Number(row.gamesPlayed || 0)));
    const goals = sum('goals');
    const assists = sum('assists');
    const points = sum('points');
    const pim = sum('penaltyMinutes');
    const shots = sum('shots');
    const gaa = goalies.length
      ? (goalies.reduce((acc, g) => acc + Number(g.goalsAgainstAverage ?? g.gaa ?? 0), 0) / goalies.length)
      : null;
    const sv = goalies.length
      ? (goalies.reduce((acc, g) => acc + Number(g.savePctg ?? g.savePercentage ?? 0), 0) / goalies.length)
      : null;
    const rows = [
      { key: 'games', label: 'Игры*', abbr: 'GP', value: gp || '—' },
      { key: 'goals', label: 'Голы', abbr: 'G', value: goals },
      { key: 'assists', label: 'Передачи', abbr: 'A', value: assists },
      { key: 'points', label: 'Очки', abbr: 'PTS', value: points },
      { key: 'shots', label: 'Броски', abbr: 'SOG', value: shots },
      { key: 'pim', label: 'Штрафы', abbr: 'PIM', value: pim }
    ];
    if (gaa != null && gaa > 0) rows.push({ key: 'gaa', label: 'GAA (ср.)', abbr: 'GAA', value: formatGaa(gaa) });
    if (sv != null && sv > 0) rows.push({ key: 'sv', label: 'SV% (ср.)', abbr: 'SV%', value: formatSv(sv) });
    return rows;
  }

  async function resolveEspnDivisionConference(groups) {
    let division = '';
    let conference = '';
    if (!groups) return { division, conference };
    if (groups.name) division = String(groups.name).replace(/ Division$/i, '');
    const parentRef = (groups.parent?.$ref || '').replace('http://', 'https://');
    if (groups.parent?.name) {
      conference = String(groups.parent.name).replace(/ Conference$/i, '');
    } else if (parentRef) {
      try {
        const parent = await fetchJson(parentRef);
        conference = String(parent.name || '').replace(/ Conference$/i, '');
        if (!division && parent.isConference === false) division = String(parent.name || '').replace(/ Division$/i, '');
      } catch { /* optional */ }
    }
    return { division, conference };
  }

  async function loadTeamNhl(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    await ensureSeason();
    const [rosterPayload, schedulePayload, clubStats, standingsPayload] = await Promise.all([
      fetchJson(`${NHL()}/v1/roster/${key}/current`),
      fetchJson(`${NHL()}/v1/club-schedule-season/${key}/now`),
      fetchJson(`${NHL()}/v1/club-stats/${key}/now`).catch(() => null),
      fetchJson(`${NHL()}/v1/standings/now`).catch(() => null)
    ]);
    const standing = (standingsPayload?.standings || []).find(row => loc(row.teamAbbrev).toUpperCase() === key) || {};
    const roster = [
      ...(rosterPayload.forwards || []).map(p => mapRosterPlayer(p, 'nhl')),
      ...(rosterPayload.defensemen || []).map(p => mapRosterPlayer(p, 'nhl')),
      ...(rosterPayload.goalies || []).map(p => mapRosterPlayer(p, 'nhl'))
    ];
    const games = (schedulePayload.games || []).map(g => mapTeamScheduleGame(g, key, 'nhl'));
    const schedule = splitSchedule(games);
    let stats = teamStatsFromNhlClub(clubStats);
    let statsNote = clubStats ? `club-stats · ${window.NHL_SEASON_LABEL || seasonLabelShort()}` : '';
    const month = new Date().getMonth() + 1;
    const emptyCurrent = !stats.length || (Number(stats[0]?.value) === 0 && stats.length < 3);
    // Only fall back to last completed season during Jul–Aug offseason.
    if (emptyCurrent && month >= 7 && month <= 8) {
      try {
        const prev = await fetchJson(`${NHL()}/v1/club-stats/${key}/${nhlPrevSeasonId()}/2`);
        stats = teamStatsFromNhlClub(prev);
        statsNote = `регулярный ${window.NHL_PREV_SEASON_LABEL || seasonLabelShort(nhlPrevSeasonId())}`;
      } catch { /* keep empty */ }
    } else if (emptyCurrent) {
      try {
        const cur = await fetchJson(`${NHL()}/v1/club-stats/${key}/${nhlSeasonId()}/2`);
        const curStats = teamStatsFromNhlClub(cur);
        if (curStats.length) {
          stats = curStats;
          statsNote = seasonNoteNhl();
        }
      } catch { /* keep now/empty */ }
    }
    const homeGame = (schedulePayload.games || []).find(g => loc(g.homeTeam?.abbrev).toUpperCase() === key);
    const arena = loc(homeGame?.venue) || '';
    const city = loc(standing.placeName) || loc(standing.teamPlaceName) || key;
    const name = loc(standing.teamName) || `${city} ${loc(standing.teamCommonName) || key}`;
    const nick = loc(standing.teamCommonName) || key;
    const wins = Number(standing.wins || 0);
    const losses = Number(standing.losses || 0);
    const ot = Number(standing.otLosses || 0);
    const points = Number(standing.points || 0);
    const gp = Number(standing.gamesPlayed || 0);
    return {
      source: 'nhl',
      abbrev: key,
      name,
      nick,
      city,
      logo: logoFor(key),
      arena,
      conference: standing.conferenceName || '',
      division: standing.divisionName || '',
      record: {
        summary: gp ? `${wins}-${losses}-${ot}` : '',
        wins, losses, ot, points, gp
      },
      standingSummary: standing.divisionName ? `${standing.divisionName}` : '',
      roster,
      schedule,
      stats,
      statsNote,
      note: 'NHL api-web'
    };
  }

  async function loadTeamEspn(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    const slug = espnTeamSlug(key);
    const [teamPayload, rosterPayload, schedulePayload, statsPayload] = await Promise.all([
      fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/teams/${slug}`),
      fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/teams/${slug}/roster`),
      fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/teams/${slug}/schedule`),
      fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/teams/${slug}/statistics`).catch(() => null)
    ]);
    const team = teamPayload.team || {};
    const { division, conference } = await resolveEspnDivisionConference(team.groups);
    const venue = team.franchise?.venue || team.venue || {};
    const roster = [];
    (rosterPayload.athletes || []).forEach(group => {
      (group.items || []).forEach(player => roster.push(mapRosterPlayer(player, 'espn')));
    });
    const games = (schedulePayload.events || []).map(ev => mapTeamScheduleGame(ev, key, 'espn'));
    const schedule = splitSchedule(games);
    const categories = statsPayload?.results?.stats?.categories || [];
    const stats = teamStatsFromEspnCategories(categories);
    const record = pickRecordSummary(team.record);
    return {
      source: 'espn',
      abbrev: key,
      name: team.displayName || `${team.location || ''} ${team.name || key}`.trim(),
      nick: team.shortDisplayName || team.name || key,
      city: team.location || venue.address?.city || '',
      logo: logoFor(key),
      arena: venue.fullName || '',
      conference,
      division,
      record,
      standingSummary: team.standingSummary || '',
      roster,
      schedule,
      stats,
      statsNote: stats.length ? 'ESPN team statistics' : '',
      note: 'ESPN'
    };
  }

  async function loadTeam(abbrev) {
    const key = canonicalNhlAbbrev(abbrev);
    if (!key) return null;
    return cached(`team:${key}`, async () => {
      let team = null;
      try {
        team = await loadTeamNhl(key);
      } catch (nhlError) {
        try {
          team = await loadTeamEspn(key);
        } catch (espnError) {
          console.warn('[NHL Diggest] team load failed', nhlError, espnError);
          return null;
        }
      }
      return enrichTeamExtras(team);
    });
  }

  function statsPairsFromFeatured(block, isGoalie) {
    if (!block) return [];
    if (isGoalie) {
      return [
        { abbr: 'GP', label: 'Игры', value: block.gamesPlayed ?? '—' },
        { abbr: 'W', label: 'Победы', value: block.wins ?? '—' },
        { abbr: 'L', label: 'Поражения', value: block.losses ?? '—' },
        { abbr: 'OTL', label: 'OTL', value: block.otLosses ?? '—' },
        { abbr: 'GAA', label: 'GAA', value: block.goalsAgainstAvg != null ? formatGaa(block.goalsAgainstAvg) : '—' },
        { abbr: 'SV%', label: 'SV%', value: block.savePctg != null ? formatSv(block.savePctg) : '—' },
        { abbr: 'SO', label: 'Сухие', value: block.shutouts ?? '—' }
      ];
    }
    return [
      { abbr: 'GP', label: 'Игры', value: block.gamesPlayed ?? '—' },
      { abbr: 'G', label: 'Голы', value: block.goals ?? '—' },
      { abbr: 'A', label: 'Передачи', value: block.assists ?? '—' },
      { abbr: 'PTS', label: 'Очки', value: block.points ?? '—' },
      { abbr: '+/−', label: '+/−', value: block.plusMinus ?? '—' },
      { abbr: 'PIM', label: 'Штрафы', value: block.pim ?? '—' },
      { abbr: 'SOG', label: 'Броски', value: block.shots ?? '—' },
      { abbr: 'PPG', label: 'Голы в бол.', value: block.powerPlayGoals ?? '—' }
    ];
  }


  function statsPairsFromEspnCore(categories, isGoalie) {
    const want = isGoalie
      ? [
          ['games', 'Игры'], ['wins', 'Победы'], ['losses', 'Поражения'],
          ['avgGoalsAgainst', 'GAA'], ['savePct', 'SV%'], ['shutouts', 'Сухие'],
          ['saves', 'Сейвы'], ['goalsAgainst', 'Пропущено']
        ]
      : [
          ['games', 'Игры'], ['goals', 'Голы'], ['assists', 'Передачи'], ['points', 'Очки'],
          ['plusMinus', '+/−'], ['penaltyMinutes', 'Штрафы'], ['shotsTotal', 'Броски'],
          ['powerPlayGoals', 'Голы в бол.'], ['timeOnIce', 'ТОИ']
        ];
    const byName = {};
    for (const category of categories || []) {
      for (const stat of category.stats || []) {
        if (stat?.name) byName[stat.name] = stat.displayValue ?? stat.value;
      }
    }
    return want
      .filter(([key]) => byName[key] != null)
      .map(([key, label]) => ({ abbr: key, label, value: byName[key] }))
      .slice(0, 12);
  }

  function overviewMatchesCurrentSeason(displayName) {
    const text = String(displayName || '');
    const label = String(window.NHL_SEASON_LABEL || ''); // e.g. 2026/27
    if (!label) return true;
    const start = label.slice(0, 4);
    const end2 = label.slice(-2);
    // ESPN uses "2026-27 General"
    return text.includes(`${start}-${end2}`) || text.includes(label) || text.includes(`${start}/${end2}`);
  }

  async function loadEspnCoreSeasonStats(espnId, isGoalie) {
    await ensureSeason();
    const season = espnSeasonYear();
    const url = `${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/seasons/${season}/types/2/athletes/${espnId}/statistics/0?lang=en`;
    const data = await fetchJson(url);
    const categories = data?.splits?.categories || [];
    if (!categories.length) return null;
    return {
      seasonStats: statsPairsFromEspnCore(categories, isGoalie),
      seasonLabel: window.NHL_SEASON_LABEL || seasonLabelShort()
    };
  }

  function statsPairsFromEspnSplit(names, labels, values) {
    const rows = [];
    (names || []).forEach((name, index) => {
      rows.push({
        abbr: labels?.[index] || name,
        label: name,
        value: values?.[index] ?? '—'
      });
    });
    const prefer = new Set(['games', 'goals', 'assists', 'points', 'plusMinus', 'penaltyMinutes', 'shotsTotal', 'powerPlayGoals', 'timeOnIcePerGame', 'wins', 'losses', 'avgGoalsAgainst', 'savePct', 'shutouts', 'goalsAgainstAverage', 'savePctg']);
    const filtered = rows.filter(row => prefer.has(row.label) || prefer.has(String(row.abbr).toLowerCase()));
    return (filtered.length ? filtered : rows).slice(0, 12).map(row => {
      const labelMap = {
        games: 'Игры', goals: 'Голы', assists: 'Передачи', points: 'Очки', plusMinus: '+/−',
        penaltyMinutes: 'Штрафы', shotsTotal: 'Броски', powerPlayGoals: 'Голы в бол.',
        timeOnIcePerGame: 'ТОИ/и', wins: 'Победы', losses: 'Поражения',
        avgGoalsAgainst: 'GAA', savePct: 'SV%', shutouts: 'Сухие'
      };
      return { ...row, label: labelMap[row.label] || row.abbr || row.label };
    });
  }


  function seasonDisplayLabel(value) {
    const text = String(value ?? '').trim();
    if (!text) return '—';
    const compact = text.match(/^(\d{4})(\d{4})$/);
    if (compact) return `${compact[1]}/${compact[2].slice(-2)}`;
    const short = text.match(/^(\d{2})[-–](\d{2})$/);
    if (short) return `${short[1]}/${short[2]}`;
    return text;
  }

  function awardSeasonLabel(value) {
    if (value == null || value === '') return '';
    const text = String(value).trim();
    if (/^\d{4}\d{4}$/.test(text)) return seasonDisplayLabel(text);
    if (/^\d{4}$/.test(text)) return `${Number(text) - 1}/${text.slice(-2)}`;
    return seasonDisplayLabel(text);
  }

  function awardName(value) {
    return loc(value).replace(/\s+/g, ' ').trim();
  }

    function mapNhlAwards(awards) {
    return normalizeAwards((awards || []).map(award => ({
      name: award?.trophy?.default || award?.trophy?.en || award?.trophy,
      seasons: award?.seasons || []
    })));
  }

  function espnAwardSeasonLabel(award, ref = '') {
    const season = award?.season;
    const direct = season?.displayName || season?.year || (typeof season !== 'object' ? season : '');
    if (direct) return awardSeasonLabel(direct);
    const seasonRef = season?.$ref || ref;
    const match = String(seasonRef).match(/\/seasons\/(\d{4})(?:[\/?]|$)/i);
    return match ? awardSeasonLabel(match[1]) : '';
  }

  function mapEspnOverviewAwards(overviewAwards = []) {
    return (overviewAwards || [])
      .map(award => ({
        name: award?.name || award?.shortName || '',
        seasons: award?.seasons || []
      }))
      .filter(entry => entry.name && entry.seasons.length);
  }

  async function loadEspnAwardEntries(espnId, overview = null) {
    const fromOverview = mapEspnOverviewAwards(overview?.awards);
    let fromCore = [];
    try {
      const data = await fetchJson(`${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/athletes/${espnId}/awards`);
      const items = data?.items || [];
      // Cap parallel fetches — overview usually has the compact list already.
      const limited = fromOverview.length ? [] : items.slice(0, 40);
      fromCore = (await Promise.all(limited.map(async item => {
        const ref = (item?.$ref || item?.ref || '').replace('http://', 'https://');
        let award = item;
        if (ref) {
          try { award = await fetchJson(ref); } catch { return null; }
        }
        const season = espnAwardSeasonLabel(award, ref);
        return award?.name && season ? { name: award.name, seasons: [season] } : null;
      }))).filter(Boolean);
    } catch { /* optional */ }
    return [...fromOverview, ...fromCore];
  }

  async function loadEspnAwards(espnId) {
    const entries = await loadEspnAwardEntries(espnId);
    return normalizeAwards(entries);
  }

  async function resolveEspnIdByName(name) {
    const q = String(name || '').trim();
    if (!q) return null;
    try {
      const data = await fetchJson(`${ESPN_WEB()}/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=8&type=player`);
      const items = data?.items || [];
      const needle = normalizedName(q);
      const hit = items.find(item =>
        /hockey|nhl/i.test(`${item.sport || ''} ${item.league || ''}`) &&
        normalizedName(item.displayName || item.shortName) === needle
      ) || items.find(item => /hockey|nhl/i.test(`${item.sport || ''} ${item.league || ''}`));
      return hit?.id ? String(hit.id) : null;
    } catch {
      return null;
    }
  }

  async function loadEspnCoreBirth(espnId) {
    try {
      const core = await fetchJson(`${ESPN_CORE()}/v2/sports/hockey/leagues/nhl/athletes/${espnId}?lang=en&region=us`);
      return {
        birthCountry: core?.birthCountry || null,
        birthPlace: core?.birthPlace || null,
        citizenship: core?.citizenship || core?.citizenOf || null
      };
    } catch {
      return {};
    }
  }

  function parseTimeOnIce(value) {
    const match = String(value || '').match(/^(\d+):(\d{2})$/);
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function isCareerTotalsRow(row) {
    const labels = [
      row?.teamName,
      row?.teamCommonName,
      row?.teamAbbrev,
      row?.teamTriCode,
      row?.teamSlug,
      row?.club,
      row?.name
    ].map(value => loc(value).trim().toLowerCase());
    return labels.some(label => label === 'totals' || label === 'total' || label === 'итого');
  }

  function buildCareerHistory(rows, isGoalie) {
    const regular = (rows || [])
      .filter(row => Number(row.gameTypeId) === 2)
      .filter(row => !isCareerTotalsRow(row));
    if (!regular.length) return [];
    // NHL's landing payload also contains junior, international and playoff
    // rows. Prefer NHL regular-season clubs, while retaining a useful fallback
    // for players who have not reached the NHL yet.
    const nhlRows = regular.filter(row => String(row.leagueAbbrev || '').toUpperCase() === 'NHL');
    const sourceRows = nhlRows.length ? nhlRows : regular;
    const clubs = new Map();
    sourceRows.forEach(row => {
      const name = loc(row.teamName) || loc(row.teamCommonName) || '—';
      const key = name.toLowerCase();
      if (!clubs.has(key)) {
        clubs.set(key, {
          club: name,
          seasons: new Set(),
          gp: 0,
          goals: 0,
          assists: 0,
          points: 0,
          wins: 0,
          losses: 0,
          otLosses: 0,
          goalsAgainst: 0,
          shotsAgainst: 0,
          shutouts: 0,
          timeOnIce: 0,
          gaaSamples: [],
          svSamples: []
        });
      }
      const club = clubs.get(key);
      club.seasons.add(seasonDisplayLabel(row.season));
      club.gp += Number(row.gamesPlayed || 0);
      if (isGoalie) {
        club.wins += Number(row.wins || 0);
        club.losses += Number(row.losses || 0);
        club.otLosses += Number(row.otLosses || 0);
        club.goalsAgainst += Number(row.goalsAgainst || 0);
        club.shotsAgainst += Number(row.shotsAgainst || 0);
        club.shutouts += Number(row.shutouts || 0);
        club.timeOnIce += parseTimeOnIce(row.timeOnIce);
        if (row.goalsAgainstAvg != null) club.gaaSamples.push(Number(row.goalsAgainstAvg));
        if (row.savePctg != null) club.svSamples.push(Number(row.savePctg));
      } else {
        club.goals += Number(row.goals || 0);
        club.assists += Number(row.assists || 0);
        club.points += Number(row.points || 0);
      }
    });
    return [...clubs.values()]
      .map(club => {
        const seasons = [...club.seasons].sort((a, b) => a.localeCompare(b));
        const latestSeason = seasons[seasons.length - 1] || '';
        const result = { club: club.club, seasons, latestSeason, gp: club.gp };
        if (isGoalie) {
          const gaa = club.timeOnIce > 0
            ? club.goalsAgainst / (club.timeOnIce / 3600)
            : club.gaaSamples.length
              ? club.gaaSamples.reduce((sum, value) => sum + value, 0) / club.gaaSamples.length
              : null;
          const sv = club.shotsAgainst > 0
            ? (club.shotsAgainst - club.goalsAgainst) / club.shotsAgainst
            : club.svSamples.length
              ? club.svSamples.reduce((sum, value) => sum + value, 0) / club.svSamples.length
              : null;
          Object.assign(result, {
            wins: club.wins,
            losses: club.losses,
            otLosses: club.otLosses,
            gaa: gaa != null ? formatGaa(gaa) : '—',
            sv: sv != null ? formatSv(sv) : '—',
            shutouts: club.shutouts
          });
        } else {
          Object.assign(result, { goals: club.goals, assists: club.assists, points: club.points });
        }
        return result;
      })
      .sort((a, b) => b.latestSeason.localeCompare(a.latestSeason) || a.club.localeCompare(b.club));
  }

  function buildEspnCareerHistory(payload, isGoalie) {
    if (!payload?.categories?.length) return [];
    const glossary = payload.glossary || [];
    const clubs = new Map();
    payload.categories.forEach(category => {
      (category.statistics || []).forEach(entry => {
        if (isCareerTotalsRow(entry)) return;
        const team = payload.teams?.[entry.teamSlug] || {};
        const name = team.displayName || team.shortDisplayName || entry.teamSlug || '—';
        const key = String(entry.teamId || entry.teamSlug || name).toLowerCase();
        if (!clubs.has(key)) {
          clubs.set(key, {
            club: name,
            seasons: new Set(),
            gp: 0,
            goals: 0,
            assists: 0,
            points: 0,
            wins: 0,
            losses: 0,
            otLosses: 0,
            goalsAgainst: 0,
            shotsAgainst: 0,
            timeOnIce: 0,
            gaa: [],
            sv: [],
            shutouts: 0
          });
        }
        const club = clubs.get(key);
        club.seasons.add(entry.season?.displayName || seasonDisplayLabel(entry.season?.year));
        const labels = category.labels || glossary.map(item => item.abbreviation);
        const values = Object.fromEntries(labels.map((label, index) => [label, entry.stats?.[index]]));
        const number = value => Number(value || 0);
        club.gp += number(values.GP);
        if (isGoalie) {
          club.wins += number(values.W ?? values.WINS);
          club.losses += number(values.L);
          club.otLosses += number(values.OTL);
          club.goalsAgainst += number(values.GA);
          club.shotsAgainst += number(values.SA);
          club.timeOnIce += parseTimeOnIce(values['TOI/G']) * number(values.GP);
          club.gaa.push(Number(values.GAA));
          club.sv.push(Number(values['SV%'] ?? values.SV));
          club.shutouts += number(values.SO);
        } else {
          club.goals += number(values.G);
          club.assists += number(values.A);
          club.points += number(values.PTS);
        }
      });
    });
    return [...clubs.values()].map(club => {
      const seasons = [...club.seasons].sort((a, b) => a.localeCompare(b));
      const result = { club: club.club, seasons, latestSeason: seasons[seasons.length - 1] || '', gp: club.gp };
      if (isGoalie) {
        const gaa = club.gaa.filter(Number.isFinite);
        const sv = club.sv.filter(Number.isFinite);
        const computedGaa = club.timeOnIce > 0
          ? club.goalsAgainst / (club.timeOnIce / 3600)
          : gaa.length ? gaa.reduce((sum, value) => sum + value, 0) / gaa.length : null;
        const computedSv = club.shotsAgainst > 0
          ? (club.shotsAgainst - club.goalsAgainst) / club.shotsAgainst
          : sv.length ? sv.reduce((sum, value) => sum + value, 0) / sv.length : null;
        Object.assign(result, {
          wins: club.wins,
          losses: club.losses,
          otLosses: club.otLosses,
          gaa: computedGaa != null ? formatGaa(computedGaa) : '—',
          sv: computedSv != null ? formatSv(computedSv) : '—',
          shutouts: club.shutouts
        });
      } else {
        Object.assign(result, { goals: club.goals, assists: club.assists, points: club.points });
      }
      return result;
    }).sort((a, b) => b.latestSeason.localeCompare(a.latestSeason) || a.club.localeCompare(b.club));
  }

  async function loadPlayerNhl(nhlId) {
    const landing = await fetchJson(`${NHL()}/v1/player/${nhlId}/landing`);
    const name = playerName(landing.firstName, landing.lastName);
    const position = landing.position || '';
    const isGoalie = String(position).toUpperCase() === 'G';
    const featured = landing.featuredStats?.regularSeason || {};
    const seasonStats = statsPairsFromFeatured(featured.subSeason, isGoalie);
    const careerStats = statsPairsFromFeatured(
      featured.career || landing.careerTotals?.regularSeason,
      isGoalie
    );
    const draft = landing.draftDetails || {};

    // NHL landing omits All-Star Team / All-Star Game; merge ESPN overview awards when possible.
    let espnId = null;
    let espnAwardEntries = [];
    try {
      espnId = await resolveEspnIdByName(name);
      if (espnId) {
        const overview = await fetchJson(`${ESPN_WEB()}/apis/common/v3/sports/hockey/nhl/athletes/${espnId}/overview`).catch(() => null);
        espnAwardEntries = await loadEspnAwardEntries(espnId, overview).catch(() => []);
      }
    } catch (error) {
      console.warn('[NHL Diggest] ESPN awards merge failed', error);
    }

    const rawAwards = [
      ...(landing.awards || []).map(award => ({
        name: award?.trophy?.default || award?.trophy?.en || award?.trophy,
        seasons: award?.seasons || []
      })),
      ...espnAwardEntries
    ];
    const trophyIndex = await loadTrophyIndex();
    const playerKey = landing.playerId || nhlId;
    const stanleySeasons = lookupStanleySeasons(trophyIndex, playerKey, name);
    const trophies = buildPlayerTrophies({
      awardEntries: rawAwards,
      nhlId: playerKey,
      name,
      stanleySeasons,
      firstAllStarSeasons: lookupFirstAllStarSeasons(trophyIndex, playerKey, name),
      secondAllStarSeasons: lookupSecondAllStarSeasons(trophyIndex, playerKey, name),
      nationalEntries: lookupNationalEntries(trophyIndex, playerKey, name)
    });
    const playerNhlId = landing.playerId || nhlId;
    let contract = await loadPuckpediaContract({ nhlId: playerNhlId, name }).catch(() => null);
    if (!contract) contract = mapNhlContract(landing);
    if (!contract && espnId) {
      contract = await loadEspnContract(espnId).catch(() => null);
    }

    return {
      source: 'nhl',
      nhlId: playerNhlId,
      espnId,
      name,
      number: landing.sweaterNumber ?? '',
      position,
      team: loc(landing.fullTeamName) || loc(landing.teamCommonName) || '',
      abbrev: loc(landing.currentTeamAbbrev).toUpperCase(),
      logo: logoFor(loc(landing.currentTeamAbbrev)),
      headshot: landing.headshot || '',
      height: landing.heightInCentimeters ? `${landing.heightInCentimeters} см` : '',
      weight: landing.weightInKilograms ? `${landing.weightInKilograms} кг` : '',
      shoots: landing.shootsCatches || '',
      birthDate: landing.birthDate || '',
      birthPlace: [loc(landing.birthCity), landing.birthCountry].filter(Boolean).join(', '),
      birthCountry: landing.birthCountry || '',
      draft: draft.year ? `${draft.year} · Rd ${draft.round} · #${draft.overallPick} (${draft.teamAbbrev || ''})` : '',
      isRussian: isRussianPlayer({ ...landing, name }),
      seasonStats,
      careerStats,
      careerHistory: buildCareerHistory(landing.seasonTotals, isGoalie),
      awards: trophies.individual,
      trophies: { national: trophies.national, club: trophies.club },
      contract: contract || null,
      flag: resolvePlayerFlag({
        ...landing,
        birthCountry: landing.birthCountry || '',
        birthCity: loc(landing.birthCity),
        birthPlace: [loc(landing.birthCity), landing.birthCountry].filter(Boolean).join(', '),
        name
      }),
      nationality: landing.birthCountry || '',
      seasonLabel: landing.featuredStats?.season
        ? String(landing.featuredStats.season).replace(/(\d{4})(\d{4})/, '$1/$2')
        : 'сезон',
      note: 'NHL player landing'
    };
  }

  async function loadPlayerEspn(espnId) {
    await ensureSeason();
    const [bio, overview, historyPayload, coreBirth] = await Promise.all([
      fetchJson(`${ESPN_WEB()}/apis/common/v3/sports/hockey/nhl/athletes/${espnId}`),
      fetchJson(`${ESPN_WEB()}/apis/common/v3/sports/hockey/nhl/athletes/${espnId}/overview`).catch(() => null),
      fetchJson(`${ESPN_WEB()}/apis/common/v3/sports/hockey/nhl/athletes/${espnId}/stats`).catch(() => null),
      loadEspnCoreBirth(espnId)
    ]);
    const awardEntries = await loadEspnAwardEntries(espnId, overview).catch(() => []);
    const athlete = bio.athlete || {};
    const name = athlete.displayName || athlete.fullName || '—';
    const team = athlete.team || {};
    const position = (athlete.position || {}).abbreviation || '';
    const isGoalie = String(position).toUpperCase() === 'G';
    const statistics = overview?.statistics || {};
    const splits = statistics.splits || [];
    const seasonSplit = splits.find(item => /regular/i.test(item.displayName || '')) || splits[0];
    const careerSplit = splits.find(item => /career/i.test(item.displayName || ''));
    let seasonStats = statsPairsFromEspnSplit(statistics.names, statistics.labels, seasonSplit?.stats);
    const careerStats = statsPairsFromEspnSplit(statistics.names, statistics.labels, careerSplit?.stats);
    let seasonLabel = statistics.displayName || window.NHL_SEASON_LABEL || 'сезон';
    // Overview can lag on the previous campaign for players with 0 GP this season.
    if (!overviewMatchesCurrentSeason(statistics.displayName)) {
      try {
        const core = await loadEspnCoreSeasonStats(espnId, isGoalie);
        if (core?.seasonStats?.length) {
          seasonStats = core.seasonStats;
          seasonLabel = core.seasonLabel;
        } else {
          seasonStats = [];
          seasonLabel = window.NHL_SEASON_LABEL || seasonLabelShort();
        }
      } catch {
        seasonStats = [];
        seasonLabel = window.NHL_SEASON_LABEL || seasonLabelShort();
      }
    }
    const birthCountry = coreBirth.birthCountry?.abbreviation
      || coreBirth.birthPlace?.country
      || (() => {
        const place = athlete.displayBirthPlace || '';
        const parts = String(place).split(',').map(part => part.trim()).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
      })();
    const birthPlace = athlete.displayBirthPlace
      || [coreBirth.birthPlace?.city, coreBirth.birthPlace?.state, coreBirth.birthPlace?.country].filter(Boolean).join(', ')
      || '';
    const trophyIndex = await loadTrophyIndex();
    const stanleySeasons = lookupStanleySeasons(trophyIndex, '', name);
    const trophies = buildPlayerTrophies({
      awardEntries,
      nhlId: '',
      name,
      stanleySeasons,
      firstAllStarSeasons: lookupFirstAllStarSeasons(trophyIndex, '', name),
      secondAllStarSeasons: lookupSecondAllStarSeasons(trophyIndex, '', name),
      nationalEntries: lookupNationalEntries(trophyIndex, '', name)
    });
    let contract = await loadPuckpediaContract({ nhlId: null, name }).catch(() => null);
    if (!contract) {
      contract = await loadEspnContract(athlete.id || espnId).catch(() => null);
    }
    return {
      source: 'espn',
      nhlId: null,
      espnId: athlete.id || espnId,
      name,
      number: athlete.jersey || athlete.displayJersey || '',
      position,
      team: team.displayName || team.shortDisplayName || '',
      abbrev: canonicalNhlAbbrev(team.abbreviation),
      logo: logoFor(team.abbreviation),
      headshot: athlete.headshot?.href || '',
      height: athlete.displayHeight || '',
      weight: athlete.displayWeight || '',
      shoots: athlete.hand?.abbreviation || athlete.hand?.displayValue || '',
      birthDate: athlete.displayDOB || '',
      birthPlace,
      birthCountry,
      draft: athlete.displayDraft || '',
      isRussian: isRussianPlayer({
        ...athlete,
        name,
        displayBirthPlace: birthPlace,
        birthPlace: coreBirth.birthPlace || birthPlace,
        birthCountry,
        citizenship: coreBirth.citizenship
      }),
      seasonStats,
      careerStats,
      careerHistory: buildEspnCareerHistory(historyPayload, position === 'G'),
      awards: trophies.individual,
      trophies: { national: trophies.national, club: trophies.club },
      contract: contract || null,
      flag: resolvePlayerFlag({
        ...athlete,
        name,
        displayBirthPlace: birthPlace,
        birthPlace: coreBirth.birthPlace || birthPlace,
        birthCountry: coreBirth.birthCountry || birthCountry,
        citizenship: coreBirth.citizenship
      }),
      nationality: birthCountry || birthPlace || '',
      seasonLabel,
      note: 'ESPN athlete'
    };
  }

  async function loadPlayer(ref = {}) {
    const nhlId = ref.nhlId || (!ref.espnId && ref.id && String(ref.id).length >= 6 ? ref.id : null);
    const espnId = ref.espnId || ref.athleteId || (ref.scorerEspn && ref.scorerId) || null;
    const cacheKey = `player:${nhlId || ''}:${espnId || ''}:${ref.name || ''}`;
    return cached(cacheKey, async () => {
      if (nhlId) {
        try { return await loadPlayerNhl(nhlId); } catch (error) {
          console.warn('[NHL Diggest] NHL player failed', error);
        }
      }
      if (espnId) {
        try { return await loadPlayerEspn(espnId); } catch (error) {
          console.warn('[NHL Diggest] ESPN player failed', error);
        }
      }
      if (ref.name && ref.abbrev) {
        try {
          const team = await loadTeam(ref.abbrev);
          const match = (team?.roster || []).find(p => normalizedName(p.name) === normalizedName(ref.name));
          if (match?.nhlId) return await loadPlayerNhl(match.nhlId);
          if (match?.espnId) return await loadPlayerEspn(match.espnId);
        } catch (error) {
          console.warn('[NHL Diggest] player roster resolve failed', error);
        }
      }
      return null;
    });
  }

  function extractEspnGameRecap(videos) {
    const pool = videos || [];
    const preferred = pool.find(video => /game highlights/i.test(video.headline || video.description || ''))
      || pool.find(video => /recap|highlights/i.test(video.headline || ''));
    if (!preferred) return null;
    const href = espnVideoHref(preferred);
    if (!href) return null;
    return {
      url: href,
      embed: /\.mp4(\?|$)/i.test(href),
      title: preferred.headline || 'Обзор матча',
      source: 'espn'
    };
  }

  function extractNhlGameRecap(game = {}, landing = {}) {
    const path = game.threeMinRecap || landing.threeMinRecap || game.condensedGame || landing.condensedGame || '';
    if (!path) return null;
    const url = /^https?:/i.test(path) ? path : `https://www.nhl.com${path.startsWith('/') ? '' : '/'}${path}`;
    return { url, embed: false, title: 'Обзор матча', source: 'nhl' };
  }

  async function findEspnRecapForGame(game) {
    if (!game?.startTimeUTC && !game?.away?.short) return null;
    try {
      const dateKey = game.startTimeUTC
        ? new Date(game.startTimeUTC).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        : mskDateKey();
      const events = await scoreEspn(dateKey);
      const away = String(game.away?.short || '').toUpperCase();
      const home = String(game.home?.short || '').toUpperCase();
      const match = events.find(ev => ev.away.short === away && ev.home.short === home)
        || events.find(ev => [ev.away.short, ev.home.short].includes(away) && [ev.away.short, ev.home.short].includes(home));
      if (!match) return null;
      const summary = await fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/summary?event=${match.id}`);
      return extractEspnGameRecap(summary.videos || []);
    } catch (error) {
      console.warn('[NHL Diggest] ESPN recap lookup failed', error);
      return null;
    }
  }



  async function gameStubFromId(gameId) {
    const id = String(gameId || '').trim();
    if (!id) return null;
    try {
      const cachedPayload = await fetchCacheGamePayload(id);
      const stub = stubFromCachePayload(cachedPayload, id);
      if (stub) return stub;
    } catch (error) {
      console.info('[NHL Diggest] gameStubFromId cache failed', error?.message || error);
    }
    try {
      const landing = await fetchJson(`${NHL()}/v1/gamecenter/${id}/landing`);
      if (landing && (landing.id || landing.awayTeam || landing.homeTeam)) {
        const mapped = mapNhlGame({ ...landing, id: landing.id || Number(id) || id });
        return mapped;
      }
    } catch (error) {
      console.warn('[NHL Diggest] gameStubFromId NHL failed', error);
    }
    try {
      const summary = await fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/summary?event=${id}`);
      const header = summary?.header || {};
      const competitions = header.competitions || summary?.competitions || [];
      const event = {
        id,
        date: header.competitions?.[0]?.date || summary?.gameInfo?.date || '',
        season: header.season || {},
        status: header.competitions?.[0]?.status || {},
        competitions: competitions.length ? competitions : [{
          competitors: summary?.boxscore?.teams || [],
          status: header.competitions?.[0]?.status || {},
          venue: summary?.gameInfo?.venue
        }]
      };
      // Prefer mapping via competitors if present on header
      if (header.competitions?.[0]) {
        return mapEspnEvent({ ...header, id });
      }
      return mapEspnEvent(event);
    } catch (error) {
      console.warn('[NHL Diggest] gameStubFromId ESPN failed', error);
      return null;
    }
  }


  // ESPN athlete ids for retired-number honorees. Resolved with the same
  // ESPN search host the app already uses, exact normalized displayName,
  // hockey/NHL only, then checked against
  // /apis/common/v3/sports/hockey/nhl/athletes/{id} (the page loadPlayerEspn opens).
  // Names that search cannot open are intentionally absent.
  const RETIRED_ESPN_ID_BY_NAME = {
    "adam foote": '282',
    "adam graves": '321',
    "al macinnis": '554',
    "anders hedberg": '2016835',
    "andy bathgate": '5628',
    "arturs irbe": '402',
    "bernie geoffrion": '2016578',
    "bernie parent": '2018117',
    "bill barber": '2015571',
    "billy smith": '2018656',
    "bob gainey": '2016525',
    "bobby clarke": '2016038',
    "bobby hull": '2016995',
    "bobby orr": '2018085',
    "brett hull": '395',
    "brian leetch": '529',
    "brian sutter": '2018810',
    "bryan trottier": '4377',
    "butch goring": '2016650',
    "cam neely": '4543',
    "chris chelios": '151',
    "chris neil": '1201',
    "chris osgood": '700',
    "chris phillips": '725',
    "chris pronger": '3943000',
    "colby cave": '3069528',
    "dale hawerchuk": '4357',
    "dale hunter": '4406',
    "daniel alfredsson": '12',
    "daniel sedin": '836',
    "dave taylor": '4764',
    "denis potvin": '2018245',
    "denis savard": '4634',
    "dickie moore": '2017915',
    "dominik hasek": '348',
    "doug gilmour": '306',
    "doug harvey": '2016807',
    "dustin brown": '2288',
    "eddie giacomin": '2016583',
    "elmer lach": '2017295',
    "eric lindros": '543',
    "eric staal": '2378',
    "glen wesley": '1013',
    "glenn anderson": '4477',
    "gordie howe": '2016967',
    "grant fuhr": '289',
    "henri richard": '2018347',
    "henrik lundqvist": '3081',
    "henrik sedin": '837',
    "henrik zetterberg": '1964',
    "howie morenz": '2017918',
    "jacques plante": '2018211',
    "jari kurri": '4407',
    "jarome iginla": '401',
    "jaromir jagr": '405',
    "jean beliveau": '2015628',
    "jean ratelle": '2018305',
    "jean sebastien giguere": '302',
    "jere lehtinen": '533',
    "joe mullen": '4379',
    "joe nieuwendyk": '674',
    "joe sakic": '812',
    "joe thornton": '939',
    "johnny bower": '2015778',
    "johnny gaudreau": '2563039',
    "josef vasicek": '978',
    "ken daneyko": '194',
    "ken dryden": '2016309',
    "kevin lowe": '4701',
    "lanny mcdonald": '2017734',
    "luc bourdon": '3251',
    "luc robitaille": '791',
    "marcel dionne": '2016272',
    "marian hossa": '386',
    "mario lemieux": '1084',
    "mark howe": '4675',
    "mark messier": '611',
    "markus naslund": '661',
    "martin brodeur": '108',
    "martin st louis": '883',
    "matiss kivlenieks": '4227205',
    "mats sundin": '904',
    "maurice richard": '2018350',
    "michel goulet": '4640',
    "miikka kiprusoff": '454',
    "mike bossy": '2015752',
    "mike gartner": '4289',
    "mike modano": '625',
    "mike richter": '781',
    "mike vernon": '982',
    "mikko koivu": '2147',
    "milan hejduk": '362',
    "milt schmidt": '2018525',
    "neal broten": '4825',
    "nicklas lidstrom": '539',
    "olaf kolzig": '467',
    "pat lafontaine": '4131',
    "patrick marleau": '576',
    "patrick roy": '804',
    "patrik elias": '246',
    "paul coffey": '166',
    "paul kariya": '434',
    "pavel bure": '123',
    "pavel datsyuk": '1223',
    "pekka rinne": '3157',
    "pelle lindbergh": '2017462',
    "peter forsberg": '284',
    "peter stastny": '4481',
    "phil esposito": '2016390',
    "pierre pilote": '2018201',
    "randy carlyle": '2015950',
    "ray bourque": '95',
    "red berenson": '2015651',
    "red kelly": '2017178',
    "rick middleton": '2017862',
    "rick nash": '1569',
    "rick rypien": '3290',
    "rob blake": '75',
    "roberto luongo": '551',
    "rod brind amour": '105',
    "rod gilbert": '2016597',
    "rod langway": '2017342',
    "rogie vachon": '2018944',
    "ron francis": '286',
    "ryan miller": '1549',
    "ryan smyth": '876',
    "scott niedermayer": '670',
    "scott stevens": '889',
    "sergei fedorov": '262',
    "sergei zubov": '1060',
    "sid abel": '2015430',
    "steve chiasson": '4748',
    "steve yzerman": '1049',
    "ted kennedy": '2017185',
    "ted lindsay": '2017467',
    "teemu selanne": '839',
    "teppo numminen": '684',
    "theoren fleury": '281',
    "thomas steen": '4302',
    "tony esposito": '2016391',
    "trevor linden": '541',
    "turk broda": '2015821',
    "vincent lecavalier": '523',
    "vladimir konstantinov": '4673',
    "wayne gretzky": '4128',
    "wendel clark": '161',
    "yvan cournoyer": '2016113',
    "zdeno chara": '145'
  };

  function retiredEspnId(name) {
    const key = normalizedName(name);
    return key ? (RETIRED_ESPN_ID_BY_NAME[key] || '') : '';
  }

  window.NHL_LIVE = {
    mskDateKey,
    shiftDate,
    logoFor,
    teamColorFor,
    periodHeadingLabel,
    gamesForDate,
    gameStubFromId,
    loadStandings,
    loadBoard,
    loadRookies,
    loadCareerBoard,
    loadTeam,
    loadPlayer,
    retiredEspnId,
    gameDetail,
    groupByPeriod,
    periodLabel: careerPeriodLabel,
    ensureSeason,
    nhlSeasonId,
    espnSeasonYear,
    SKATER_BOARDS,
    GOALIE_BOARDS,
    CAREER_SKATER_BOARDS,
    CAREER_GOALIE_BOARDS,
    isRussianPlayer,
    resolvePlayerFlag,
    clearCache: () => { cache.clear(); seasonReady = null; },
    clearStatsCache: () => {
      for (const key of [...cache.keys()]) {
        if (String(key).startsWith('board:') || String(key).startsWith('rookies:')) cache.delete(key);
      }
    }
  };
})();
