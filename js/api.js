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

  const ESPN_SLUG = { LAK: 'la', TBL: 'tb', NJD: 'nj', SJS: 'sj', WSH: 'wsh', MTL: 'mtl', UTA: 'utah' };
  const LIVE = new Set(['LIVE', 'CRIT']);
  const FINAL = new Set(['OFF', 'FINAL', 'OVER']);

  const cache = new Map();

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
    const key = String(abbrev || '').toUpperCase();
    const slug = ESPN_SLUG[key] || key.toLowerCase();
    if (!slug) return '';
    return `https://a.espncdn.com/i/teamlogos/nhl/500/${slug}.png`;
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
    if (game.gameOutcome?.lastPeriodType === 'OT' || type === 'OT') return 'OT';
    if (game.gameOutcome?.lastPeriodType === 'SO' || type === 'SO') return 'SO';
    return num ? `${num}` : '';
  }

  function mapNhlTeam(team) {
    const short = loc(team?.abbrev).toUpperCase();
    const place = loc(team?.placeName) || loc(team?.commonName) || short;
    const nick = loc(team?.commonName) || loc(team?.teamName) || short;
    return {
      name: place,
      nick,
      short,
      logo: logoFor(short),
      score: team?.score == null ? null : Number(team.score)
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

  function mapEspnEvent(event) {
    const comp = (event.competitions || [])[0] || {};
    const competitors = comp.competitors || [];
    const awayRaw = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
    const homeRaw = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
    const typeName = String(event.status?.type?.name || comp.status?.type?.name || '');
    const state = event.status?.type?.state || comp.status?.type?.state || '';
    let status = 'FUT';
    if (state === 'in' || /IN_PROGRESS|STATUS_IN_PROGRESS/.test(typeName)) status = 'Live';
    else if (state === 'post' || /FINAL|STATUS_FINAL/.test(typeName)) status = 'Final';
    const seasonType = Number(event.season?.type);
    const mapSide = raw => {
      const team = raw.team || {};
      const short = String(team.abbreviation || '').toUpperCase();
      const display = team.displayName || team.name || short;
      const parts = display.split(' ');
      const nick = team.shortDisplayName || team.name || parts[parts.length - 1] || short;
      const place = display.replace(new RegExp(`\\s*${nick}$`), '') || display;
      const scoreNum = raw.score == null || raw.score === '' ? null : Number(raw.score);
      return { name: place || display, nick, short, logo: logoFor(short), score: Number.isFinite(scoreNum) ? scoreNum : null };
    };
    const period = status === 'Live'
      ? (event.status?.type?.shortDetail || event.status?.type?.detail || 'LIVE')
      : status === 'Final'
        ? (event.status?.type?.shortDetail || '')
        : '';
    return {
      id: event.id,
      gameType: seasonType,
      preseason: seasonType === 1,
      status,
      time: status === 'Final' ? 'Завершён' : status === 'Live' ? 'LIVE' : formatMskTime(event.date),
      period: status === 'FUT' ? '' : period,
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

  async function gamesForDate(dateKey) {
    return cached(`games:${dateKey}`, async () => {
      let source = 'mock';
      let games = [];
      try {
        const payload = await scoreNhl(dateKey);
        games = extractNhlGames(payload, dateKey);
        source = 'nhl';
      } catch (nhlError) {
        try {
          const payload = await scheduleNhl(dateKey);
          games = extractNhlGames(payload, dateKey);
          source = 'nhl';
        } catch {
          try {
            games = await scoreEspn(dateKey);
            source = 'espn';
          } catch (espnError) {
            console.warn('[NHL Diggest] schedule fetch failed', nhlError, espnError);
            return { games: null, source: 'mock', error: true };
          }
        }
      }
      // Use NHL/ESPN date bucket as-is; tip-off times are shown in MSK.
      // Overnight ET games may display as 00:00–05:30 MSK next calendar morning.
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
          const abbrev = String(team.abbreviation || '').toUpperCase();
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
      try {
        const now = await standingsNhl('/v1/standings/now');
        const grouped = groupStandings(now);
        if (grouped.played > 0) {
          grouped.sourceNote = 'текущий сезон';
          grouped.source = 'nhl';
          return grouped;
        }
        // Regular-season table is empty during preseason — use last completed season.
        const prev = await standingsNhl('/v1/standings/2026-04-14');
        const prevGrouped = groupStandings(prev);
        prevGrouped.sourceNote = 'регулярный 2025/26';
        prevGrouped.source = 'nhl-prev';
        if (prevGrouped.played > 0) return prevGrouped;
      } catch (nhlError) {
        try {
          const rows = await standingsEspn();
          const grouped = groupStandings(rows);
          grouped.sourceNote = grouped.played > 0 ? 'ESPN' : 'ESPN · сезон ещё не начат';
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
      team: loc(row.teamName) || loc(row.teamAbbrev),
      abbrev: loc(row.teamAbbrev).toUpperCase(),
      position: row.position || '',
      value,
      headshot: row.headshot || ''
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
    const season = window.NHL_PREV_SEASON || '20252026';
    const gameType = window.NHL_GAME_TYPE_REG || '2';
    const path = kind === 'goalie' ? 'goalie-stats-leaders' : 'skater-stats-leaders';
    const data = await fetchJson(`${NHL()}/v1/${path}/${season}/${gameType}?categories=${encodeURIComponent(category)}&limit=15`);
    const rows = data[category] || data[Object.keys(data)[0]] || [];
    return rows.slice(0, 15);
  }

  async function espnByAthlete(sort, limit = 15) {
    const season = window.ESPN_SEASON_PREV || 2025;
    const url = `${ESPN_WEB()}/apis/common/v3/sports/hockey/nhl/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=${limit}&sort=${encodeURIComponent(sort)}&season=${season}&seasontype=2`;
    const data = await fetchJson(url);
    return data.athletes || [];
  }

  async function coreStat(athleteId, name) {
    const season = window.ESPN_SEASON_PREV || 2025;
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
      return {
        name: athlete.displayName,
        team: athlete.teamShortName || athlete.teamName || '',
        abbrev: '',
        position: (athlete.position || {}).abbreviation || '',
        value: value ?? '—',
        headshot: athlete.headshot?.href || ''
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
    return {
      name: athlete.displayName,
      team: athlete.teamShortName || athlete.teamName || '',
      position: (athlete.position || {}).abbreviation || '',
      headshot: athlete.headshot?.href || '',
      debutYear: athlete.debutYear || null,
      goals: pick('offensive', 0),
      assists: pick('offensive', 1),
      points: pick('offensive', 2),
      plusMinus: pick('general', 1),
      toi: pick('general', names.general.indexOf('timeOnIce')),
      pim: pick('penalties', 0)
    };
  }

  async function loadBoard(group, boardId) {
    const key = `board:${group}:${boardId}`;
    return cached(key, async () => {
      if (group === 'goalies') {
        const board = GOALIE_BOARDS.find(item => item.id === boardId) || GOALIE_BOARDS[0];
        try {
          const rows = await nhlCategory('goalie', board.nhl);
          return {
            source: 'nhl',
            note: 'регулярный 2025/26',
            players: rows.map(row => ({
              ...mapLeader(row, board.format ? board.format(row.value) : row.value),
              position: 'G'
            }))
          };
        } catch {
          const coreName = { gaa: 'avgGoalsAgainst', shutouts: 'shutouts', sv: 'savePct', wins: 'wins' }[board.id] || 'wins';
          const season = window.ESPN_SEASON_PREV || 2025;
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
              team: team.abbreviation || team.shortDisplayName || '',
              position: 'G',
              value: board.format ? board.format(raw) : raw,
              headshot: athlete.headshot?.href || ''
            });
          }
          return { source: 'espn', note: 'ESPN · 2024/25', players };
        }
      }

      const board = SKATER_BOARDS.find(item => item.id === boardId) || SKATER_BOARDS[0];
      if (board.espnSort) {
        try {
          const players = await espnHitsOrBlocks(board.stat, board.espnSort, 12);
          if (players.length) return { source: 'espn', note: 'ESPN · 2024/25', players };
        } catch (error) {
          console.warn('[NHL Diggest] espn stat board failed', error);
        }
      }
      try {
        if (!board.nhl) throw new Error('no nhl category');
        const rows = await nhlCategory('skater', board.nhl);
        return {
          source: 'nhl',
          note: 'регулярный 2025/26',
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
        return { source: 'espn', note: 'ESPN · 2024/25', players };
      }
    });
  }

  async function loadRookies(boardId) {
    return cached(`rookies:${boardId}`, async () => {
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
      const rookies = athletes.filter(entry => {
        const athlete = entry.athlete || {};
        if ((athlete.position || {}).abbreviation === 'G') return false;
        const debut = Number(athlete.debutYear);
        if (debut && debut >= 2024) return true;
        // ESPN omits debutYear for several recent first-years; age <= 21 is a conservative proxy.
        return !debut && Number(athlete.age) > 0 && Number(athlete.age) <= 21;
      });
      const needsCore = boardId === 'hits' || boardId === 'blocks';
      const players = [];
      for (const entry of rookies.slice(0, 12)) {
        const mapped = skaterFromEspn(entry);
        if (!mapped) continue;
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
      }
      return { source: 'espn', note: 'новички · ESPN 2024/25', players };
    });
  }

  async function gameDetail(game) {
    const key = `detail:${game.id}`;
    return cached(key, async () => {
      if (!game.espn) {
        try {
          const [landing, box] = await Promise.all([
            fetchJson(`${NHL()}/v1/gamecenter/${game.id}/landing`),
            fetchJson(`${NHL()}/v1/gamecenter/${game.id}/boxscore`)
          ]);
          return { source: 'nhl', ...normalizeNhlDetail(landing, box, game) };
        } catch (error) {
          console.warn('[NHL Diggest] NHL game detail failed', error);
        }
      }
      try {
        const summary = await fetchJson(`${ESPN_SITE()}/apis/site/v2/sports/hockey/nhl/summary?event=${game.id}`);
        return { source: 'espn', ...normalizeEspnDetail(summary, game) };
      } catch (error) {
        console.warn('[NHL Diggest] ESPN game detail failed', error);
        return null;
      }
    });
  }

  function normalizeNhlDetail(landing, box, game) {
    const summary = landing.summary || {};
    const scoring = [];
    (summary.scoring || []).forEach(period => {
      const desc = period.periodDescriptor || {};
      const label = desc.periodType === 'OT' ? 'OT' : desc.periodType === 'SO' ? 'SO' : `${desc.number || ''}`.trim();
      (period.goals || []).forEach(goal => {
        scoring.push({
          period: careerPeriodLabel(label || desc.number || '—'),
          time: goal.timeInPeriod || '',
          team: loc(goal.teamAbbrev).toUpperCase(),
          scorer: playerName(goal.firstName, goal.lastName),
          assists: (goal.assists || []).map(assist => playerName(assist.firstName, assist.lastName)).filter(Boolean),
          strength: goal.strength || ''
        });
      });
    });
    const penalties = [];
    (summary.penalties || []).forEach(period => {
      const desc = period.periodDescriptor || {};
      const label = desc.periodType === 'OT' ? 'OT' : desc.periodType === 'SO' ? 'SO' : `${desc.number || ''}`;
      (period.penalties || []).forEach(pen => {
        const who = pen.firstName || pen.lastName
          ? playerName(pen.firstName, pen.lastName)
          : loc(pen.committedByPlayer) || loc(pen.descKey);
        penalties.push({
          period: careerPeriodLabel(label || desc.number || '—'),
          time: pen.timeInPeriod || '',
          team: loc(pen.teamAbbrev || pen.committedByTeam).toUpperCase(),
          player: who,
          minutes: pen.duration || pen.penaltyMinutes || '',
          infraction: loc(pen.descKey) || loc(pen.type) || ''
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
      const players = [...(sideStats.forwards || []), ...(sideStats.defense || [])];
      const shots = players.reduce((sum, player) => sum + Number(player.sog || 0), 0);
      const hits = players.reduce((sum, player) => sum + Number(player.hits || 0), 0);
      boxscore[team.short] = { shots, hits, faceoff: '—', powerPlay: '—' };
      players
        .filter(player => player.goals || player.assists || player.pim)
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 8)
        .forEach(player => {
          skaters.push({
            team: team.short,
            name: loc(player.name),
            goals: player.goals ?? 0,
            assists: player.assists ?? 0,
            pim: player.pim ?? 0,
            plusMinus: player.plusMinus ?? 0,
            toi: player.toi || ''
          });
        });
      (sideStats.goalies || []).forEach(goalie => {
        goalies.push({
          team: team.short,
          name: loc(goalie.name),
          saves: goalie.saveShotsAgainst || `${goalie.saves ?? '—'}/${goalie.shotsAgainst ?? '—'}`,
          sv: goalie.savePctg != null ? formatSv(goalie.savePctg) : '',
          decision: goalie.decision || '',
          toi: goalie.toi || ''
        });
      });
    });
    return {
      venue: loc(landing.venue) || game.venue || '',
      attendance: '',
      scoring,
      penalties,
      boxscore,
      goalies,
      skaters
    };
  }

  function normalizeEspnDetail(summary, game) {
    const plays = summary.plays || [];
    const scoring = plays.filter(play => play.scoringPlay).map(play => {
      const participants = play.participants || [];
      const scorer = participants.find(item => item.type === 'scorer') || participants[0];
      const assists = participants.filter(item => item.type === 'assist').map(item => item.athlete?.displayName).filter(Boolean);
      const text = play.text || '';
      const teamId = String(play.team?.id || '');
      return {
        period: careerPeriodLabel(play.period?.displayValue || play.period?.number || ''),
        time: play.clock?.displayValue || '',
        team: teamId,
        scorer: scorer?.athlete?.displayName || text.split(' Goal')[0] || text,
        assists,
        strength: /power play|power-play|\bpp\b/i.test(text) ? 'pp' : /short/i.test(text) ? 'sh' : ''
      };
    });
    const box = summary.boxscore || {};
    const boxscore = {};
    (box.teams || []).forEach(teamBlock => {
      const short = String(teamBlock.team?.abbreviation || '').toUpperCase();
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
      teamIdToAbbrev[String(block.team?.id)] = String(block.team?.abbreviation || '').toUpperCase();
    });
    scoring.forEach(goal => {
      if (teamIdToAbbrev[goal.team]) goal.team = teamIdToAbbrev[goal.team];
    });
    const skaters = [];
    const goalies = [];
    (box.players || []).forEach(block => {
      const short = String(block.team?.abbreviation || '').toUpperCase();
      (block.statistics || []).forEach(group => {
        const keys = group.keys || group.names || [];
        const index = name => keys.indexOf(name);
        if (group.name === 'goalies' || /goalie/i.test(group.name || '')) {
          (group.athletes || []).forEach(athlete => {
            const stats = athlete.stats || [];
            goalies.push({
              team: short,
              name: athlete.athlete?.displayName || '',
              saves: stats[index('saves')] && stats[index('shotsAgainst')]
                ? `${stats[index('saves')]}/${stats[index('shotsAgainst')]}`
                : (stats[index('saves')] || '—'),
              sv: stats[index('savePct')] || '',
              decision: '',
              toi: stats[index('timeOnIce')] || ''
            });
          });
          return;
        }
        if (group.name !== 'forwards' && group.name !== 'defenses' && group.name !== 'defense') return;
        (group.athletes || []).forEach(athlete => {
          const stats = athlete.stats || [];
          const goals = Number(stats[index('goals')] || 0);
          const assists = Number(stats[index('assists')] || 0);
          const pim = Number(stats[index('penaltyMinutes')] || 0);
          if (!goals && !assists && !pim) return;
          skaters.push({
            team: short,
            name: athlete.athlete?.displayName || '',
            goals,
            assists,
            pim,
            plusMinus: stats[index('plusMinus')] ?? '',
            toi: stats[index('timeOnIce')] || ''
          });
        });
      });
    });
    const penalties = [];
    plays.forEach(play => {
      const typeText = String(play.type?.text || play.type?.abbreviation || '');
      if (!/penalt/i.test(typeText) && !/penalty/i.test(play.text || '')) return;
      penalties.push({
        period: careerPeriodLabel(play.period?.displayValue || play.period?.number || ''),
        time: play.clock?.displayValue || '',
        team: teamIdToAbbrev[String(play.team?.id)] || '',
        player: (play.participants || [])[0]?.athlete?.displayName || '',
        minutes: '',
        infraction: play.text || typeText
      });
    });
    return {
      venue: summary.gameInfo?.venue?.fullName || game.venue || '',
      attendance: summary.gameInfo?.attendance ? String(summary.gameInfo.attendance) : '',
      scoring,
      penalties: penalties.slice(0, 24),
      boxscore,
      goalies,
      skaters: skaters.slice(0, 16)
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
        teamAbbr = String(team.abbreviation || '').toUpperCase();
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

  window.NHL_LIVE = {
    mskDateKey,
    shiftDate,
    logoFor,
    gamesForDate,
    loadStandings,
    loadBoard,
    loadRookies,
    loadCareerBoard,
    gameDetail,
    groupByPeriod,
    periodLabel: careerPeriodLabel,
    SKATER_BOARDS,
    GOALIE_BOARDS,
    CAREER_SKATER_BOARDS,
    CAREER_GOALIE_BOARDS,
    clearCache: () => cache.clear()
  };
})();
