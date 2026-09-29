(() => {
  'use strict';

  const mock = window.NHL_MOCK || {};
  const live = window.NHL_LIVE;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function playerIsRussian(player) {
    return Boolean(player?.isRussian || live?.isRussianPlayer?.(player));
  }

  function playerMarkup(player, fallbackName = '') {
    const name = typeof player === 'string' ? player : (player?.name || fallbackName || '');
    const russian = typeof player === 'object' ? playerIsRussian(player) : playerIsRussian(name);
    return `<span class="player-name${russian ? ' russian-player' : ''}">${name}</span>`;
  }

  function assistsMarkup(assists = []) {
    return assists.map(assist => playerMarkup(assist, assist)).join(', ');
  }

  const bridge = window.NHL_BRIDGE || { env: 'browser', theme: 'dark' };
  const themeStorageKey = 'nhl-diggest-theme';
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
    return `<div class="team ${side}">
      <div class="team-info"><span class="team-name">${team.name}</span><span class="team-nick">${team.nick}</span></div>
      <img class="logo" src="${team.logo}" alt="${team.name} logo" onerror="this.style.display='none'">
    </div>`;
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
        return `<div class="standing-row"><span class="rank">${index + 1}</span><strong>${row[0]} <small>${row[1]}</small></strong><em>${gamesPlayed}</em><em>${row[5]}</em></div>`;
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

  function renderStats(players = [], note = '') {
    const list = $('#statsList');
    if (!players.length) {
      list.innerHTML = `<div class="empty-state"><strong>Нет данных</strong><span>Лидеры по этой категории пока недоступны.</span></div>`;
      return;
    }
    if (state.statsGroup === 'goalies') {
      list.innerHTML = players.map((player, index) => `<div class="leader-card goalie-card">
        <span class="player-rank">${String(index + 1).padStart(2, '0')}</span>
        <div class="player-avatar goalie-avatar">${(player.name || '?').split(' ').map(part => part[0]).join('').slice(0, 2)}</div>
        <div class="player-copy"><strong>${playerMarkup(player)}</strong><span>${player.team || ''} · G</span></div>
        <div class="player-stat"><strong>${player.value ?? '—'}</strong><span>${state.statsBoard}</span></div>
      </div>`).join('');
    } else {
      list.innerHTML = players.map((player, index) => `<div class="leader-card">
        <span class="player-rank">${String(index + 1).padStart(2, '0')}</span>
        <div class="player-avatar">${(player.name || '?').split(' ').map(part => part[0]).join('').slice(0, 2)}</div>
        <div class="player-copy"><strong>${playerMarkup(player)}</strong><span>${player.team || ''} · ${player.position || 'SK'}</span></div>
        <div class="player-stat"><strong>${player.value ?? '—'}</strong><span>${state.statsBoard}</span></div>
      </div>`).join('');
    }
    const noteNode = $('#statsNote');
    if (noteNode) noteNode.textContent = note || '';
  }


  function periodGroupsMarkup(events, kind) {
    const groups = live?.groupByPeriod?.(events) || [{ period: '—', events: events || [] }];
    if (!events?.length) {
      return `<p class="empty-detail">${kind === 'goals' ? 'Пока без голов' : 'Нет удалений'}</p>`;
    }
    return groups.map(group => {
      const rows = kind === 'goals'
        ? group.events.map(event => `<div class="scoring-row"><span class="event-time"><strong>${event.time || ''}</strong></span><span class="event-team">${event.team || ''}</span><div><strong>${playerMarkup({ name: event.scorer, isRussian: event.scorerRussian })}</strong><small>${event.assists?.length ? `ассисты: ${assistsMarkup(event.assists)}` : 'без ассистов'}${event.strength ? ` · ${event.strength}` : ''}</small></div></div>`).join('')
        : group.events.map(item => `<div class="penalty-row"><span>${item.time || ''}</span><strong>${item.team} · ${playerMarkup({ name: item.player || '', isRussian: item.playerRussian })}</strong><small>${item.minutes ? `${item.minutes} мин · ` : ''}${item.infraction || ''}</small></div>`).join('');
      return `<div class="period-block"><div class="period-heading">${group.period}</div><div class="${kind === 'goals' ? 'scoring-list' : 'penalty-list'} period-events">${rows}</div></div>`;
    }).join('');
  }

  function detailTeamMarkup(team) {
    return `<div class="detail-team"><img class="detail-logo" src="${team.logo}" alt="${team.name} logo" onerror="this.style.display='none'"><strong>${team.name}</strong><span>${team.nick}</span></div>`;
  }

  async function openGameDetail(gameId) {
    const game = state.games.find(item => String(item.id) === String(gameId));
    if (!game) return;
    showPanel('game-detail');
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

    $('#gameDetailContent').innerHTML = `
      <div class="detail-hero">
        <div class="detail-status status ${game.status === 'Live' ? 'live' : isScheduled ? (game.preseason ? 'preseason' : 'future') : 'final'}">${statusLabel(game.status, game.preseason)}</div>
        <div class="detail-scoreboard">${detailTeamMarkup(game.away)}<div class="detail-score"><strong>${score}</strong><span>${isScheduled ? game.time : game.period || ''}</span></div>${detailTeamMarkup(game.home)}</div>
        <div class="detail-venue">${detail?.venue || game.venue || 'NHL Arena'}${detail?.attendance ? ` · ${detail.attendance} зрителей` : ''}</div>
      </div>
      ${isScheduled ? `<div class="detail-notice"><strong>Матч ещё не начался</strong><span>Подробная статистика появится после стартового вбрасывания.</span></div>` : `
        <section class="detail-section"><div class="detail-section-title"><h3>Голы</h3><span>${scoring.length}</span></div>
          <div class="period-groups">${periodGroupsMarkup(scoring, 'goals')}</div>
        </section>
        <section class="detail-section"><div class="detail-section-title"><h3>Командная статистика</h3></div>
          <div class="boxscore-table"><div class="boxscore-head"><span>Команда</span><span>Броски</span><span>Силовые</span><span>Вбрасывания</span><span>Большинство</span></div>${[game.away, game.home].map(team => { const stats = boxscore[team.short] || {}; return `<div class="boxscore-row"><strong><img src="${team.logo}" alt="">${team.short}</strong><span>${stats.shots ?? '—'}</span><span>${stats.hits ?? '—'}</span><span>${stats.faceoff ?? '—'}</span><span>${stats.powerPlay ?? '—'}</span></div>`; }).join('')}</div>
        </section>
        <section class="detail-section"><div class="detail-section-title"><h3>Удаления</h3><span>${penalties.length}</span></div><div class="period-groups">${periodGroupsMarkup(penalties, 'penalties')}</div></section>
        ${goalies.length ? `<section class="detail-section"><div class="detail-section-title"><h3>Вратари</h3></div><div class="goalie-lines">${goalies.map(goalie => `<div class="goalie-line"><span class="line-team">${teamByShort[goalie.team]?.short || goalie.team}</span><strong>${playerMarkup(goalie)}</strong><span>${goalie.saves}${goalie.sv ? ` · SV% ${goalie.sv}` : ''}${goalie.toi ? ` · ${goalie.toi}` : ''}</span></div>`).join('')}</div></section>` : ''}
      `}`;
  }

  function showPanel(name) {
    $$('.panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.panel === name));
    $$('.nav-item').forEach(button => {
      const active = button.dataset.nav === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $('.app-shell').classList.toggle('is-detail', name === 'game-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    } else if (state.alltimeGroup === 'goalies') {
      list.innerHTML = players.map((player, index) => `<div class="leader-card goalie-card">
        <span class="player-rank">${String(index + 1).padStart(2, '0')}</span>
        <div class="player-avatar goalie-avatar">${(player.name || '?').split(' ').map(part => part[0]).join('').slice(0, 2)}</div>
        <div class="player-copy"><strong>${playerMarkup(player)}</strong><span>${player.team || 'NHL'} · G</span></div>
        <div class="player-stat"><strong>${player.value ?? '—'}</strong><span>${state.alltimeBoard}</span></div>
      </div>`).join('');
    } else {
      list.innerHTML = players.map((player, index) => `<div class="leader-card">
        <span class="player-rank">${String(index + 1).padStart(2, '0')}</span>
        <div class="player-avatar">${(player.name || '?').split(' ').map(part => part[0]).join('').slice(0, 2)}</div>
        <div class="player-copy"><strong>${playerMarkup(player)}</strong><span>${player.team || 'NHL'} · ${player.position || 'SK'}</span></div>
        <div class="player-stat"><strong>${player.value ?? '—'}</strong><span>${state.alltimeBoard}</span></div>
      </div>`).join('');
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

  $$('.nav-item').forEach(button => button.addEventListener('click', () => {
    showPanel(button.dataset.nav);
    if (button.dataset.nav === 'stats') loadStatsLive();
    if (button.dataset.nav === 'alltime') loadAlltimeLive();
    if (button.dataset.nav === 'standings') loadStandingsLive();
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
  $('#gameDetailBack').addEventListener('click', () => showPanel('results'));
  $('#refreshButton').addEventListener('click', () => {
    live?.clearCache?.();
    loadGames(state.selectedDate, { toastOnDone: true });
  });
  $('#profileButton').addEventListener('click', () => showPanel('settings'));
  $('#prevDay').addEventListener('click', () => loadGames(live.shiftDate(state.selectedDate, -1), { toastOnDone: true }));
  $('#nextDay').addEventListener('click', () => loadGames(live.shiftDate(state.selectedDate, 1), { toastOnDone: true }));
  $('#themeToggle').addEventListener('change', event => applyTheme(event.target.checked ? 'dark' : 'light', true));
  $$('.toggle input:not(#themeToggle)').forEach(input => input.addEventListener('change', () => toast(input.checked ? 'Включено' : 'Выключено')));

  (async function boot() {
    renderDayNavigation();
    await Promise.all([
      loadGames(state.selectedDate),
      loadStandingsLive(),
      loadStatsLive()
    ]);
  })();
})();
