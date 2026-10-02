(() => {
  'use strict';

  const mock = window.NHL_MOCK || {};
  const live = window.NHL_LIVE;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const DETAIL_PANELS = new Set(['game-detail', 'team-detail', 'player-detail']);

  function playerIsRussian(player) {
    return Boolean(player?.isRussian || live?.isRussianPlayer?.(player));
  }

  function escapeAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function playerMarkup(player, fallbackName = '', attrs = {}) {
    const name = typeof player === 'string' ? player : (player?.name || fallbackName || '');
    const russian = typeof player === 'object' ? playerIsRussian(player) : playerIsRussian(name);
    const nhlId = typeof player === 'object' ? (player.nhlId || player.scorerId && !player.scorerEspn ? player.scorerId : player.id) : '';
    const espnId = typeof player === 'object' ? (player.espnId || player.athleteId || (player.scorerEspn ? player.scorerId : '') || '') : '';
    const abbrev = typeof player === 'object' ? (player.abbrev || player.teamAbbrev || attrs.abbrev || '') : (attrs.abbrev || '');
    const clickable = Boolean(nhlId || espnId || (name && abbrev));
    const data = [
      nhlId ? `data-nhl-id="${escapeAttr(nhlId)}"` : '',
      espnId ? `data-espn-id="${escapeAttr(espnId)}"` : '',
      name ? `data-player-name="${escapeAttr(name)}"` : '',
      abbrev ? `data-team-abbrev="${escapeAttr(String(abbrev).toUpperCase())}"` : ''
    ].filter(Boolean).join(' ');
    const favorite = typeof player === 'object' && isFavoritePlayer({
      nhlId, espnId, name
    });
    const cls = `player-name${russian ? ' russian-player' : ''}${favorite ? ' is-favorite' : ''}${clickable ? ' is-clickable' : ''}`;
    return `<span class="${cls}" ${clickable ? `${data} role="link" tabindex="0"` : ''}>${name}</span>`;
  }

  function assistsMarkup(assists = [], abbrev = '') {
    return assists.map(assist => playerMarkup(assist, assist?.name || assist, { abbrev })).join(', ');
  }

  const bridge = window.NHL_BRIDGE || { env: 'browser', theme: 'dark' };
  const themeStorageKey = 'nhl-diggest-theme';
  const russianHighlightStorageKey = 'nhl-diggest-ru-highlight';
  const FAV_STORAGE_KEY = 'nhl-diggest-favorites';

  function loadFavorites() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(FAV_STORAGE_KEY) || '{}');
      return {
        players: Array.isArray(raw.players) ? raw.players : [],
        teams: Array.isArray(raw.teams) ? raw.teams : []
      };
    } catch {
      return { players: [], teams: [] };
    }
  }

  function saveFavorites(next) {
    try {
      window.localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify({
        players: next.players || [],
        teams: next.teams || []
      }));
    } catch { /* private mode */ }
  }

  function parseFavPlayerKey(raw) {
    const key = String(raw || '').trim();
    if (!key) return {};
    if (key.startsWith('nhl:')) return { nhlId: key.slice(4) };
    if (key.startsWith('espn:')) return { espnId: key.slice(5) };
    if (key.startsWith('name:')) return { name: key.slice(5) };
    return { key };
  }

  function favPlayerKey(ref = {}) {
    const nhlId = ref.nhlId != null && String(ref.nhlId).trim() ? String(ref.nhlId).trim() : '';
    if (nhlId) return `nhl:${nhlId}`;
    const espnId = ref.espnId != null && String(ref.espnId).trim() ? String(ref.espnId).trim() : '';
    if (espnId) return `espn:${espnId}`;
    const name = String(ref.name || '').trim().toLowerCase();
    return name ? `name:${name}` : '';
  }

  function favPlayerKeys(ref = {}) {
    const keys = [];
    const nhlId = ref.nhlId != null && String(ref.nhlId).trim() ? String(ref.nhlId).trim() : '';
    const espnId = ref.espnId != null && String(ref.espnId).trim() ? String(ref.espnId).trim() : '';
    if (nhlId) keys.push(`nhl:${nhlId}`);
    if (espnId) keys.push(`espn:${espnId}`);
    const name = String(ref.name || '').trim().toLowerCase();
    if (name) keys.push(`name:${name}`);
    // Accept Settings × canonical key / stored key field.
    const raw = String(ref.key || ref.rawKey || '').trim();
    if (raw) {
      keys.push(raw);
      const parsed = parseFavPlayerKey(raw);
      for (const k of favPlayerKeys({ ...parsed, key: '', rawKey: '' })) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
    return keys;
  }

  function normalizePlayerName(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\b[a-z]\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function playerNamesLooselyMatch(a, b) {
    const na = normalizePlayerName(a);
    const nb = normalizePlayerName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    const ta = na.split(' ').filter(Boolean);
    const tb = nb.split(' ').filter(Boolean);
    if (!ta.length || !tb.length) return false;
    // Same last name (Crosby / S. Crosby / Sidney Crosby).
    return ta[ta.length - 1] === tb[tb.length - 1] && ta[ta.length - 1].length > 2;
  }

  function favoritePlayerMatches(ref = {}, item = {}) {
    const want = new Set(favPlayerKeys(ref));
    if ([...want].some(key => favPlayerKeys(item).includes(key))) return true;
    const refAbbrev = String(ref.abbrev || '').toUpperCase();
    const itemAbbrev = String(item.abbrev || '').toUpperCase();
    if (refAbbrev && itemAbbrev && refAbbrev === itemAbbrev && playerNamesLooselyMatch(ref.name, item.name)) {
      return true;
    }
    if (!refAbbrev && playerNamesLooselyMatch(ref.name, item.name)) {
      // Name-only fallback when both sides lack team abbrev.
      const rn = normalizePlayerName(ref.name);
      const iname = normalizePlayerName(item.name);
      if (rn && rn === iname) return true;
    }
    return false;
  }

  function favoritePlayerIndex(ref = {}, players = []) {
    return players.findIndex(item => favoritePlayerMatches(ref, item));
  }

  function isFavoritePlayer(ref = {}) {
    return favoritePlayerIndex(ref, loadFavorites().players) >= 0;
  }

  function isFavoriteTeam(abbrev) {
    const key = String(abbrev || '').toUpperCase();
    if (!key) return false;
    return loadFavorites().teams.some(item => String(item.abbrev || '').toUpperCase() === key);
  }

  function playerFavRecord(ref = {}) {
    const nhlId = ref.nhlId != null && String(ref.nhlId).trim() ? String(ref.nhlId).trim() : '';
    const espnId = ref.espnId != null && String(ref.espnId).trim() ? String(ref.espnId).trim() : '';
    const name = String(ref.name || '').trim();
    const abbrev = String(ref.abbrev || '').trim().toUpperCase();
    const team = String(ref.team || '').trim();
    const rawKey = String(ref.key || ref.rawKey || '').trim();
    const parsed = parseFavPlayerKey(rawKey);
    const mergedNhl = nhlId || (parsed.nhlId ? String(parsed.nhlId).trim() : '');
    const mergedEspn = espnId || (parsed.espnId ? String(parsed.espnId).trim() : '');
    const mergedName = name || (parsed.name ? String(parsed.name).trim() : '');
    const key = favPlayerKey({ nhlId: mergedNhl, espnId: mergedEspn, name: mergedName }) || rawKey;
    return { key, rawKey, nhlId: mergedNhl, espnId: mergedEspn, name: mergedName, abbrev, team };
  }

  function toggleFavoritePlayer(ref = {}, { forceRemove = false } = {}) {
    const record = playerFavRecord(ref);
    if (!record.key && !record.name) return false;
    const fav = loadFavorites();
    const matched = fav.players.filter(item => favoritePlayerMatches(record, item));
    if (forceRemove || matched.length) {
      fav.players = fav.players.filter(item => !favoritePlayerMatches(record, item));
      saveFavorites(fav);
      return false;
    }
    fav.players.unshift(record);
    saveFavorites(fav);
    return true;
  }

  function toggleFavoriteTeam(ref = {}, { forceRemove = false } = {}) {
    const abbrev = String(ref.abbrev || '').toUpperCase();
    if (!abbrev) return false;
    const fav = loadFavorites();
    const idx = fav.teams.findIndex(item => String(item.abbrev || '').toUpperCase() === abbrev);
    if (forceRemove || idx >= 0) {
      fav.teams = fav.teams.filter(item => String(item.abbrev || '').toUpperCase() !== abbrev);
      saveFavorites(fav);
      return false;
    }
    fav.teams.unshift({
      abbrev,
      name: ref.name || abbrev,
      logo: ref.logo || ''
    });
    saveFavorites(fav);
    return true;
  }

  function removeFavoritePlayer(ref) {
    toggleFavoritePlayer(ref || {}, { forceRemove: true });
  }

  function removeFavoriteTeam(abbrev) {
    toggleFavoriteTeam({ abbrev }, { forceRemove: true });
  }

  function eventElement(event) {
    const t = event?.target;
    if (!t) return null;
    if (t.nodeType === 1) return t;
    return t.parentElement || null;
  }

  function favToggleMarkup(kind, on, attrs = '') {
    const label = on ? '★' : '☆';
    const title = kind === 'team'
      ? (on ? 'Убрать команду из избранного' : 'В избранные команды')
      : (on ? 'Убрать игрока из избранного' : 'В избранные игроки');
    return `<button type="button" class="fav-toggle${on ? ' is-on' : ''}" data-fav-kind="${kind}" ${attrs} aria-pressed="${on ? 'true' : 'false'}" title="${title}" aria-label="${title}">${label}</button>`;
  }

  function renderFavoritesSettings() {
    const teamsNode = document.getElementById('favTeamsList');
    const playersNode = document.getElementById('favPlayersList');
    if (!teamsNode || !playersNode) return;
    const fav = loadFavorites();
    if (!fav.teams.length) {
      teamsNode.innerHTML = `<div class="favorites-empty">Нет избранных команд — добавьте со страницы клуба.</div>`;
    } else {
      teamsNode.innerHTML = fav.teams.map(team => `
        <div class="settings-card">
          <button type="button" class="fav-open team-hit" data-team-abbrev="${escapeAttr(team.abbrev || '')}">
            <strong>${escapeHtml(team.name || team.abbrev || '')}</strong>
            <span>${escapeHtml(team.abbrev || '')}</span>
          </button>
          <button type="button" class="fav-remove" data-fav-remove-team="${escapeAttr(team.abbrev || '')}" aria-label="Удалить">×</button>
        </div>`).join('');
    }
    if (!fav.players.length) {
      playersNode.innerHTML = `<div class="favorites-empty">Нет избранных игроков — добавьте с карточки игрока.</div>`;
    } else {
      playersNode.innerHTML = fav.players.map(player => `
        <div class="settings-card">
          <button type="button" class="fav-open player-hit"
            data-nhl-id="${escapeAttr(player.nhlId || '')}"
            data-espn-id="${escapeAttr(player.espnId || '')}"
            data-player-name="${escapeAttr(player.name || '')}"
            data-team-abbrev="${escapeAttr(player.abbrev || '')}">
            <strong>${escapeHtml(player.name || '')}</strong>
            <span>${escapeHtml(player.team || player.abbrev || 'NHL')}</span>
          </button>
          <button type="button" class="fav-remove" data-fav-remove-player="${escapeAttr(player.key || favPlayerKey(player))}"
            data-nhl-id="${escapeAttr(player.nhlId || '')}"
            data-espn-id="${escapeAttr(player.espnId || '')}"
            data-player-name="${escapeAttr(player.name || '')}"
            data-team-abbrev="${escapeAttr(player.abbrev || '')}"
            aria-label="Удалить">×</button>
        </div>`).join('');
    }
  }

  const state = {
    selectedDate: live?.mskDateKey?.() || mock.defaultDate || '2026-09-29',
    games: [],
    gamesSource: 'mock',
    standings: mock.standings || { division: [], conference: [] },
    standingsNote: '',
    statsGroup: 'skaters',
    statsBoard: 'points',
    alltimeGroup: 'skaters',
    alltimeBoard: 'points',
    navStack: [],
    currentPanel: 'results',
    loading: false
  };

  bridge.applyTheme?.(bridge.theme || 'dark');

  function formatDate(dateKey) {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      weekday: 'short',
      timeZone: 'Europe/Moscow'
    }).format(new Date(`${dateKey}T12:00:00+03:00`));
  }

  function formatShortDate(isoOrKey) {
    if (!isoOrKey) return '';
    const date = isoOrKey.length <= 10
      ? new Date(`${isoOrKey}T12:00:00+03:00`)
      : new Date(isoOrKey);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Moscow'
    }).format(date);
  }

  function dateDistance(dateKey, referenceKey) {
    return Math.round(
      (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${referenceKey}T00:00:00Z`)) / 86400000
    );
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('visible');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => node.classList.remove('visible'), 1600);
  }

  function storedRussianHighlight() {
    try {
      return window.localStorage.getItem(russianHighlightStorageKey) === '1';
    } catch {
      return false;
    }
  }

  function applyRussianHighlight(enabled, persist = false) {
    const nextEnabled = Boolean(enabled);
    document.documentElement.dataset.ruHighlight = nextEnabled ? 'on' : 'off';
    document.body.dataset.ruHighlight = nextEnabled ? 'on' : 'off';
    const toggle = $('#ruHighlightToggle');
    if (toggle) toggle.checked = nextEnabled;
    if (persist) {
      try { window.localStorage.setItem(russianHighlightStorageKey, nextEnabled ? '1' : '0'); } catch { /* private mode */ }
    }
  }

  function storedTheme() {
    try {
      const value = window.localStorage.getItem(themeStorageKey);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  function applyTheme(theme, persist = false) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
    bridge.applyTheme?.(nextTheme);
    const toggle = $('#themeToggle');
    const label = $('#themeModeLabel');
    if (toggle) toggle.checked = nextTheme === 'dark';
    if (label) label.textContent = nextTheme === 'dark' ? 'Включена' : 'Выключена';
    $('#themeColorMeta')?.setAttribute('content', nextTheme === 'dark' ? '#0c111b' : '#f5f7fb');
    if (persist) {
      try { window.localStorage.setItem(themeStorageKey, nextTheme); } catch { /* private mode */ }
    }
  }

  applyRussianHighlight(storedRussianHighlight());
  applyTheme(storedTheme() || bridge.theme || 'dark');
  bridge.subscribeTheme?.(theme => { if (!storedTheme()) applyTheme(theme); });

  function mockGamesFor(dateKey) {
    return (mock.gamesByDate && mock.gamesByDate[dateKey]) || [];
  }

  function renderDayNavigation() {
    const today = live?.mskDateKey?.() || new Date().toISOString().slice(0, 10);
    const distance = dateDistance(state.selectedDate, today);
    $('#dayLabel').textContent = distance === 0 ? 'Сегодня' : distance === -1 ? 'Вчера' : distance === 1 ? 'Завтра' : 'Выбранный день';
    $('#dateLabel').textContent = formatDate(state.selectedDate);
    $('#prevDay').disabled = false;
    $('#nextDay').disabled = false;
  }

  function statusLabel(status, preseason) {
    if (preseason && status === 'FUT') return 'Предсезон';
    return { Final: 'Завершён', Live: 'LIVE', FUT: 'Запланирован', Preseason: 'Предсезон' }[status] || status;
  }

  function teamMarkup(team, side) {
    // Results row: teams are display-only. Card tap always opens match detail;
    // team pages open only from logo/name inside match detail (.match-card).
    const fav = isFavoriteTeam(team.short) ? ' is-favorite' : '';
    return `<div class="team ${side}${fav}">
      <div class="team-info"><span class="team-name">${team.name}</span><span class="team-nick">${team.nick}</span></div>
      <img class="logo" src="${team.logo}" alt="" onerror="this.style.display='none'">
    </div>`;
  }

  function detailTeamMarkup(team, side) {
    const abbrev = escapeAttr(team.short || '');
    const fav = isFavoriteTeam(team.short) ? ' is-favorite' : '';
    return `<button type="button" class="detail-team ${side} team-hit${fav}" data-team-abbrev="${abbrev}" aria-label="Команда ${escapeAttr(team.name)}">
      <img class="detail-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">
      <span class="detail-team-copy"><strong>${team.name}</strong><span class="detail-team-nick">${team.nick}</span></span>
    </button>`;
  }

  function renderGames() {
    const games = state.games || [];
    if (!games.length) {
      $('#gamesList').innerHTML = `<div class="empty-state"><strong>Нет игр</strong><span>На ${formatDate(state.selectedDate)} матчей в расписании NHL нет.</span></div>`;
      $('#gameCount').textContent = '0 игр';
      return;
    }
    $('#gamesList').innerHTML = games.map(game => {
      const isFuture = game.status === 'FUT' || game.status === 'Preseason';
      const score = isFuture
        ? `<span class="score time">${game.time}</span>`
        : `<span class="score">${game.away.score ?? 0}<span class="score-divider">:</span>${game.home.score ?? 0}</span>`;
      const statusClass = game.status === 'Live' ? 'live' : game.preseason ? 'preseason' : isFuture ? 'future' : 'final';
      return `<article class="game-card" data-game-id="${game.id}" tabindex="0" role="button" aria-label="Открыть матч ${game.away.name} — ${game.home.name}">
        <div class="game-meta"><span>${game.time}</span><span class="status ${statusClass}">${statusLabel(game.status, game.preseason)}</span></div>
        <div class="game-body">${teamMarkup(game.away, 'away')}<div class="game-score">${score}${game.period ? `<div class="period">${game.period}</div>` : ''}</div>${teamMarkup(game.home, 'home')}</div>
        <div class="game-open-label">Подробности <span>›</span></div>
      </article>`;
    }).join('');
    const pre = games.filter(game => game.preseason).length;
    const label = pre === games.length ? 'предсезон' : pre ? `предсезон · ${pre}` : 'регулярный сезон';
    $('#gameCount').textContent = `${games.length} игр`;
    const seasonHint = $('#seasonHint');
    if (seasonHint) seasonHint.textContent = label;
    const sourceHint = $('#dataSourceHint');
    if (sourceHint) sourceHint.textContent = state.gamesSource === 'mock' ? 'демо' : state.gamesSource.toUpperCase();
  }

  function standingsTuple(team) {
    if (Array.isArray(team)) return team;
    return [team.name, team.abbrev || team.short || '', team.wins || 0, team.losses || 0, team.ot || 0, team.points || 0];
  }

  function renderStandings(type = 'division') {
    const groups = (state.standings && state.standings[type]) || [];
    if (!groups.length) {
      $('#standingsList').innerHTML = `<div class="empty-state"><strong>Таблица недоступна</strong><span>Не удалось загрузить турнирную таблицу.</span></div>`;
      return;
    }
    $('#standingsList').innerHTML = groups.map(group => `<div class="division-block">
      <div class="division-title"><span>${group.title}</span><span>${group.code || ''}</span></div>
      <div class="standing-head"><span>#</span><span>Команда</span><span>И</span><span>О</span></div>
      ${group.teams.map((team, index) => {
        const row = standingsTuple(team);
        const gamesPlayed = Number(row[2]) + Number(row[3]) + Number(row[4]);
        const abbrev = escapeAttr(row[1] || '');
        const favCls = isFavoriteTeam(row[1]) ? ' is-favorite' : '';
        return `<button type="button" class="standing-row team-hit${favCls}" data-team-abbrev="${abbrev}">
          <span class="rank">${index + 1}</span><strong>${row[0]} <small>${row[1]}</small></strong><em>${gamesPlayed}</em><em>${row[5]}</em>
        </button>`;
      }).join('')}
    </div>`).join('');
    const note = $('#standingsNote');
    if (note) note.textContent = state.standingsNote || '';
  }

  function renderStatsTabs() {
    const groupTabs = $('#statsGroupTabs');
    const boardTabs = $('#statsBoardTabs');
    if (!groupTabs || !boardTabs || !live) return;
    const groups = [
      { id: 'skaters', label: 'Скейттеры' },
      { id: 'rookies', label: 'Новички' },
      { id: 'goalies', label: 'Вратари' }
    ];
    groupTabs.innerHTML = groups.map(group =>
      `<button class="segment ${state.statsGroup === group.id ? 'is-selected' : ''}" data-stats-group="${group.id}">${group.label}</button>`
    ).join('');
    const boards = state.statsGroup === 'goalies' ? live.GOALIE_BOARDS : live.SKATER_BOARDS;
    if (!boards.some(board => board.id === state.statsBoard)) {
      state.statsBoard = boards[0].id;
    }
    boardTabs.innerHTML = boards.map(board =>
      `<button class="segment ${state.statsBoard === board.id ? 'is-selected' : ''}" data-stats-board="${board.id}">${board.label}</button>`
    ).join('');
  }

  function leaderCardMarkup(player, index, boardId, goalie = false) {
    const initials = (player.name || '?').split(' ').map(part => part[0]).join('').slice(0, 2);
    const favCls = isFavoritePlayer(player) ? ' is-favorite' : '';
    return `<button type="button" class="leader-card${goalie ? ' goalie-card' : ''} player-hit${favCls}"
      data-nhl-id="${escapeAttr(player.nhlId || '')}"
      data-espn-id="${escapeAttr(player.espnId || player.athleteId || '')}"
      data-player-name="${escapeAttr(player.name || '')}"
      data-team-abbrev="${escapeAttr(player.abbrev || '')}">
      <span class="player-rank">${String(index + 1).padStart(2, '0')}</span>
      <div class="player-avatar${goalie ? ' goalie-avatar' : ''}">${initials}</div>
      <div class="player-copy"><strong>${playerMarkup(player)}</strong><span>${player.team || 'NHL'} · ${goalie ? 'G' : (player.position || 'SK')}</span></div>
      <div class="player-stat"><strong>${player.value ?? '—'}</strong><span>${boardId}</span></div>
    </button>`;
  }

  function renderStats(players = [], note = '') {
    const list = $('#statsList');
    if (!players.length) {
      list.innerHTML = `<div class="empty-state"><strong>Нет данных</strong><span>Лидеры по этой категории пока недоступны.</span></div>`;
      return;
    }
    list.innerHTML = players.map((player, index) =>
      leaderCardMarkup(player, index, state.statsBoard, state.statsGroup === 'goalies')
    ).join('');
    const noteNode = $('#statsNote');
    if (noteNode) noteNode.textContent = note || '';
  }

  function highlightButtonMarkup(event) {
    const highlight = event?.highlight;
    if (!highlight?.url) return '';
    const embed = highlight.embed ? '1' : '0';
    const safeUrl = escapeAttr(highlight.url);
    return `<button type="button" class="goal-play" data-goal-video="${safeUrl}" data-goal-embed="${embed}" aria-label="Смотреть гол" title="Смотреть гол">▶</button>`;
  }

  function periodHeadingText(period) {
    return live?.periodHeadingLabel?.(period) || period || '—';
  }

  function starRankLabel(star) {
    const n = Number(star) || 0;
    if (n === 1) return '1ST';
    if (n === 2) return '2ND';
    if (n === 3) return '3RD';
    if (n <= 0) return '';
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}TH`;
    const ones = n % 10;
    return `${n}${ones === 1 ? 'ST' : ones === 2 ? 'ND' : ones === 3 ? 'RD' : 'TH'}`;
  }

  function goalOrdinalLabel(n) {
    const num = Number(n) || 1;
    const v = num % 100;
    let suf = 'th';
    if (v < 11 || v > 13) {
      const ones = num % 10;
      if (ones === 1) suf = 'st';
      else if (ones === 2) suf = 'nd';
      else if (ones === 3) suf = 'rd';
    }
    return `${num}${suf} Goal`;
  }

  function teamAccent(abbrev) {
    return live?.teamColorFor?.(abbrev) || '#2a3d55';
  }

  function playerMugMarkup(player = {}, { size = 'md' } = {}) {
    const abbrev = String(player.abbrev || player.team || '').toUpperCase();
    const logo = live?.logoFor?.(abbrev) || '';
    const color = teamAccent(abbrev);
    const headshot = player.headshot || '';
    const initials = escapeHtml((player.name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase());
    const img = headshot
      ? `<img class="player-mug-photo" src="${escapeAttr(headshot)}" alt="" loading="lazy" onerror="this.remove()">`
      : `<span class="player-mug-initials">${initials}</span>`;
    const badge = logo
      ? `<img class="player-mug-logo" src="${escapeAttr(logo)}" alt="" loading="lazy">`
      : '';
    return `<div class="player-mug player-mug-${size}" style="--mug-color:${escapeAttr(color)}">${img}${badge}</div>`;
  }

  function goalAssistLineMarkup(event) {
    const assists = event.assists || [];
    const names = assists.map(a => (typeof a === 'string' ? a : (a.shortName || a.name || ''))).filter(Boolean);
    const sh = /^(sh|shg|short)/i.test(String(event.strength || ''));
    if (!names.length) {
      return sh ? 'Short-handed goal unassisted' : 'Unassisted';
    }
    const linked = assists.map(assist => {
      const ref = typeof assist === 'string'
        ? { name: assist, abbrev: event.team }
        : {
            name: assist.shortName || assist.name,
            isRussian: assist.isRussian,
            nhlId: assist.nhlId,
            espnId: assist.espnId,
            abbrev: event.team
          };
      return playerMarkup(ref, ref.name, { abbrev: event.team });
    });
    const by = linked.length === 1 ? linked[0] : `${linked[0]} and ${linked[1]}`;
    return `Assisted by ${by}`;
  }

  function goalsCardsMarkup(events, game) {
    if (!events?.length) return `<p class="empty-detail">Пока без голов</p>`;
    const groups = live?.groupByPeriod?.(events) || [{ period: '—', events }];
    const gameGoalCount = new Map();
    return groups.map(group => {
      const cards = group.events.map(event => {
        const key = String(event.scorerId || event.scorer || '');
        const nth = (gameGoalCount.get(key) || 0) + 1;
        gameGoalCount.set(key, nth);
        const short = event.scorerShort || event.scorer || '';
        const ytd = event.goalsToDate != null ? Number(event.goalsToDate) : null;
        const ytdSuffix = ytd != null && ytd > 1 ? ` <span class="goal-ytd">(${ytd})</span>` : '';
        const scorerRef = {
          name: short || event.scorer || '',
          isRussian: event.scorerRussian,
          nhlId: event.scorerEspn ? null : event.scorerId,
          espnId: event.scorerEspn ? event.scorerId : null,
          abbrev: event.team,
          headshot: event.headshot || ''
        };
        return `<article class="goal-card">
          <div class="goal-card-top">
            ${playerMugMarkup({ ...scorerRef, team: event.team, name: event.scorer || short })}
            <div class="goal-card-copy">
              <div class="goal-card-name">${playerMarkup(scorerRef)}${ytdSuffix}${highlightButtonMarkup(event)}</div>
              <div class="goal-card-nth">${goalOrdinalLabel(nth)}</div>
            </div>
          </div>
          <div class="goal-card-bottom">
            <span class="goal-card-assists">${goalAssistLineMarkup(event)}</span>
            <span class="goal-card-time">${escapeHtml(event.time || '')}</span>
          </div>
          <div class="goal-video-slot" hidden></div>
        </article>`;
      }).join('');
      return `<div class="period-block goal-period-block"><div class="period-heading goal-period-heading">${periodHeadingText(group.period)}</div><div class="goal-cards period-events">${cards}</div></div>`;
    }).join('');
  }

  function threeStarsMarkup(stars = [], game = null) {
    if (!stars?.length) return '';
    const rows = stars.map(star => {
      const rank = starRankLabel(star.star);
      const ref = {
        name: star.name,
        isRussian: star.isRussian,
        nhlId: star.nhlId,
        espnId: star.espnId,
        abbrev: star.team,
        headshot: star.headshot
      };
      const plus = star.plusMinus == null || star.plusMinus === '' ? '—' : star.plusMinus;
      const statsPairs = star.isGoalie
        ? [
            ...(Number(star.goals) > 0 ? [['G', star.goals]] : []),
            ['SV', star.saves != null && star.saves !== '' ? star.saves : '—'],
            ['GA', star.goalsAgainst != null && star.goalsAgainst !== '' ? star.goalsAgainst : '—'],
            ['SV%', star.sv || '—'],
            ['TOI', star.toi || '—']
          ]
        : [
            ['G', star.goals ?? 0],
            ['A', star.assists ?? 0],
            ['PIM', star.pim ?? 0],
            ['+/-', plus],
            ['TOI', star.toi || '—']
          ];
      const stats = statsPairs
        .map(([label, value]) => `<div class="three-star-stat"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('');
      return `<div class="three-star-row">
        <div class="three-star-rank"><span>${rank}</span><span class="three-star-icon" aria-hidden="true">★</span></div>
        ${playerMugMarkup({ ...ref, team: star.team }, { size: 'lg' })}
        <div class="three-star-copy">
          <div class="three-star-name">${playerMarkup(ref)}</div>
          <div class="three-star-stats">${stats}</div>
        </div>
      </div>`;
    }).join('');
    return `<section class="detail-section three-stars-section"><div class="detail-section-title"><h3>Три звезды</h3><span>${stars.length}</span></div><div class="three-stars-list">${rows}</div></section>`;
  }

  function periodGroupsMarkup(events, kind, teamAbbrevHint = '') {
    const groups = live?.groupByPeriod?.(events) || [{ period: '—', events: events || [] }];
    if (!events?.length) {
      return `<p class="empty-detail">${kind === 'goals' ? 'Пока без голов' : 'Нет удалений'}</p>`;
    }
    return groups.map(group => {
      const rows = kind === 'goals'
        ? group.events.map(event => {
            const scorerRef = {
              name: event.scorer,
              isRussian: event.scorerRussian,
              nhlId: event.scorerEspn ? null : event.scorerId,
              espnId: event.scorerEspn ? event.scorerId : null,
              abbrev: event.team || teamAbbrevHint
            };
            return `<div class="scoring-row"><span class="event-time"><strong>${event.time || ''}</strong></span><span class="event-team">${event.team || ''}</span><div class="scoring-copy"><div class="scoring-main"><strong>${playerMarkup(scorerRef)}</strong>${highlightButtonMarkup(event)}</div><small>${event.assists?.length ? `ассисты: ${assistsMarkup(event.assists, event.team)}` : 'без ассистов'}${event.strength ? ` · ${event.strength}` : ''}</small><div class="goal-video-slot" hidden></div></div></div>`;
          }).join('')
        : group.events.map(item => `<div class="penalty-row"><span>${item.time || ''}</span><strong>${item.team} · ${playerMarkup({ name: item.player || '', isRussian: item.playerRussian, nhlId: item.nhlId, espnId: item.espnId, abbrev: item.team })}</strong><small>${item.minutes ? `${item.minutes} мин · ` : ''}${item.infraction || ''}</small></div>`).join('');
      return `<div class="period-block"><div class="period-heading">${periodHeadingText(group.period)}</div><div class="${kind === 'goals' ? 'scoring-list' : 'penalty-list'} period-events">${rows}</div></div>`;
    }).join('');
  }

  function recapMarkup(recap) {
    if (!recap?.url) return '';
    const safe = escapeAttr(recap.url);
    if (recap.embed) {
      return `<section class="detail-section"><div class="detail-section-title"><h3>Обзор матча</h3><span>${recap.source || 'video'}</span></div>
        <div class="recap-frame"><video class="recap-video" controls playsinline preload="metadata" poster="" src="${safe}"></video>
        <p class="recap-caption">${escapeAttr(recap.title || 'Game Highlights')}</p></div></section>`;
    }
    return `<section class="detail-section"><div class="detail-section-title"><h3>Обзор матча</h3><span>${recap.source || 'link'}</span></div>
      <button type="button" class="recap-link" data-open-url="${safe}">▶ ${escapeAttr(recap.title || 'Смотреть обзор')}</button></section>`;
  }

  function showPanel(name, { push = false } = {}) {
    if (push && state.currentPanel && state.currentPanel !== name) {
      state.navStack.push(state.currentPanel);
    }
    if (!DETAIL_PANELS.has(name)) {
      state.navStack = [];
    }
    state.currentPanel = name;
    $$('.panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.panel === name));
    $$('.nav-item').forEach(button => {
      const active = button.dataset.nav === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $('.app-shell').classList.toggle('is-detail', DETAIL_PANELS.has(name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    closeGoalVideos();
    const prev = state.navStack.pop() || 'results';
    state.currentPanel = prev;
    $$('.panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.panel === prev));
    $$('.nav-item').forEach(button => {
      const active = button.dataset.nav === prev;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $('.app-shell').classList.toggle('is-detail', DETAIL_PANELS.has(prev));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  function readDeepLinkMatchId() {
    const strip = raw => {
      const text = String(raw || '').trim();
      if (!text) return null;
      const m = text.match(/(?:^|\b)(?:match[_=-]?)?(\d{6,14})\b/i);
      return m ? m[1] : null;
    };
    try {
      const query = new URLSearchParams(location.search || '');
      const fromQuery = strip(query.get('match') || query.get('game') || query.get('startapp'));
      if (fromQuery) return fromQuery;
    } catch { /* ignore */ }
    try {
      const hashRaw = (location.hash || '').replace(/^#/, '');
      if (hashRaw) {
        if (hashRaw.includes('=')) {
          const hp = new URLSearchParams(hashRaw);
          const fromHash = strip(hp.get('match') || hp.get('game') || hp.get('startapp'));
          if (fromHash) return fromHash;
        }
        const fromBare = strip(hashRaw);
        if (fromBare) return fromBare;
      }
    } catch { /* ignore */ }
    try {
      const start =
        window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
        window.WebApp?.initDataUnsafe?.start_param ||
        window.WebApp?.initDataUnsafe?.payload ||
        '';
      const fromStart = strip(start);
      if (fromStart) return fromStart;
    } catch { /* ignore */ }
    return null;
  }

  async function openGameDetail(gameId, { silent = false } = {}) {
    let game = state.games.find(item => String(item.id) === String(gameId));
    if (!game && live?.gameStubFromId) {
      try {
        game = await live.gameStubFromId(gameId);
        if (game) {
          // Keep deep-linked match available for back-navigation / re-open.
          if (!state.games.some(item => String(item.id) === String(game.id))) {
            state.games = [game, ...state.games];
          }
        }
      } catch (error) {
        console.warn(error);
      }
    }
    if (!game) {
      if (silent) {
        console.warn('[NHL Diggest] match not found (silent)', gameId);
      } else {
        toast('Матч не найден');
      }
      return;
    }
    showPanel('game-detail', { push: true });
    $('#gameDetailContent').innerHTML = `<div class="detail-notice"><strong>Загрузка матча…</strong><span>${game.away.name} — ${game.home.name}</span></div>`;
    let detail = null;
    if (live) {
      try { detail = await live.gameDetail(game); } catch (error) { console.warn(error); }
    }
    if (!detail && mock.gameDetails && mock.gameDetails[String(game.id)]) {
      detail = mock.gameDetails[String(game.id)];
    }
    const isScheduled = game.status === 'FUT' || game.status === 'Preseason';
    const score = isScheduled ? '—' : `${game.away.score ?? 0} : ${game.home.score ?? 0}`;
    const scoring = detail?.scoring || [];
    const penalties = detail?.penalties || [];
    const boxscore = detail?.boxscore || {};
    const goalies = detail?.goalies || [];
    const skaters = detail?.skaters || [];
    const teamByShort = { [game.away.short]: game.away, [game.home.short]: game.home };

    const threeStars = detail?.threeStars || [];
    const overviewBody = `
          ${recapMarkup(detail?.recap)}
          ${threeStarsMarkup(threeStars, game)}
          <section class="detail-section goals-section"><div class="detail-section-title"><h3>Голы</h3><span>${scoring.length}</span></div>
            <div class="period-groups goal-period-groups">${goalsCardsMarkup(scoring, game)}</div>
          </section>
          <section class="detail-section"><div class="detail-section-title"><h3>Командная статистика</h3></div>
            <div class="boxscore-table"><div class="boxscore-head"><span>Команда</span><span>Броски</span><span>Силовые</span><span>Вбрасывания</span><span>Большинство</span></div>${[game.away, game.home].map(team => { const stats = boxscore[team.short] || {}; return `<div class="boxscore-row"><strong><img src="${team.logo}" alt="">${team.short}</strong><span>${stats.shots ?? '—'}</span><span>${stats.hits ?? '—'}</span><span>${stats.faceoff ?? '—'}</span><span>${stats.powerPlay ?? '—'}</span></div>`; }).join('')}</div>
          </section>
          <details class="detail-section penalties-accordion"><summary>Удаления (${penalties.length})</summary><div class="period-groups">${periodGroupsMarkup(penalties, 'penalties')}</div></details>
          ${goalies.length ? `<section class="detail-section"><div class="detail-section-title"><h3>Вратари</h3></div><div class="goalie-lines">${goalies.map(goalie => `<div class="goalie-line"><span class="line-team">${teamByShort[goalie.team]?.short || goalie.team}</span><strong>${playerMarkup({ ...goalie, abbrev: goalie.team })}</strong><span>${goalie.saves}${goalie.sv ? ` · SV% ${goalie.sv}` : ''}${goalie.toi ? ` · ${goalie.toi}` : ''}</span></div>`).join('')}</div></section>` : ''}`;
    const cardBody = isScheduled
      ? `<div class="match-card-body"><div class="detail-notice"><strong>Матч ещё не начался</strong><span>Подробная статистика появится после стартового вбрасывания.</span></div></div>`
      : `<div class="match-card-tabs" role="tablist" aria-label="Разделы матча">
          <button type="button" class="match-tab is-selected" data-game-tab="overview" role="tab" aria-selected="true" id="matchTabOverview">Обзор</button>
          <button type="button" class="match-tab" data-game-tab="stats" role="tab" aria-selected="false" id="matchTabStats">Статистика</button>
        </div>
        <div class="match-card-body">
          <div class="game-tab-panel" data-game-tab-panel="overview" role="tabpanel" aria-labelledby="matchTabOverview">
            ${overviewBody}
          </div>
          <div class="game-tab-panel" data-game-tab-panel="stats" role="tabpanel" aria-labelledby="matchTabStats" hidden>
            ${playerBoxscoreMarkup(game, skaters, goalies)}
          </div>
        </div>`;
    const remindControl = remindButtonMarkup(game, { labelOff: '🔔 Напомнить', labelOn: '🔔 Вкл' });
    $('#gameDetailContent').innerHTML = `
      <article class="match-card">
        <div class="detail-hero">
          <div class="detail-status-row">
            <div class="detail-status status ${game.status === 'Live' ? 'live' : isScheduled ? (game.preseason ? 'preseason' : 'future') : 'final'}">${statusLabel(game.status, game.preseason)}</div>
            ${remindControl}
          </div>
          <div class="detail-scoreboard">${detailTeamMarkup(game.away, 'away')}<div class="detail-score"><strong>${score}</strong><span>${isScheduled ? game.time : game.period || ''}</span></div>${detailTeamMarkup(game.home, 'home')}</div>
          <div class="detail-venue">${detail?.venue || game.venue || 'NHL Arena'}${detail?.attendance ? ` · ${detail.attendance} зрителей` : ''}</div>
        </div>
        ${cardBody}
      </article>`;
  }

  function boxStatCell(value) {
    if (value == null || value === '') return '—';
    return escapeHtml(value);
  }

  function skaterStatsTableMarkup(players) {
    if (!players.length) return `<p class="empty-detail">Нет статистики скейтеров</p>`;
    const cols = [
      { key: 'number', label: '#', cls: 'col-num' },
      { key: 'name', label: 'Игрок', cls: 'col-name' },
      { key: 'goals', label: 'G' },
      { key: 'assists', label: 'A' },
      { key: 'points', label: 'P' },
      { key: 'plusMinus', label: '+/−' },
      { key: 'sog', label: 'SOG' },
      { key: 'pim', label: 'PIM' },
      { key: 'hits', label: 'HIT' },
      { key: 'blocks', label: 'BLK' },
      { key: 'faceoffPct', label: 'FO%' },
      { key: 'toi', label: 'TOI', cls: 'col-toi' }
    ].filter(col => col.key === 'name' || col.key === 'number'
      || players.some(row => row[col.key] !== '' && row[col.key] != null));
    const template = cols.map(col => {
      if (col.key === 'name') return 'minmax(96px, 1.6fr)';
      if (col.key === 'number') return '28px';
      if (col.key === 'toi') return 'minmax(44px, 0.7fr)';
      if (col.key === 'faceoffPct') return 'minmax(40px, 0.65fr)';
      return 'minmax(32px, 0.55fr)';
    }).join(' ');
    const head = cols.map(col => `<span class="${col.cls || ''}">${col.label}</span>`).join('');
    const body = players.map(player => {
      const cells = cols.map(col => {
        if (col.key === 'name') {
          return `<span class="col-name">${playerMarkup({ ...player, abbrev: player.team })}</span>`;
        }
        if (col.key === 'number') {
          return `<span class="col-num">${boxStatCell(player.number)}</span>`;
        }
        return `<span class="${col.cls || ''}">${boxStatCell(player[col.key])}</span>`;
      }).join('');
      return `<div class="player-box-row">${cells}</div>`;
    }).join('');
    return `<div class="player-box-scroll"><div class="player-box-table" style="--player-box-cols:${template}"><div class="player-box-head">${head}</div>${body}</div></div>`;
  }

  function goalieStatsTableMarkup(goalies) {
    if (!goalies.length) return '';
    const cols = [
      { key: 'number', label: '#', cls: 'col-num' },
      { key: 'name', label: 'Игрок', cls: 'col-name' },
      { key: 'goalsAgainst', label: 'GA' },
      { key: 'saves', label: 'SV' },
      { key: 'sv', label: 'SV%' },
      { key: 'toi', label: 'TOI', cls: 'col-toi' },
      { key: 'decision', label: 'DEC' }
    ].filter(col => col.key === 'name' || col.key === 'number'
      || goalies.some(row => row[col.key] !== '' && row[col.key] != null));
    const template = cols.map(col => {
      if (col.key === 'name') return 'minmax(96px, 1.6fr)';
      if (col.key === 'number') return '28px';
      if (col.key === 'saves') return 'minmax(48px, 0.8fr)';
      if (col.key === 'toi') return 'minmax(44px, 0.7fr)';
      return 'minmax(34px, 0.55fr)';
    }).join(' ');
    const head = cols.map(col => `<span class="${col.cls || ''}">${col.label}</span>`).join('');
    const body = goalies.map(goalie => {
      const cells = cols.map(col => {
        if (col.key === 'name') {
          return `<span class="col-name">${playerMarkup({ ...goalie, abbrev: goalie.team })}</span>`;
        }
        if (col.key === 'number') {
          return `<span class="col-num">${boxStatCell(goalie.number)}</span>`;
        }
        return `<span class="${col.cls || ''}">${boxStatCell(goalie[col.key])}</span>`;
      }).join('');
      return `<div class="player-box-row">${cells}</div>`;
    }).join('');
    return `<div class="detail-section-title"><h3>Вратари</h3><span>${goalies.length}</span></div>
      <div class="player-box-scroll"><div class="player-box-table goalie-box-table" style="--player-box-cols:${template}"><div class="player-box-head">${head}</div>${body}</div></div>`;
  }

  function playerBoxscoreMarkup(game, skaters = [], goalies = []) {
    if (!skaters.length && !goalies.length) {
      return `<div class="detail-notice"><strong>Статистика игроков недоступна</strong><span>Боксскор для этого матча пока не пришёл из NHL/ESPN.</span></div>`;
    }
    const sides = [
      { team: game.away, key: game.away.short },
      { team: game.home, key: game.home.short }
    ];
    const tabs = sides.map((side, index) =>
      `<button type="button" class="segment${index === 0 ? ' is-selected' : ''}" data-box-team="${escapeAttr(side.key)}" aria-selected="${index === 0 ? 'true' : 'false'}">${escapeHtml(side.key)}</button>`
    ).join('');
    const panels = sides.map((side, index) => {
      const teamSkaters = skaters.filter(row => row.team === side.key);
      const teamGoalies = goalies.filter(row => row.team === side.key);
      return `<div class="box-team-panel" data-box-team-panel="${escapeAttr(side.key)}"${index === 0 ? '' : ' hidden'}>
        <section class="detail-section">
          <div class="detail-section-title"><h3>Скейтеры · ${escapeHtml(side.key)}</h3><span>${teamSkaters.length}</span></div>
          ${skaterStatsTableMarkup(teamSkaters)}
        </section>
        ${teamGoalies.length ? `<section class="detail-section">${goalieStatsTableMarkup(teamGoalies)}</section>` : ''}
      </div>`;
    }).join('');
    return `<div class="segmented box-team-tabs" role="tablist">${tabs}</div>${panels}`;
  }

  function rosterGroupMarkup(roster) {
    const groups = [
      { title: 'Нападающие', test: p => /^(C|L|R|LW|RW|F)$/i.test(p.position) },
      { title: 'Защитники', test: p => /^D$/i.test(p.position) },
      { title: 'Вратари', test: p => /^G$/i.test(p.position) }
    ];
    const used = new Set();
    const blocks = groups.map(group => {
      const players = roster.filter(p => group.test(p) && !used.has(p));
      players.forEach(p => used.add(p));
      if (!players.length) return '';
      return `<div class="roster-group"><div class="roster-heading">${group.title}<span>${players.length}</span></div>
        ${players.map(player => `<button type="button" class="roster-row player-hit${isFavoritePlayer(player) ? ' is-favorite' : ''}"
          data-nhl-id="${escapeAttr(player.nhlId || '')}"
          data-espn-id="${escapeAttr(player.espnId || '')}"
          data-player-name="${escapeAttr(player.name || '')}"
          data-team-abbrev="${escapeAttr(player.abbrev || '')}">
          <span class="roster-num">${player.number || '—'}</span>
          <div class="roster-copy"><strong>${playerMarkup(player)}</strong><span>${player.position || ''}${player.shoots ? ` · ${player.shoots}` : ''}</span></div>
          <span class="chevron">›</span>
        </button>`).join('')}
      </div>`;
    }).join('');
    const rest = roster.filter(p => !used.has(p));
    const extra = rest.length ? `<div class="roster-group"><div class="roster-heading">Состав<span>${rest.length}</span></div>
      ${rest.map(player => `<button type="button" class="roster-row player-hit${isFavoritePlayer(player) ? ' is-favorite' : ''}"
        data-nhl-id="${escapeAttr(player.nhlId || '')}"
        data-espn-id="${escapeAttr(player.espnId || '')}"
        data-player-name="${escapeAttr(player.name || '')}"
        data-team-abbrev="${escapeAttr(player.abbrev || '')}">
        <span class="roster-num">${player.number || '—'}</span>
        <div class="roster-copy"><strong>${playerMarkup(player)}</strong><span>${player.position || ''}</span></div>
        <span class="chevron">›</span>
      </button>`).join('')}</div>` : '';
    return blocks + extra || `<p class="empty-detail">Состав недоступен</p>`;
  }

  const REMIND_STORAGE_KEY = 'nhl_diggest_reminders';

  function loadReminderMap() {
    try {
      const raw = window.localStorage.getItem(REMIND_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveReminderMap(map) {
    try { window.localStorage.setItem(REMIND_STORAGE_KEY, JSON.stringify(map || {})); } catch { /* private mode */ }
  }

  function isReminderOn(gameId) {
    const map = loadReminderMap();
    return Boolean(map[String(gameId)]);
  }

  function setReminderLocal(gameId, on, meta = {}) {
    const map = loadReminderMap();
    const key = String(gameId);
    if (on) map[key] = { on: true, startTimeUTC: meta.startTimeUTC || '', away: meta.away || '', home: meta.home || '', updatedAt: Date.now() };
    else delete map[key];
    saveReminderMap(map);
  }


  function donateDeepLink() {
    const bot = window.NHL_TG_BOT || 'nhldig_bot';
    return `https://t.me/${bot}?start=donate`;
  }

  function openDonateBot() {
    const url = donateDeepLink();
    const opened = bridge.openBotLink?.(url);
    if (!opened) openExternal(url);
  }

  function syncDonateSettingsVisibility() {
    const group = document.getElementById('tgDonateGroup');
    if (!group) return;
    // Stars tips are Telegram-only — never show on Max bridge.
    const show = Boolean(bridge.isTelegram);
    group.hidden = !show;
  }

  function compactStartUtcForBot(iso) {
    // Telegram start payloads allow only [A-Za-z0-9_-] (max 64). Encode UTC without colons.
    if (!iso) return '';
    const raw = String(iso).trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] || '00'}Z`;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }

  function remindDeepLink(gameId, enable, startTimeUTC) {
    let payload = `${enable ? 'remind' : 'unremind'}_${gameId}`;
    if (enable) {
      const compact = compactStartUtcForBot(startTimeUTC);
      if (compact) {
        const withStart = `${payload}_${compact}`;
        // Keep under Telegram's 64-char start payload limit.
        if (withStart.length <= 64) payload = withStart;
      }
    }
    if (bridge.isTelegram || (!bridge.isMax && !bridge.isBrowser)) {
      const bot = window.NHL_TG_BOT || 'nhldig_bot';
      return `https://t.me/${bot}?start=${encodeURIComponent(payload)}`;
    }
    if (bridge.isMax) {
      const bot = window.NHL_MAX_BOT || 'id463223580832_bot';
      return `https://max.ru/${bot}?start=${encodeURIComponent(payload)}`;
    }
    const bot = window.NHL_TG_BOT || 'nhldig_bot';
    return `https://t.me/${bot}?start=${encodeURIComponent(payload)}`;
  }

  function openRemindBot(gameId, enable, startTimeUTC) {
    const url = remindDeepLink(gameId, enable, startTimeUTC);
    const opened = bridge.openBotLink?.(url);
    if (!opened) openExternal(url);
  }

  function canRemindGame(game) {
    if (!game?.id) return false;
    // Any not-yet-started game (FUT / upcoming), including preseason.
    const status = String(game.status || '');
    return status !== 'Live' && status !== 'Final';
  }

  function remindButtonMarkup(game, { labelOff = '🔔', labelOn = '🔔 Вкл' } = {}) {
    if (!canRemindGame(game)) return '';
    const on = isReminderOn(game.id);
    return `<button type="button" class="remind-btn${on ? ' is-on' : ''}" data-remind-game="${escapeAttr(String(game.id))}" data-remind-on="${on ? '1' : '0'}" data-remind-start="${escapeAttr(game.startTimeUTC || '')}" data-remind-away="${escapeAttr(game.away?.short || '')}" data-remind-home="${escapeAttr(game.home?.short || '')}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? 'Отключить напоминание' : 'Напомнить о начале матча'}">${on ? labelOn : labelOff}</button>`;
  }

  function scheduleListMarkup(title, games, emptyText, { remindable = false } = {}) {
    if (!games?.length) return `<div class="detail-section"><div class="detail-section-title"><h3>${title}</h3></div><p class="empty-detail">${emptyText}</p></div>`;
    return `<div class="detail-section"><div class="detail-section-title"><h3>${title}</h3><span>${games.length}</span></div>
      <div class="team-schedule">${games.map(game => {
        const opp = game.opponent || {};
        const prefix = game.isHome ? 'vs' : '@';
        const remind = remindable ? remindButtonMarkup(game) : '';
        const showRemind = Boolean(remind);
        return `<div class="schedule-row${showRemind ? ' has-remind' : ''}">
          <span class="schedule-date">${formatShortDate(game.startTimeUTC || '')}</span>
          <div class="schedule-copy"><strong>${prefix} ${opp.short || opp.name || '—'}</strong><small>${statusLabel(game.status, game.preseason)}</small></div>
          <span class="schedule-result">${game.resultLabel || game.time || ''}</span>
          ${remind}
        </div>`;
      }).join('')}</div></div>`;
  }

  function statsGridMarkup(title, rows, note = '') {
    if (!rows?.length) return `<div class="detail-section"><div class="detail-section-title"><h3>${title}</h3></div><p class="empty-detail">Статистика недоступна</p></div>`;
    return `<div class="detail-section"><div class="detail-section-title"><h3>${title}</h3>${note ? `<span>${note}</span>` : ''}</div>
      <div class="stats-grid">${rows.map(row => `<div class="stat-chip"><strong>${row.value ?? '—'}</strong><span>${row.abbr || row.label}</span><small>${row.label || ''}</small></div>`).join('')}</div></div>`;
  }


  function careerHistoryMarkup(history, goalie = false) {
    const rows = history || [];
    const title = goalie ? 'Карьера по клубам · вратарь' : 'Карьера по клубам';
    if (!rows.length) {
      return `<section class="detail-section career-history-section"><div class="detail-section-title"><h3>${title}</h3></div><p class="empty-detail">История по клубам недоступна</p></section>`;
    }
    const header = goalie
      ? '<span>Клуб</span><span>GP</span><span>W-L-OTL</span><span>GAA</span><span>SV%</span><span>SO</span>'
      : '<span>Клуб</span><span>GP</span><span>G</span><span>A</span><span>PTS</span>';
    const body = rows.map(row => {
      const chips = (row.seasons || []).map(s => `<span class="season-chip">${escapeHtml(s)}</span>`).join('');
      const clubCell = `<div class="career-club-cell"><strong>${escapeHtml(row.club)}</strong>${chips ? `<div class="season-chips">${chips}</div>` : ''}</div>`;
      if (goalie) {
        return `<div class="career-history-row">${clubCell}<span>${row.gp ?? '—'}</span><span>${row.wins ?? 0}-${row.losses ?? 0}-${row.otLosses ?? 0}</span><span>${row.gaa ?? '—'}</span><span>${row.sv ?? '—'}</span><span>${row.shutouts ?? 0}</span></div>`;
      }
      return `<div class="career-history-row">${clubCell}<span>${row.gp ?? '—'}</span><span>${row.goals ?? 0}</span><span>${row.assists ?? 0}</span><span>${row.points ?? 0}</span></div>`;
    }).join('');
    return `<section class="detail-section career-history-section"><div class="detail-section-title"><h3>${title}</h3><span>регулярный сезон</span></div><div class="career-history-table${goalie ? ' goalie-history' : ''}"><div class="career-history-head">${header}</div>${body}</div></section>`;
  }

  function medalEmoji(medal) {
    if (medal === 'gold') return '🥇';
    if (medal === 'silver') return '🥈';
    if (medal === 'bronze') return '🥉';
    if (medal === 'appearance') return '🏒';
    return '';
  }

  function flagMarkup(flag) {
    if (!flag) return '';
    const label = escapeAttr(flag.label || flag.iso2 || '');
    // Prefer emoji; keep flagcdn <img> as fallback when emoji fonts are missing.
    if (flag.emoji && flag.img) {
      return `<span class="player-flag" title="${label}" aria-label="${label}"><span class="player-flag-emoji" aria-hidden="true">${flag.emoji}</span><img class="player-flag-img player-flag-img-fallback" src="${escapeAttr(flag.img)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
    }
    if (flag.emoji) {
      return `<span class="player-flag" title="${label}" aria-label="${label}"><span class="player-flag-emoji" aria-hidden="true">${flag.emoji}</span></span>`;
    }
    if (flag.img) {
      return `<span class="player-flag" title="${label}" aria-label="${label}"><img class="player-flag-img" src="${escapeAttr(flag.img)}" alt="${label}" loading="lazy" onerror="this.parentNode.remove()"></span>`;
    }
    return '';
  }

  function awardRowsMarkup(rows = []) {
    return (rows || []).map(award => {
      const seasons = (award.seasons || []).map(season => `<span class="award-year">${escapeHtml(season)}</span>`).join('');
      const medal = medalEmoji(award.medal);
      const medalBit = medal ? `<span class="trophy-medal" aria-hidden="true">${medal}</span>` : '';
      const sub = award.medalLabel ? `<span class="trophy-sub">${escapeHtml(award.medalLabel)}</span>` : '';
      const count = (award.seasons || []).length;
      return `<div class="award-row"><div class="award-copy"><strong>${medalBit}${escapeHtml(award.name)}${sub ? ` · ${sub}` : ''}</strong><div class="award-years">${seasons}</div></div><span class="award-count">${count > 1 ? `${count}×` : '✓'}</span></div>`;
    }).join('');
  }

  function awardsMarkup(awards = []) {
    const rows = awards || [];
    if (!rows.length) {
      return `<section class="detail-section player-awards-section"><div class="detail-section-title"><h3>Индивидуальные награды</h3></div><p class="empty-detail">Данные о наградах пока недоступны</p></section>`;
    }
    return `<section class="detail-section player-awards-section"><div class="detail-section-title"><h3>Индивидуальные награды</h3><span>${rows.length}</span></div><div class="awards-list">${awardRowsMarkup(rows)}</div></section>`;
  }

  function trophiesMarkup(trophies = {}) {
    const national = trophies?.national || [];
    const club = trophies?.club || [];
    const total = national.length + club.length;
    if (!total) {
      return `<section class="detail-section player-trophies-section"><div class="detail-section-title"><h3>Трофеи</h3></div><p class="empty-detail">Пока нет данных о трофеях сборной и клуба</p></section>`;
    }
    const groups = [];
    if (national.length) {
      groups.push(`<div class="trophy-group"><div class="trophy-group-title">Сборная<span>${national.length}</span></div><div class="awards-list">${awardRowsMarkup(national)}</div></div>`);
    }
    if (club.length) {
      groups.push(`<div class="trophy-group"><div class="trophy-group-title">Клубные<span>${club.length}</span></div><div class="awards-list">${awardRowsMarkup(club)}</div></div>`);
    }
    return `<section class="detail-section player-trophies-section"><div class="detail-section-title"><h3>Трофеи</h3><span>${total}</span></div><div class="trophy-groups">${groups.join('')}</div></section>`;
  }

  function contractMarkup(contract) {
    if (!contract || !(contract.capHit || contract.signed || contract.through)) return '';
    const rows = [
      ['Cap hit', contract.capHit],
      ['Подписан', contract.signed],
      ['До сезона', contract.through]
    ].filter(([, v]) => v);
    if (!rows.length) return '';
    const src = contract.source === 'puckpedia' ? '<span>PuckPedia</span>' : '';
    return `<section class="detail-section player-contract-section"><div class="detail-section-title"><h3>Контракт</h3>${src}</div>
      <div class="info-grid">${rows.map(([label, value]) => `<div class="info-row"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    </section>`;
  }

  function teamTrophiesMarkup(rows = []) {
    const list = rows || [];
    if (!list.length) return '';
    // Team cards show Stanley Cup only — badge = total championship years.
    const cups = list.reduce((n, row) => n + ((row.seasons || []).length), 0);
    const badge = cups || list.length;
    return `<section class="detail-section team-trophies-section"><div class="detail-section-title"><h3>Кубок Стэнли</h3><span>${badge}</span></div><div class="awards-list">${awardRowsMarkup(list)}</div></section>`;
  }

  function retiredNumbersMarkup(rows = []) {
    const list = rows || [];
    if (!list.length) return '';
    const items = list.map(row => {
      const num = escapeHtml(String(row.number ?? ''));
      const name = escapeHtml(row.name || '');
      return `<div class="retired-row"><span class="retired-number">#${num}</span><strong class="retired-name">${name}</strong></div>`;
    }).join('');
    return `<section class="detail-section team-retired-section"><div class="detail-section-title"><h3>Закреплённые номера</h3><span>${list.length}</span></div><div class="retired-list">${items}</div></section>`;
  }

  function teamSalaryCapMarkup(cap) {
    if (!cap || !(cap.capHit || cap.capSpace)) return '';
    const rows = [
      ['Cap hit команды', cap.capHit],
      ['Cap space', cap.capSpace],
      ['Потолок NHL', cap.ceiling]
    ].filter(([, v]) => v);
    if (!rows.length) return '';
    const src = cap.source === 'puckpedia' ? '<span>PuckPedia</span>' : '';
    return `<section class="detail-section team-cap-section"><div class="detail-section-title"><h3>Зарплатная капа</h3>${src}</div>
      <div class="info-grid">${rows.map(([label, value]) => `<div class="info-row"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    </section>`;
  }

  async function openTeamDetail(abbrev, seed = {}) {
    const key = String(abbrev || seed.short || '').toUpperCase();
    if (!key) return;
    showPanel('team-detail', { push: true });
    const content = $('#teamDetailContent');
    content.innerHTML = `<div class="detail-notice"><strong>Загрузка команды…</strong><span>${seed.name || key}</span></div>`;
    let team = null;
    try { team = await live?.loadTeam?.(key); } catch (error) { console.warn(error); }
    if (!team) {
      content.innerHTML = `<div class="detail-notice"><strong>Команда недоступна</strong><span>Не удалось загрузить данные для ${key}.</span></div>`;
      return;
    }
    const record = team.record || {};
    const recordText = record.summary || (record.gp ? `${record.wins}-${record.losses}-${record.ot}` : '—');
    const teamFavOn = isFavoriteTeam(team.abbrev);
    content.innerHTML = `
      <div class="team-hero">
        <img class="team-hero-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">
        <div class="team-hero-copy">
          <p class="eyebrow accent">${team.abbrev}</p>
          <h2>${team.name}</h2>
          <p class="team-meta-line">${[team.city, team.arena].filter(Boolean).join(' · ') || 'NHL'}</p>
          <p class="team-meta-line">${[team.conference && `${team.conference} Conf.`, team.division && `${team.division} Div.`].filter(Boolean).join(' · ')}</p>
          <div class="team-record"><strong>${recordText}</strong><span>${record.points != null ? `${record.points} очков` : (team.standingSummary || '')}</span></div>
          <div class="team-hero-actions">${favToggleMarkup('team', teamFavOn, `data-fav-team="${escapeAttr(team.abbrev || '')}" data-fav-team-name="${escapeAttr(team.name || '')}" data-fav-team-logo="${escapeAttr(team.logo || '')}"`)}</div>
        </div>
      </div>
      <p class="panel-note">${team.note || team.source || ''}${team.statsNote ? ` · ${team.statsNote}` : ''}</p>
      ${teamSalaryCapMarkup(team.salaryCap)}
      <section class="detail-section"><div class="detail-section-title"><h3>Состав</h3><span>${team.roster?.length || 0}</span></div>${rosterGroupMarkup((team.roster || []).map(p => ({ ...p, abbrev: team.abbrev })))}</section>
      ${scheduleListMarkup('Ближайшие', team.schedule?.upcoming || [], 'Нет ближайших матчей', { remindable: true })}
      ${scheduleListMarkup('Недавние', team.schedule?.recent || [], 'Нет завершённых матчей')}
      ${statsGridMarkup('Командная статистика', team.stats || [], team.statsNote || '')}
      ${teamTrophiesMarkup(team.trophies)}
      ${retiredNumbersMarkup(team.retiredNumbers)}
    `;
  }

  async function openPlayerDetail(ref = {}) {
    const nhlId = ref.nhlId || '';
    const espnId = ref.espnId || '';
    const name = ref.name || '';
    const abbrev = ref.abbrev || '';
    if (!nhlId && !espnId && !(name && abbrev)) {
      toast('Игрок недоступен');
      return;
    }
    showPanel('player-detail', { push: true });
    const content = $('#playerDetailContent');
    content.innerHTML = `<div class="detail-notice"><strong>Загрузка игрока…</strong><span>${name || 'NHL'}</span></div>`;
    let player = null;
    try {
      player = await live?.loadPlayer?.({ nhlId, espnId, name, abbrev });
    } catch (error) { console.warn(error); }
    if (!player) {
      content.innerHTML = `<div class="detail-notice"><strong>Игрок недоступен</strong><span>Не удалось загрузить профиль${name ? ` · ${name}` : ''}.</span></div>`;
      return;
    }
    const russianClass = player.isRussian ? ' russian-player' : '';
    const flag = player.flag || live?.resolvePlayerFlag?.(player) || null;
    const countryLabel = flag
      ? `${flag.emoji ? flag.emoji + ' ' : ''}${flag.label || flag.iso2 || ''}`.trim()
      : (player.birthCountry || player.nationality || '');
    const playerFavOn = isFavoritePlayer(player);
    const playerFavCls = playerFavOn ? ' is-favorite' : '';
    content.innerHTML = `
      <div class="player-hero">
        <div class="player-hero-photo">${player.headshot ? `<img src="${escapeAttr(player.headshot)}" alt="" onerror="this.parentNode.textContent='${(player.name || '?').split(' ').map(p => p[0]).join('').slice(0, 2)}'">` : (player.name || '?').split(' ').map(p => p[0]).join('').slice(0, 2)}</div>
        <div class="player-hero-copy">
          <p class="eyebrow accent">${player.position || 'SK'}${player.number ? ` · #${player.number}` : ''}</p>
          <h2 class="player-hero-name">${flagMarkup(flag)}<span class="player-name${russianClass}${playerFavCls}">${player.name}</span></h2>
          <button type="button" class="player-team-link team-hit${isFavoriteTeam(player.abbrev) ? ' is-favorite' : ''}" data-team-abbrev="${escapeAttr(player.abbrev || '')}">
            ${player.logo ? `<img src="${escapeAttr(player.logo)}" alt="">` : ''}<span>${player.team || player.abbrev || 'NHL'}</span>
          </button>
          <div class="player-hero-actions">${favToggleMarkup('player', playerFavOn, `data-fav-player="1" data-nhl-id="${escapeAttr(player.nhlId || '')}" data-espn-id="${escapeAttr(player.espnId || '')}" data-player-name="${escapeAttr(player.name || '')}" data-team-abbrev="${escapeAttr(player.abbrev || '')}" data-fav-team-name="${escapeAttr(player.team || '')}"`)}</div>
        </div>
      </div>
      <section class="detail-section"><div class="detail-section-title"><h3>Инфо</h3></div>
        <div class="info-grid">
          ${[['Рост', player.height], ['Вес', player.weight], ['Хват', player.shoots], ['Дата рождения', player.birthDate], ['Страна', countryLabel], ['Место', player.birthPlace], ['Драфт', player.draft]]
            .filter(([, value]) => value)
            .map(([label, value]) => `<div class="info-row"><span>${label}</span><strong>${value}</strong></div>`).join('') || '<p class="empty-detail">Нет биоданных</p>'}
        </div>
      </section>
      ${contractMarkup(player.contract)}
      ${statsGridMarkup(`Сезон · ${player.seasonLabel || ''}`, player.seasonStats || [])}
      ${statsGridMarkup('Карьера', player.careerStats || [])}
      ${careerHistoryMarkup(player.careerHistory, player.position === 'G')}
      ${trophiesMarkup(player.trophies)}
      ${awardsMarkup(player.awards)}
      <p class="panel-note">${player.note || player.source || ''}</p>
    `;
  }

  async function loadGames(dateKey, { toastOnDone = false } = {}) {
    state.selectedDate = dateKey;
    renderDayNavigation();
    $('#gamesList').innerHTML = `<div class="empty-state"><strong>Загрузка…</strong><span>Расписание NHL на ${formatDate(dateKey)}</span></div>`;
    let result = null;
    if (live) {
      try { result = await live.gamesForDate(dateKey); } catch (error) { console.warn(error); }
    }
    if (result && Array.isArray(result.games) && !result.error) {
      state.games = result.games;
      state.gamesSource = result.source || 'live';
    } else {
      state.games = mockGamesFor(dateKey);
      state.gamesSource = 'mock';
      if (!state.games.length && result?.error) {
        toast('Live API недоступен (CORS) — демо');
      }
    }
    renderGames();
    if (toastOnDone) toast(state.gamesSource === 'mock' ? 'Демо-данные' : 'Расписание обновлено');
  }

  async function loadStandingsLive() {
    if (!live) {
      renderStandings();
      return;
    }
    try {
      const data = await live.loadStandings();
      if (data) {
        state.standings = {
          division: data.division.map(group => ({
            ...group,
            teams: group.teams.map(team => [team.name, team.abbrev, team.wins, team.losses, team.ot, team.points])
          })),
          conference: data.conference.map(group => ({
            ...group,
            teams: group.teams.map(team => [team.name, team.abbrev, team.wins, team.losses, team.ot, team.points])
          }))
        };
        state.standingsNote = data.sourceNote || data.source || '';
      }
    } catch (error) {
      console.warn(error);
    }
    renderStandings($('.segment[data-standings-tab].is-selected')?.dataset.standingsTab || 'division');
  }

  async function loadStatsLive() {
    renderStatsTabs();
    $('#statsList').innerHTML = `<div class="empty-state"><strong>Загрузка…</strong><span>Лидеры статистики</span></div>`;
    if (!live) {
      const type = state.statsGroup === 'goalies' ? 'goalies' : state.statsGroup === 'rookies' ? 'rookies' : 'scorers';
      const players = (mock.stats && mock.stats[type]) || [];
      renderStats(players.map(player => ({
        ...player,
        value: type === 'goalies' ? player.wins : player.points
      })), 'демо');
      return;
    }
    try {
      const payload = state.statsGroup === 'rookies'
        ? await live.loadRookies(state.statsBoard)
        : await live.loadBoard(state.statsGroup === 'goalies' ? 'goalies' : 'skaters', state.statsBoard);
      renderStats(payload.players || [], payload.note || payload.source || '');
    } catch (error) {
      console.warn(error);
      renderStats([], 'ошибка загрузки');
    }
  }

  function renderAlltimeTabs() {
    const groupTabs = $('#alltimeGroupTabs');
    const boardTabs = $('#alltimeBoardTabs');
    if (!groupTabs || !boardTabs || !live) return;
    const groups = [
      { id: 'skaters', label: 'Скейттеры' },
      { id: 'goalies', label: 'Вратари' }
    ];
    groupTabs.innerHTML = groups.map(group =>
      `<button class="segment ${state.alltimeGroup === group.id ? 'is-selected' : ''}" data-alltime-group="${group.id}">${group.label}</button>`
    ).join('');
    const boards = state.alltimeGroup === 'goalies' ? live.CAREER_GOALIE_BOARDS : live.CAREER_SKATER_BOARDS;
    if (!boards.some(board => board.id === state.alltimeBoard)) {
      state.alltimeBoard = boards[0].id;
    }
    boardTabs.innerHTML = boards.map(board =>
      `<button class="segment ${state.alltimeBoard === board.id ? 'is-selected' : ''}" data-alltime-board="${board.id}">${board.label}</button>`
    ).join('');
  }

  function renderAlltime(players = [], note = '') {
    const list = $('#alltimeList');
    if (!list) return;
    if (!players.length) {
      list.innerHTML = `<div class="empty-state"><strong>Нет данных</strong><span>Карьерные лидеры по этой категории пока недоступны.</span></div>`;
    } else {
      list.innerHTML = players.map((player, index) =>
        leaderCardMarkup(player, index, state.alltimeBoard, state.alltimeGroup === 'goalies')
      ).join('');
    }
    const noteNode = $('#alltimeNote');
    if (noteNode) noteNode.textContent = note || '';
  }

  async function loadAlltimeLive() {
    renderAlltimeTabs();
    const list = $('#alltimeList');
    if (list) list.innerHTML = `<div class="empty-state"><strong>Загрузка…</strong><span>Карьерные лидеры NHL</span></div>`;
    if (!live?.loadCareerBoard) {
      renderAlltime([], 'API недоступен');
      return;
    }
    try {
      const payload = await live.loadCareerBoard(
        state.alltimeGroup === 'goalies' ? 'goalies' : 'skaters',
        state.alltimeBoard
      );
      renderAlltime(payload.players || [], payload.note || payload.source || '');
    } catch (error) {
      console.warn(error);
      renderAlltime([], 'ошибка загрузки');
    }
  }

  function openExternal(url) {
    const opened = bridge.openLink?.(url);
    if (!opened) {
      try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* soft-fail */ }
    }
  }

  function closeGoalVideos(exceptSlot = null) {
    $$('.goal-video-slot').forEach(slot => {
      if (exceptSlot && slot === exceptSlot) return;
      slot.hidden = true;
      slot.innerHTML = '';
    });
    $$('.goal-play.is-open').forEach(btn => {
      if (exceptSlot && btn.closest('.scoring-row')?.querySelector('.goal-video-slot') === exceptSlot) return;
      btn.classList.remove('is-open');
    });
  }

  function toggleGoalVideo(button) {
    const url = button.getAttribute('data-goal-video') || '';
    if (!url) return;
    const embed = button.getAttribute('data-goal-embed') === '1';
    const row = button.closest('.goal-card, .scoring-row');
    const slot = row?.querySelector('.goal-video-slot');
    if (!embed || !slot) {
      openExternal(url);
      return;
    }
    const opening = slot.hidden || !button.classList.contains('is-open');
    closeGoalVideos(opening ? slot : null);
    if (!opening) {
      slot.hidden = true;
      slot.innerHTML = '';
      button.classList.remove('is-open');
      return;
    }
    const safe = escapeAttr(url);
    slot.innerHTML = `<video class="goal-video" controls playsinline preload="metadata" src="${safe}"></video>`;
    slot.hidden = false;
    button.classList.add('is-open');
    const video = slot.querySelector('video');
    try { video?.play?.().catch?.(() => {}); } catch { /* soft-fail autoplay */ }
  }

  function bindPlayerOpen(target) {
    const node = target.closest?.('[data-nhl-id], [data-espn-id], .player-hit, .player-name.is-clickable');
    if (!node) return false;
    const nhlId = node.getAttribute('data-nhl-id') || '';
    const espnId = node.getAttribute('data-espn-id') || '';
    const name = node.getAttribute('data-player-name') || node.textContent?.trim() || '';
    const abbrev = node.getAttribute('data-team-abbrev') || '';
    if (!nhlId && !espnId && !(name && abbrev)) return false;
    openPlayerDetail({ nhlId, espnId, name, abbrev });
    return true;
  }

  function bindTeamOpen(target) {
    const node = target.closest?.('[data-team-abbrev].team-hit, button.team-hit, .team-hit');
    if (!node || node.classList.contains('player-hit')) return false;
    // Avoid treating player-name team abbrev as team button unless it's team-hit
    if (!node.classList.contains('team-hit') && !node.classList.contains('standing-row') && !node.classList.contains('player-team-link') && !node.classList.contains('detail-team')) {
      return false;
    }
    const abbrev = node.getAttribute('data-team-abbrev');
    if (!abbrev) return false;
    openTeamDetail(abbrev);
    return true;
  }

  $$('.nav-item').forEach(button => button.addEventListener('click', () => {
    showPanel(button.dataset.nav);
    if (button.dataset.nav === 'stats') {
      // Drop only leaderboard entries so season flips / old PREV responses cannot stick.
      live?.clearStatsCache?.();
      loadStatsLive();
    }
    if (button.dataset.nav === 'alltime') loadAlltimeLive();
    if (button.dataset.nav === 'standings') loadStandingsLive();
    if (button.dataset.nav === 'settings') { renderFavoritesSettings(); syncDonateSettingsVisibility(); }
  }));

  $$('.segment[data-standings-tab]').forEach(button => button.addEventListener('click', () => {
    $$('[data-standings-tab]').forEach(item => item.classList.toggle('is-selected', item === button));
    renderStandings(button.dataset.standingsTab);
  }));

  $('#statsGroupTabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-stats-group]');
    if (!button) return;
    state.statsGroup = button.dataset.statsGroup;
    state.statsBoard = state.statsGroup === 'goalies' ? 'wins' : 'points';
    loadStatsLive();
  });

  $('#statsBoardTabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-stats-board]');
    if (!button) return;
    state.statsBoard = button.dataset.statsBoard;
    loadStatsLive();
  });

  $('#alltimeGroupTabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-alltime-group]');
    if (!button) return;
    state.alltimeGroup = button.dataset.alltimeGroup;
    state.alltimeBoard = state.alltimeGroup === 'goalies' ? 'wins' : 'points';
    loadAlltimeLive();
  });

  $('#alltimeBoardTabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-alltime-board]');
    if (!button) return;
    state.alltimeBoard = button.dataset.alltimeBoard;
    loadAlltimeLive();
  });

  // Results: any tap/key on a match card opens match detail — never team pages.
  $('#gamesList').addEventListener('click', event => {
    const card = event.target.closest('[data-game-id]');
    if (card) openGameDetail(card.dataset.gameId);
  });
  $('#gamesList').addEventListener('keydown', event => {
    const card = event.target.closest('[data-game-id]');
    if (card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openGameDetail(card.dataset.gameId);
    }
  });

  $('#standingsList')?.addEventListener('click', event => {
    if (bindTeamOpen(event.target)) event.preventDefault();
  });

  $('#statsList')?.addEventListener('click', event => {
    if (bindPlayerOpen(event.target)) event.preventDefault();
  });
  $('#alltimeList')?.addEventListener('click', event => {
    if (bindPlayerOpen(event.target)) event.preventDefault();
  });

  function detailClickHandler(event) {
    const gameTab = event.target.closest?.('[data-game-tab]');
    if (gameTab) {
      event.preventDefault();
      const root = gameTab.closest('#gameDetailContent') || $('#gameDetailContent');
      const tab = gameTab.getAttribute('data-game-tab');
      root.querySelectorAll('[data-game-tab]').forEach(btn => {
        const on = btn === gameTab;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      root.querySelectorAll('[data-game-tab-panel]').forEach(panel => {
        panel.hidden = panel.getAttribute('data-game-tab-panel') !== tab;
      });
      return;
    }
    const boxTeam = event.target.closest?.('[data-box-team]');
    if (boxTeam) {
      event.preventDefault();
      const root = boxTeam.closest('#gameDetailContent') || $('#gameDetailContent');
      const key = boxTeam.getAttribute('data-box-team');
      root.querySelectorAll('[data-box-team]').forEach(btn => {
        const on = btn === boxTeam;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      root.querySelectorAll('[data-box-team-panel]').forEach(panel => {
        panel.hidden = panel.getAttribute('data-box-team-panel') !== key;
      });
      return;
    }
    const favBtn = eventElement(event)?.closest?.('.fav-toggle');
    if (favBtn) {
      event.preventDefault();
      event.stopPropagation();
      const kind = favBtn.getAttribute('data-fav-kind');
      const wasOn = favBtn.classList.contains('is-on') || favBtn.getAttribute('aria-pressed') === 'true';
      if (kind === 'team') {
        const abbrev = favBtn.getAttribute('data-fav-team') || '';
        const on = toggleFavoriteTeam({
          abbrev,
          name: favBtn.getAttribute('data-fav-team-name') || abbrev,
          logo: favBtn.getAttribute('data-fav-team-logo') || ''
        }, { forceRemove: wasOn });
        favBtn.classList.toggle('is-on', on);
        favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        favBtn.textContent = on ? '★' : '☆';
        toast(on ? 'Команда в избранном' : 'Команда убрана из избранного');
        renderFavoritesSettings();
        // refresh list highlights if visible
        if ($('.panel.is-active')?.dataset.panel === 'standings') {
          renderStandings($('.segment[data-standings-tab].is-selected')?.dataset.standingsTab || 'division');
        }
        if ($('.panel.is-active')?.dataset.panel === 'results') renderGames();
      } else {
        const ref = {
          nhlId: favBtn.getAttribute('data-nhl-id') || '',
          espnId: favBtn.getAttribute('data-espn-id') || '',
          name: favBtn.getAttribute('data-player-name') || '',
          abbrev: favBtn.getAttribute('data-team-abbrev') || '',
          team: favBtn.getAttribute('data-fav-team-name') || ''
        };
        const on = toggleFavoritePlayer(ref, { forceRemove: wasOn });
        favBtn.classList.toggle('is-on', on);
        favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        favBtn.textContent = on ? '★' : '☆';
        const nameNode = $('#playerDetailContent .player-hero-name .player-name');
        nameNode?.classList.toggle('is-favorite', on);
        toast(on ? 'Игрок в избранном' : 'Игрок убран из избранного');
        renderFavoritesSettings();
      }
      return;
    }
    const remindBtn = event.target.closest?.('[data-remind-game]');
    if (remindBtn) {
      event.preventDefault();
      event.stopPropagation();
      const gameId = remindBtn.getAttribute('data-remind-game');
      if (!gameId) return;
      const currentlyOn = remindBtn.getAttribute('data-remind-on') === '1';
      const nextOn = !currentlyOn;
      setReminderLocal(gameId, nextOn, {
        startTimeUTC: remindBtn.getAttribute('data-remind-start') || '',
        away: remindBtn.getAttribute('data-remind-away') || '',
        home: remindBtn.getAttribute('data-remind-home') || ''
      });
      remindBtn.classList.toggle('is-on', nextOn);
      remindBtn.setAttribute('data-remind-on', nextOn ? '1' : '0');
      remindBtn.setAttribute('aria-pressed', nextOn ? 'true' : 'false');
      remindBtn.textContent = nextOn ? '🔔 Вкл' : '🔔';
      openRemindBot(gameId, nextOn, remindBtn.getAttribute('data-remind-start') || '');
      toast(nextOn ? 'Напоминание: откройте бота для подтверждения' : 'Напоминание снято — подтвердите в боте');
      return;
    }
    const openUrl = event.target.closest?.('[data-open-url]');
    if (openUrl) {
      event.preventDefault();
      openExternal(openUrl.getAttribute('data-open-url'));
      return;
    }
    const goalBtn = event.target.closest?.('.goal-play');
    if (goalBtn) {
      event.preventDefault();
      toggleGoalVideo(goalBtn);
      return;
    }
    if (bindTeamOpen(event.target)) {
      event.preventDefault();
      return;
    }
    if (bindPlayerOpen(event.target)) {
      event.preventDefault();
    }
  }

  $('#gameDetailContent')?.addEventListener('click', detailClickHandler);
  $('#teamDetailContent')?.addEventListener('click', detailClickHandler);
  $('#playerDetailContent')?.addEventListener('click', detailClickHandler);

  $('#gameDetailBack')?.addEventListener('click', goBack);
  $('#teamDetailBack')?.addEventListener('click', goBack);
  $('#playerDetailBack')?.addEventListener('click', goBack);

  $('#refreshButton').addEventListener('click', () => {
    live?.clearCache?.();
    loadGames(state.selectedDate, { toastOnDone: true });
  });
  // Settings favorites: capture-phase so × is not swallowed by fav-open / WebView quirks.
  function handleSettingsFavoritesEvent(event) {
    const el = eventElement(event);
    if (!el) return;
    const removePlayer = el.closest('[data-fav-remove-player]');
    if (removePlayer) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const key = removePlayer.getAttribute('data-fav-remove-player') || '';
      removeFavoritePlayer({
        key,
        rawKey: key,
        nhlId: removePlayer.getAttribute('data-nhl-id') || '',
        espnId: removePlayer.getAttribute('data-espn-id') || '',
        name: removePlayer.getAttribute('data-player-name') || '',
        abbrev: removePlayer.getAttribute('data-team-abbrev') || ''
      });
      renderFavoritesSettings();
      toast('Игрок убран из избранного');
      return;
    }
    const removeTeam = el.closest('[data-fav-remove-team]');
    if (removeTeam) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      removeFavoriteTeam(removeTeam.getAttribute('data-fav-remove-team') || '');
      renderFavoritesSettings();
      toast('Команда убрана из избранного');
      return;
    }
    // Only handle open on bubble phase to avoid fighting with remove.
    if (event.eventPhase === Event.CAPTURING_PHASE) return;
    if (bindPlayerOpen(el)) {
      event.preventDefault();
      return;
    }
    if (bindTeamOpen(el)) {
      event.preventDefault();
    }
  }
  const settingsFavRoot = document.querySelector('[data-panel="settings"]') || document;
  settingsFavRoot.addEventListener('click', handleSettingsFavoritesEvent, true);
  document.getElementById('favPlayersList')?.addEventListener('click', handleSettingsFavoritesEvent);
  document.getElementById('favTeamsList')?.addEventListener('click', handleSettingsFavoritesEvent);

  $('#profileButton').addEventListener('click', () => { showPanel('settings'); renderFavoritesSettings(); syncDonateSettingsVisibility(); });
  const donateBtn = document.getElementById('tgDonateBtn');
  if (donateBtn) {
    donateBtn.addEventListener('click', () => openDonateBot());
  }
  syncDonateSettingsVisibility();
  $('#prevDay').addEventListener('click', () => loadGames(live.shiftDate(state.selectedDate, -1), { toastOnDone: true }));
  $('#nextDay').addEventListener('click', () => loadGames(live.shiftDate(state.selectedDate, 1), { toastOnDone: true }));
  $('#themeToggle').addEventListener('change', event => applyTheme(event.target.checked ? 'dark' : 'light', true));
  $('#ruHighlightToggle').addEventListener('change', event => {
    applyRussianHighlight(event.target.checked, true);
    toast(event.target.checked ? 'Подсветка включена' : 'Подсветка выключена');
  });
  $$('.toggle input:not(#themeToggle):not(#ruHighlightToggle)').forEach(input => input.addEventListener('change', () => toast(input.checked ? 'Включено' : 'Выключено')));

  // Swipe back on detail screens:
  // - right-to-left swipe (finger moves left)
  // - left-edge swipe to the right (iOS-style back)
  (function bindSwipeBack() {
    const shell = $('.app-shell');
    if (!shell) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let fromHScroll = false;
    const EDGE = 32;
    const MIN_DX = 64;
    const MAX_DY = 56;

    shell.addEventListener('touchstart', event => {
      if (!DETAIL_PANELS.has(state.currentPanel)) return;
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      // Horizontal table scroll inside the match card must not steal swipe-back.
      fromHScroll = Boolean(event.target?.closest?.('.player-box-scroll, .boxscore-table'));
    }, { passive: true });

    shell.addEventListener('touchend', event => {
      if (!tracking || !DETAIL_PANELS.has(state.currentPanel)) return;
      tracking = false;
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dy > MAX_DY) return;
      const rtlBack = dx <= -MIN_DX && !fromHScroll;
      const edgeBack = startX <= EDGE && dx >= MIN_DX;
      if (rtlBack || edgeBack) goBack();
    }, { passive: true });
  })();

  const DEEPLINK_HANDLED_KEY = 'nhl-diggest-deeplink-handled';

  (async function boot() {
    renderDayNavigation();
    const deepMatchId = readDeepLinkMatchId();
    await Promise.all([
      loadGames(state.selectedDate),
      loadStandingsLive(),
      loadStatsLive()
    ]);
    if (deepMatchId) {
      let alreadyHandled = false;
      try {
        alreadyHandled = sessionStorage.getItem(DEEPLINK_HANDLED_KEY) === String(deepMatchId);
      } catch { /* private mode */ }
      if (alreadyHandled) {
        // Stale Telegram start_param on reopen — skip auto-open (no toast).
      } else {
        try {
          await openGameDetail(deepMatchId, { silent: true });
        } catch (error) {
          console.warn('[NHL Diggest] deep-link match open failed', error);
        }
        try {
          sessionStorage.setItem(DEEPLINK_HANDLED_KEY, String(deepMatchId));
        } catch { /* private mode */ }
      }
    }
  })();
})();
