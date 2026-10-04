# NHL Diggest

Статический фронтенд Mini App для **Telegram** и **Max**: результаты NHL, карточки команд и игроков, турнирная таблица, статистика и настройки. Один и тот же URL работает в обоих мессенджерах. Интерфейс по умолчанию на русском, названия команд и игроков — на английском.

Live: <https://chuikoff.github.io/nhl-diggest-web/>

## Домашний экран (PWA)

Тот же URL можно установить на телефон без Telegram и Max. Push-уведомлений нет.

- **iPhone / iPad (Safari):** открыть ссылку в Safari → «Поделиться» → «На экран Домой».
- **Android (Chrome):** открыть ссылку → меню ⋮ → «Установить приложение» или «Добавить на главный экран».

GitHub Pages отдаёт сайт по HTTPS, так что критерии установки выполнены. Оболочка (index, css, js) кэшируется service worker с именем `nhl-digest-shell-<версия>`; ответы API не кэшируются. Версия кэша совпадает с `?v=` в `index.html`.

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

1. **VPS cache** (`window.NHL_CACHE_BASE`, bot on VPS) — finished games only (`GET /api/games/{id}`). Preferred for boxscore / scoring / three stars; headshots remain CDN URLs.
2. **NHL api-web** — `https://api-web.nhle.com` (после cache miss; те же пути, что у бота в `/workspace/nhl-diggest`):
   - `/v1/score/{YYYY-MM-DD}`, `/v1/schedule/{YYYY-MM-DD}`
   - `/v1/standings/now` (если GP=0 — fallback на финал прошлого сезона `/v1/standings/2026-04-14`)
   - `/v1/gamecenter/{id}/landing` + `/boxscore`
   - `/v1/roster/{ABB}/current`, `/v1/club-schedule-season/{ABB}/now`, `/v1/club-stats/{ABB}/now`
   - `/v1/player/{id}/landing`
   - `/v1/skater-stats-leaders/{season}/{gameType}`, `/v1/goalie-stats-leaders/...`
3. **ESPN** (если cache/NHL недоступны из браузера) — CORS `Access-Control-Allow-Origin: *`:
   - `site.api.espn.com` scoreboard / summary / standings / teams/{slug}(+roster,schedule,statistics)
   - `site.web.api.espn.com` statistics/byathlete · athletes/{id}(+overview)
   - `sports.core.api.espn.com` athlete statistics (hits / blocked shots / goalie metrics)
   - `sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/leaders` — **all-time / career** boards
4. **Mock** (`js/mock-data.js`) — только если cache + NHL + ESPN упали.

### CORS (проверено 2026-09-29)

| Host | CORS из браузера |
| --- | --- |
| `api-web.nhle.com` | **нет** ACAO — `fetch` из GitHub Pages / TG / Max WebView обычно падает |
| `api.nhle.com` | **нет** ACAO |
| `site.api.espn.com`, `site.web.api.espn.com`, `sports.core.api.espn.com` | **да** (`*`) |

Для **завершённых** матчей клиент **сначала** пробует VPS cache (`NHL_CACHE_BASE`), затем NHL, затем ESPN. Бейдж источника: `nhl-cache` / `NHL` / `ESPN` / `демо`.

### День и часовой пояс

«Сегодня» и подпись даты считаются в **Europe/Moscow**. Стрелки грузят расписание на любую дату (`score/{date}`), а время старта форматируется в MSK. Статусы: FUT / LIVE / FINAL (+ метка предсезона при `gameType=1`).

### Статистика (сезон)

Отдельная вкладка **Статистика** (сезонные лидеры):

- Скейттеры / новички: очки, голы, передачи, силовые, +/−, штрафы (PIM), блоки, время (TOI)
- Вратари: GAA, сухие, SV%, победы

Источники сезона: NHL `/v1/skater-stats-leaders/{season}/{gameType}` и `/v1/goalie-stats-leaders/...`, fallback ESPN `site.web.api` byathlete + `sports.core` athlete statistics.

### За всё время (карьера)

Переключатель **«За всё время»** находится внутри вкладки **«Статистика»** рядом с сезонными лидерами (all-time / career):

- Скейттеры: очки, голы, передачи, штрафы (PIM)
- Вратари: победы, сухие (SO); GAA и SV% считаются по карьерным splits топ-победителей (мин. ~200 игр)
- Hits / +/− / blocks / TOI в ESPN career leaders **нет** — доски не показываем

Endpoint (CORS `*`):

- `GET https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/leaders?limit=15`
- Athlete resolve: `.../athletes/{id}` (+ optional team `$ref`)
- GAA/SV%: `.../athletes/{id}/statistics/0`

### Команда и игрок

Из **Результатов** / **карточки матча** (и турнирной) имена и логотипы команд кликабельны → экран команды:

- инфо (город, арена, конференция/дивизион, рекорд)
- состав (россияне подсвечены жёлтым)
- расписание (ближайшие / недавние)
- командная статистика

Состав, лидеры статистики и имена в матче кликабельны → экран игрока (фото, флаг страны по `birthCountry`/nationality, био, сезон, карьера).

