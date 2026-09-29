# NHL Diggest

Статический фронтенд Mini App для **Telegram** и **Max**: результаты NHL, турнирная таблица, статистика игроков и пользовательские настройки. Один и тот же URL работает в обоих мессенджерах. Интерфейс по умолчанию на русском, названия команд и игроков — на английском.

Live: <https://chuikoff.github.io/nhl-diggest-web/>

## Локальный просмотр

Сборка и зависимости не нужны. Из каталога проекта запустите любой простой HTTP-сервер:

```bash
cd nhl-diggest-web
python3 -m http.server 8080
```

Затем откройте <http://localhost:8080>. Можно открыть `index.html` напрямую, но HTTP-сервер лучше показывает поведение bridge-скриптов и локальных ресурсов.

## GitHub Pages

1. Создайте GitHub-репозиторий и загрузите содержимое этого каталога в корень репозитория (важно: `index.html` должен находиться в корне).
2. Откройте **Settings → Pages**.
3. В разделе **Build and deployment** выберите **Deploy from a branch**, ветку (например, `main`) и папку **`/ (root)`**, затем нажмите **Save**.
4. Дождитесь URL вида `https://<username>.github.io/<repository>/`.

Проект не требует Node.js, сборщика или GitHub Actions. Пути к ассетам относительные (`./css`, `./js`, `./assets`); в `index.html` выставляется `<base>` по текущему pathname, чтобы сайт открывался и с `/nhl-diggest-web`, и с `/nhl-diggest-web/`.

## Свой домен

Замените содержимое файла `CNAME` на домен одной строкой, например:

```text
nhl.example.com
```

После этого в настройках Pages укажите этот домен и включите **Enforce HTTPS** после выпуска сертификата. У регистратора добавьте DNS: обычно `CNAME nhl -> <username>.github.io` (точные записи зависят от корневого или поддомена).

## Один URL для Telegram и Max

Используйте **один и тот же** HTTPS URL Mini App (например `https://chuikoff.github.io/nhl-diggest-web/`) в:

1. **Telegram** — @BotFather → бот → **Bot Settings → Menu Button → Configure menu button** (подпись + URL).
2. **Max** — платформа партнёров → чат-бот → настройки → поле URL мини-приложения (кнопка Открыть / Старт / Играть).

Приложение само определяет окружение:

| Среда | Bridge | Init |
| --- | --- | --- |
| Telegram | `https://telegram.org/js/telegram-web-app.js` → `window.Telegram.WebApp` | `ready()`, `expand()`, цвета шапки |
| Max | `https://st.max.ru/js/max-web-app.js` → `window.WebApp` | `ready()` (и `expand()` если появится в bridge) |
| Браузер | скрипты soft-fail | демо без host API |

Логика в `js/bridge.js`. Telegram-путь не менялся по смыслу: те же `ready()` / `expand()` / цвета. Max получает `WebApp.ready()`, без которого хост часто не показывает WebView.

## Данные и API

Мини-приложение **тянет живые данные** прямо из браузера (статический GitHub Pages, без своего бэкенда).

### Источники (порядок)

1. **NHL api-web** — `https://api-web.nhle.com` (те же пути, что у бота в `/workspace/nhl-diggest`):
   - `/v1/score/{YYYY-MM-DD}`, `/v1/schedule/{YYYY-MM-DD}`
   - `/v1/standings/now` (если GP=0 — fallback на финал прошлого сезона `/v1/standings/2026-04-14`)
   - `/v1/gamecenter/{id}/landing` + `/boxscore`
   - `/v1/skater-stats-leaders/{season}/{gameType}`, `/v1/goalie-stats-leaders/...`
2. **ESPN** (если NHL недоступен из браузера) — CORS `Access-Control-Allow-Origin: *`:
   - `site.api.espn.com` scoreboard / summary / standings
   - `site.web.api.espn.com` statistics/byathlete
   - `sports.core.api.espn.com` athlete statistics (hits / blocked shots / goalie metrics)
   - `sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/leaders` — **all-time / career** boards
3. **Mock** (`js/mock-data.js`) — только если оба live-источника упали.

### CORS (проверено 2026-09-29)

| Host | CORS из браузера |
| --- | --- |
| `api-web.nhle.com` | **нет** ACAO — `fetch` из GitHub Pages / TG / Max WebView обычно падает |
| `api.nhle.com` | **нет** ACAO |
| `site.api.espn.com`, `site.web.api.espn.com`, `sports.core.api.espn.com` | **да** (`*`) |

Клиент всё равно **сначала** пробует NHL (как в боте); при ошибке автоматически уходит на ESPN. Бейдж источника на экране результатов показывает `NHL` / `ESPN` / `демо`.

### День и часовой пояс

«Сегодня» и подпись даты считаются в **Europe/Moscow**. Стрелки грузят расписание на любую дату (`score/{date}`), а время старта форматируется в MSK. Статусы: FUT / LIVE / FINAL (+ метка предсезона при `gameType=1`).

### Статистика (сезон)

Отдельная вкладка **Статистика** (сезонные лидеры):

- Скейттеры / новички: очки, голы, передачи, силовые, +/−, штрафы (PIM), блоки, время (TOI)
- Вратари: GAA, сухие, SV%, победы

Источники сезона: NHL `/v1/skater-stats-leaders/{season}/{gameType}` и `/v1/goalie-stats-leaders/...`, fallback ESPN `site.web.api` byathlete + `sports.core` athlete statistics.

### За всё время (карьера)

Отдельная нижняя вкладка **«За всё время»** (all-time / career), не смешивается с сезонной:

- Скейттеры: очки, голы, передачи, штрафы (PIM)
- Вратари: победы, сухие (SO); GAA и SV% считаются по карьерным splits топ-победителей (мин. ~200 игр)
- Hits / +/− / blocks / TOI в ESPN career leaders **нет** — доски не показываем

Endpoint (CORS `*`):

- `GET https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/leaders?limit=15`
- Athlete resolve: `.../athletes/{id}` (+ optional team `$ref`)
- GAA/SV%: `.../athletes/{id}/statistics/0`

### Детали матча

Голы и удаления группируются **по периодам** (P1 / P2 / P3 / OT / SO) из NHL landing `summary.scoring|penalties` или ESPN `summary.plays`.

**Удаления (fix 2026-09-29):** ESPN penalty plays имеют `type.text` = инфракция (`Hooking`, `Interference`, …), а не слово `Penalty`. Детект идёт по `type.penaltyMinutes` / `type.penaltyType`. У NHL имя нарушителя лежит в `committedByPlayer.firstName/lastName` (не на корне penalty-объекта).

**Клипы голов (experimental):** если есть URL — кнопка ▶ у гола. NHL: `highlightClipSharingUrl` (открытие во внешнем WebView). ESPN: mp4 из `summary.videos`, матч по имени скорera в headline; inline `<video>` при `.mp4`, иначе `openLink`. Soft-fail, если клипа нет.

Логотипы: ESPN CDN PNG (`a.espncdn.com/i/teamlogos/nhl/500/{slug}.png`), slug-исключения как в боте (`LAK→la`, `SJS→sj`, `UTA→utah`, …).

Конфиг: `js/config.js` (`NHL_API_BASE`, сезоны). Логика: `js/api.js`. UI: `js/app.js`. TG+Max bridge без изменений (`js/bridge.js`).

Переключатель темы сохраняется локально и учитывает тему Telegram/Max; остальные настройки пока UI-only.
