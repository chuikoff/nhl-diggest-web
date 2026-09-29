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

Сейчас используется демонстрационный день из `js/mock-data.js`, включая локальные SVG placeholder-логотипы. В `js/config.js` есть глобальная конфигурация `window.NHL_API_BASE` (пустая по умолчанию) и заготовки `window.NHL_API.getGames()`, `getStandings()` и `getStats()`. Когда API на VPS будет готов, укажите базовый URL и подключите ответы к рендерам в `js/app.js`.

Настройки и переключатели пока UI-only; ничего не отправляется и не сохраняется на сервере.
