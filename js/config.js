// Конфигурация API. Оставьте пустым для режима демо.
window.NHL_API_BASE = '';

window.NHL_API = {
  async get(path, options = {}) {
    if (!window.NHL_API_BASE) return null;
    const response = await fetch(`${window.NHL_API_BASE}${path}`, {
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (!response.ok) throw new Error(`NHL API: ${response.status}`);
    return response.json();
  },
  getGames(date) { return this.get(`/games?date=${encodeURIComponent(date)}`); },
  getStandings() { return this.get('/standings'); },
  getStats(type = 'scorers') { return this.get(`/stats?type=${encodeURIComponent(type)}`); }
};
