(() => {
  'use strict';
  const data = window.NHL_MOCK;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#0c111b');
    tg.setBackgroundColor?.('#080d15');
  }

  function teamMarkup(team, side) {
    return `<div class="team ${side}">
      <div class="team-info"><span class="team-name">${team.name}</span><span class="team-nick">${team.nick}</span></div>
      <img class="logo" src="${team.logo}" alt="${team.name} logo" onerror="this.style.display='none'">
    </div>`;
  }

  function statusLabel(status) {
    return { Final: 'Завершён', Live: 'LIVE', FUT: 'Запланирован', Preseason: 'Предсезонный' }[status] || status;
  }

  function renderGames() {
    $('#gamesList').innerHTML = data.games.map(game => {
      const isFuture = game.status === 'FUT' || game.status === 'Preseason';
      const score = isFuture ? `<span class="score time">${game.time.replace('Завтра, ', '')}</span>` : `<span class="score">${game.away.score}<span class="score-divider">:</span>${game.home.score}</span>`;
      const statusClass = game.status === 'Live' ? 'live' : game.status === 'Preseason' ? 'preseason' : isFuture ? 'future' : 'final';
      return `<article class="game-card" data-game-id="${game.id}" tabindex="0" role="button" aria-label="Открыть матч ${game.away.name} ${game.away.score ?? ''} — ${game.home.name} ${game.home.score ?? ''}">
        <div class="game-meta"><span>${game.time}</span><span class="status ${statusClass}">${statusLabel(game.status)}</span></div>
        <div class="game-body">${teamMarkup(game.away, 'away')}<div class="game-score">${score}${game.period ? `<div class="period">${game.period}</div>` : ''}</div>${teamMarkup(game.home, 'home')}</div>
        <div class="game-open-label">Подробности <span>›</span></div>
      </article>`;
    }).join('');
    $('#gameCount').textContent = `${data.games.length} игр`;
  }

  function renderStandings(type = 'division') {
    $('#standingsList').innerHTML = data.standings[type].map(group => `<div class="division-block">
      <div class="division-title"><span>${group.title}</span><span>${group.code}</span></div>
      <div class="standing-head"><span>#</span><span>Команда</span><span>И</span><span>О</span></div>
      ${group.teams.map((team, index) => `<div class="standing-row"><span class="rank">${index + 1}</span><strong>${team[0]} <small>${team[1]}</small></strong><em>${team[2]}</em><em>${Number(team[2]) * 2 - (index % 2)}</em></div>`).join('')}
    </div>`).join('');
  }

  function renderStats(type = 'scorers') {
    if (type === 'goalies') {
      $('#statsList').innerHTML = data.stats.goalies.map((player, index) => `<div class="leader-card goalie-card">
        <span class="player-rank">${String(index + 1).padStart(2, '0')}</span>
        <div class="player-avatar goalie-avatar">${player.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</div>
        <div class="player-copy"><strong>${player.name}</strong><span>${player.team} · ${player.position}</span></div>
        <div class="goalie-stats"><span><strong>${player.wins}</strong><small>W</small></span><span><strong>${player.gaa}</strong><small>GAA</small></span><span><strong>${player.sv}</strong><small>SV%</small></span></div>
      </div>`).join('');
      return;
    }

    $('#statsList').innerHTML = data.stats[type].map((player, index) => `<div class="leader-card">
      <span class="player-rank">${String(index + 1).padStart(2, '0')}</span>
      <div class="player-avatar">${player.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</div>
      <div class="player-copy"><strong>${player.name}</strong><span>${player.team} · ${player.position} · ${player.goals}G / ${player.assists}A</span></div>
      <div class="player-stat"><strong>${player.points}</strong><span>очков</span></div>
    </div>`).join('');
  }

  function detailTeamMarkup(team) {
    return `<div class="detail-team"><img class="detail-logo" src="${team.logo}" alt="${team.name} logo" onerror="this.style.display='none'"><strong>${team.name}</strong><span>${team.nick}</span></div>`;
  }

  function renderGameDetail(gameId) {
    const game = data.games.find(item => String(item.id) === String(gameId));
    if (!game) return;
    const detail = data.gameDetails[String(game.id)] || {};
    const isScheduled = detail.scheduled || game.status === 'FUT' || game.status === 'Preseason';
    const teamByShort = { [game.away.short]: game.away, [game.home.short]: game.home };
    const score = isScheduled ? '—' : `${game.away.score} : ${game.home.score}`;
    const scoring = detail.scoring || [];
    const penalties = detail.penalties || [];
    const boxscore = detail.boxscore || {};
    const goalies = detail.goalies || [];

    $('#gameDetailContent').innerHTML = `
      <div class="detail-hero">
        <div class="detail-status status ${game.status === 'Live' ? 'live' : isScheduled ? 'future' : 'final'}">${statusLabel(game.status)}</div>
        <div class="detail-scoreboard">${detailTeamMarkup(game.away)}<div class="detail-score"><strong>${score}</strong><span>${isScheduled ? game.time : game.period || ''}</span></div>${detailTeamMarkup(game.home)}</div>
        <div class="detail-venue">${detail.venue || 'NHL Arena'}${detail.attendance ? ` · ${detail.attendance} зрителей` : ''}</div>
      </div>
      ${isScheduled ? `<div class="detail-notice"><strong>Матч ещё не начался</strong><span>Подробная статистика появится после стартового вбрасывания.</span></div>` : `
        <section class="detail-section"><div class="detail-section-title"><h3>Голы</h3><span>${scoring.length}</span></div>
          <div class="scoring-list">${scoring.map(event => `<div class="scoring-row"><span class="event-time">${event.period}<br><strong>${event.time}</strong></span><span class="event-team">${event.team}</span><div><strong>${event.scorer}</strong><small>${event.assists?.length ? `ассисты: ${event.assists.join(', ')}` : 'без ассистов'}</small></div></div>`).join('') || '<p class="empty-detail">Пока без голов</p>'}</div>
        </section>
        <section class="detail-section"><div class="detail-section-title"><h3>Командная статистика</h3></div>
          <div class="boxscore-table"><div class="boxscore-head"><span>Команда</span><span>Броски</span><span>Силовые</span><span>Вбрасывания</span><span>Большинство</span></div>${[game.away, game.home].map(team => { const stats = boxscore[team.short] || {}; return `<div class="boxscore-row"><strong><img src="${team.logo}" alt="">${team.short}</strong><span>${stats.shots ?? '—'}</span><span>${stats.hits ?? '—'}</span><span>${stats.faceoff ?? '—'}</span><span>${stats.powerPlay ?? '—'}</span></div>`; }).join('')}</div>
        </section>
        ${penalties.length ? `<section class="detail-section"><div class="detail-section-title"><h3>Удаления</h3><span>${penalties.length}</span></div><div class="penalty-list">${penalties.map(item => `<div class="penalty-row"><span>${item.period} ${item.time}</span><strong>${item.team} · ${item.player}</strong><small>${item.minutes} мин · ${item.infraction}</small></div>`).join('')}</div></section>` : ''}
        ${goalies.length ? `<section class="detail-section"><div class="detail-section-title"><h3>Вратари</h3></div><div class="goalie-lines">${goalies.map(goalie => `<div class="goalie-line"><span class="line-team">${teamByShort[goalie.team]?.short || goalie.team}</span><strong>${goalie.name}</strong><span>${goalie.saves} сейвов · GAA ${goalie.gaa}</span></div>`).join('')}</div></section>` : ''}
      `}`;
    showPanel('game-detail');
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

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('visible');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => node.classList.remove('visible'), 1500);
  }

  $$('.nav-item').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.nav)));
  $$('.segment[data-standings-tab]').forEach(button => button.addEventListener('click', () => {
    $$('[data-standings-tab]').forEach(item => item.classList.toggle('is-selected', item === button));
    renderStandings(button.dataset.standingsTab);
  }));
  $$('.segment[data-stats-tab]').forEach(button => button.addEventListener('click', () => {
    $$('[data-stats-tab]').forEach(item => item.classList.toggle('is-selected', item === button));
    renderStats(button.dataset.statsTab);
  }));
  $('#gamesList').addEventListener('click', event => {
    const card = event.target.closest('[data-game-id]');
    if (card) renderGameDetail(card.dataset.gameId);
  });
  $('#gamesList').addEventListener('keydown', event => {
    const card = event.target.closest('[data-game-id]');
    if (card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      renderGameDetail(card.dataset.gameId);
    }
  });
  $('#gameDetailBack').addEventListener('click', () => showPanel('results'));
  $('#refreshButton').addEventListener('click', () => { renderGames(); toast('Результаты обновлены'); });
  $('#profileButton').addEventListener('click', () => showPanel('settings'));
  $('#prevDay').addEventListener('click', () => toast('Предыдущий день недоступен в демо'));
  $('#nextDay').addEventListener('click', () => toast('Следующий день недоступен в демо'));
  $$('.toggle input').forEach(input => input.addEventListener('change', () => toast(input.checked ? 'Включено' : 'Выключено')));

  renderGames();
  renderStandings();
  renderStats();
})();