**Трофеи / награды / флаг / контракт на карточке игрока:**
- флаг страны: emoji + flagcdn fallback; ISO/IOC коды, ESPN `birthCountry`/`citizenship`, провинции/штаты (`ON`→CA, `NY`→US), парсинг `birthCity` / `City, Country`
- секция **Трофеи** → **Сборная** (Олимпиада / ЧМ / МЧМ U20 / U18 — медали и участие) из `assets/nhl-trophies.json` для **всех национальностей** (CAN/USA/SWE/FIN/CZE/DEU/… + RUS), не только curated-Russia; плюс sparse curated fallback. **Клубные**: Кубок Стэнли (NHL landing + index) и **Кубок Гагарина** KHL
- **Индивидуальные награды**: Hart, Richard, Calder… из NHL/ESPN. **NHL First All-Star Team** всегда из historical index (Wikipedia / Hockey-Reference) — ESPN часто отдаёт только Second; Second тоже дополняется из index. Curated All-Star — только gap-fill по конкретному award name
- **Контракт**: cap hit / до сезона (UFA·RFA year) — из **PuckPedia** snapshot `assets/cap-hits.json` (ключ NHL player id); fallback NHL landing / ESPN `/contracts` (часто пусто)
- пустые группы скрываются; если трофеев нет — мягкий empty state

**На карточке команды:**
- **Клубные трофеи** по годам: Stanley Cup, Presidents' Trophy, Campbell Bowl, Prince of Wales (из NHL records → `assets/nhl-trophies.json`)
- **Закреплённые номера** с именем хоноре (Wikipedia NHL retired numbers)
- **Зарплатная капа** команды (projected cap hit + cap space / потолок NHL) — из **PuckPedia** `assets/cap-hits.json` по abbrev

Назад: кнопка «Назад», **swipe right-to-left** или **свайп от левого края** (как «к результатам»).

Endpoints (NHL → ESPN fallback, CORS `*` у ESPN):

| Что | NHL api-web | ESPN |
| --- | --- | --- |
| Команда | `/v1/roster/{ABB}/current`, `/v1/club-schedule-season/{ABB}/now`, `/v1/club-stats/{ABB}/now`, `/v1/standings/now` | `/apis/site/v2/sports/hockey/nhl/teams/{slug}`, `/roster`, `/schedule`, `/statistics` |
| Игрок | `/v1/player/{id}/landing` (включая awards) | `site.web.api` `/apis/common/v3/sports/hockey/nhl/athletes/{id}` + `/overview`; награды — `sports.core.api.espn.com/.../athletes/{id}/awards` |

### Cap hits (PuckPedia)

Публичный API PuckPedia платный; Mini App на GitHub Pages не ходит на puckpedia.com из браузера (CORS). Вместо этого:

1. Скрипт `scripts/fetch_puckpedia_caps.py` скрейпит HTML homepage + `/team/{slug}` (roster `data-extract_ch` + `nhl_id` из embed).
2. Пишет `assets/cap-hits.json` (`teams` по abbrev, `playersByNhlId`).
3. `js/api.js` подгружает JSON и заполняет карточку игрока / зарплатную капу команды.

Обновить данные:

```bash
python3 scripts/fetch_puckpedia_caps.py
# затем commit + push assets/cap-hits.json
```

Источник цифр: [puckpedia.com](https://puckpedia.com). Не выдумывать значения вручную.

### Детали матча

Голы и удаления группируются **по периодам** (P1 / P2 / P3 / OT / SO) из NHL landing `summary.scoring|penalties` или ESPN `summary.plays`.

**Удаления (fix 2026-09-29):** ESPN penalty plays имеют `type.text` = инфракция (`Hooking`, `Interference`, …), а не слово `Penalty`. Детект идёт по `type.penaltyMinutes` / `type.penaltyType`. У NHL имя нарушителя лежит в `committedByPlayer.firstName/lastName` (не на корне penalty-объекта).

**Обзор матча:** ESPN `summary.videos` → ролик «Game Highlights» (inline `<video>` при `.mp4`). Для NHL-игр дополнительно ищем тот же recap по дате/командам на ESPN; иначе ссылка NHL `threeMinRecap` / `condensedGame` (nhl.com).

**Клипы голов (experimental):** если есть URL — кнопка ▶ у гола. NHL: `highlightClipSharingUrl` (внешний WebView). ESPN: mp4 из `summary.videos` по имени скорera; inline `<video>` при `.mp4`, иначе `openLink`. Soft-fail, если клипа нет.

Логотипы: ESPN CDN PNG (`a.espncdn.com/i/teamlogos/nhl/500/{slug}.png`), slug-исключения как в боте (`LAK→la`, `SJS→sj`, `UTA→utah`, …).

Конфиг: `js/config.js` (`NHL_CACHE_BASE`, `NHL_API_BASE`, сезоны). Логика: `js/api.js`. UI: `js/app.js`. TG+Max bridge без изменений (`js/bridge.js`).

**Избранное (localStorage `nhl-diggest-favorites`):**
- на карточке игрока и странице команды — кнопка ★ / ☆
- в **Настройках** списки избранных команд и игроков с удалением (×); тап открывает карточку
- избранные подсвечены золотым в результатах (матчи с любимой командой), турнирной, лидерах статистики, составе
- синхронизация с Telegram/Max ботом — опционально позже

Переключатель темы сохраняется локально и учитывает тему Telegram/Max.
