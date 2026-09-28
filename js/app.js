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

  function renderGames() {
    $('#gamesList').innerHTML = data.games.map(game => {
      const isFuture = game.status === 'FUT' || game.status === 'Preseason';
      const score = isFuture ? `<span class="score time">${game.time.replace('Завтра, ', '')}</span>` : `<span class="score">${game.away.score}<span class="score-divider">:</span>${game.home.score}</span>`;
      const label = game.status === 'Live' ? 'LIVE' : game.status;
      const statusClass = game.status === 'Live' ? 'live' : isFuture ? 'future' : game.status === 'Preseason' ? 'preseason' : 'final';
      return `<article class="game-card">
        <div class="game-meta"><span>${game.time}</span><span class="status ${statusClass}">${label}</span></div>
        <div class="game-body">${teamMarkup(game.away, 'away')}<div class="game-score">${score}${game.period ? `<div class="period">${game.period}</div>` : ''}</div>${teamMarkup(game.home, 'home')}</div>
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
    $('#statsList').innerHTML = data.stats[type].map((player, index) => {
      const initials = player[0].split(' ').map(part => part[0]).join('').slice(0, 2);
      return `<div class="leader-card"><span class="player-rank">${String(index + 1).padStart(2, '0')}</span><div class="player-avatar">${initials}</div><div class="player-copy"><strong>${player[0]}</strong><span>${player[1]} · ${player[2]}</span></div><div class="player-stat"><strong>${player[3]}</strong><span>${type === 'rookies' ? 'очков' : 'очков'}</span></div></div>`;
    }).join('');
  }

  function showPanel(name) {
    $$('.panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.panel === name));
    $$('.nav-item').forEach(button => {
      const active = button.dataset.nav === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
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
  $('#refreshButton').addEventListener('click', () => { renderGames(); toast('Результаты обновлены'); });
  $('#profileButton').addEventListener('click', () => showPanel('settings'));
  $('#prevDay').addEventListener('click', () => toast('Предыдущий день недоступен в демо'));
  $('#nextDay').addEventListener('click', () => toast('Следующий день недоступен в демо'));
  $$('.toggle input').forEach(input => input.addEventListener('change', () => toast(input.checked ? 'Включено' : 'Выключено')));

  renderGames();
  renderStandings();
  renderStats();
})();
