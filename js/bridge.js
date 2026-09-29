/**
 * Dual Mini App bridge: Telegram (Telegram.WebApp) + Max (window.WebApp).
 * Soft-fails when a host script is missing so browser preview still works.
 */
(() => {
  'use strict';

  const TG_PLATFORMS = new Set([
    'android', 'android_x', 'ios', 'macos', 'tdesktop', 'weba', 'webk', 'web', 'unigram'
  ]);
  const MAX_PLATFORMS = new Set(['ios', 'android', 'desktop', 'web']);

  function hasHashParam(name) {
    try {
      const hash = (location.hash || '').replace(/^#/, '');
      return Boolean(hash && new URLSearchParams(hash).get(name));
    } catch {
      return false;
    }
  }

  function isTelegramHost() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return false;
    if (typeof tg.initData === 'string' && tg.initData.length > 0) return true;
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) return true;
    if (typeof tg.platform === 'string' && TG_PLATFORMS.has(tg.platform)) return true;
    if (typeof navigator !== 'undefined' && /Telegram/i.test(navigator.userAgent || '')) return true;
    return false;
  }

  function isMaxHost() {
    const max = window.WebApp;
    // Max bridge always installs window.WebApp when the script loads; require host signals.
    if (!max || typeof max.ready !== 'function') return false;
    if (typeof max.initData === 'string' && max.initData.length > 0) return true;
    if (max.initDataUnsafe && max.initDataUnsafe.user) return true;
    if (typeof max.platform === 'string' && MAX_PLATFORMS.has(max.platform)) return true;
    if (typeof window.WebViewHandler !== 'undefined') return true;
    if (hasHashParam('WebAppData') || hasHashParam('WebAppPlatform')) return true;
    try {
      const ref = document.referrer || '';
      if (/max\.ru|oneme\.ru/i.test(ref)) return true;
    } catch { /* ignore */ }
    return false;
  }

  function detectEnvironment() {
    // Prefer the host that actually launched us (init data / platform).
    const tg = isTelegramHost();
    const max = isMaxHost();
    if (tg && !max) return 'telegram';
    if (max && !tg) return 'max';
    if (tg && max) {
      const tgData = window.Telegram?.WebApp?.initData || '';
      const maxData = window.WebApp?.initData || '';
      if (tgData && !maxData) return 'telegram';
      if (maxData && !tgData) return 'max';
      // Both present: Max uses window.WebApp; Telegram uses Telegram.WebApp — prefer Telegram
      // only when its platform is a real client (Max iframe heuristic is weaker).
      if (TG_PLATFORMS.has(window.Telegram?.WebApp?.platform || '')) return 'telegram';
      return 'max';
    }
    return 'browser';
  }

  function normalizeTheme(value) {
    if (typeof value !== 'string') return null;
    const theme = value.toLowerCase();
    if (theme === 'light' || theme === 'day') return 'light';
    if (theme === 'dark' || theme === 'night') return 'dark';
    return null;
  }

  function detectTheme(source) {
    if (!source) return null;
    const direct = normalizeTheme(source.colorScheme || source.theme || source.appearance);
    if (direct) return direct;
    const params = source.themeParams || source.theme_params || {};
    const paramTheme = normalizeTheme(params.colorScheme || params.color_scheme || params.theme);
    if (paramTheme) return paramTheme;
    // A light background is a useful fallback for bridges that expose only colors.
    const background = params.bg_color || params.bgColor;
    if (typeof background === 'string' && /^#?[0-9a-f]{6}$/i.test(background)) {
      const hex = background.replace('#', '');
      const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
      const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      return luminance > 0.62 ? 'light' : 'dark';
    }
    return null;
  }

  function setHostColors(theme, env) {
    const dark = theme !== 'light';
    const header = dark ? '#0c111b' : '#f5f7fb';
    const background = dark ? '#080d15' : '#eef2f7';
    const tg = window.Telegram?.WebApp;
    const max = window.WebApp;
    if (env === 'telegram' && tg) {
      tg.setHeaderColor?.(header);
      tg.setBackgroundColor?.(background);
    }
    if (env === 'max' && max) {
      max.setHeaderColor?.(header);
      max.setBackgroundColor?.(background);
    }
  }

  function initTelegram() {
    const tg = window.Telegram?.WebApp;
    if (!tg) return false;
    try {
      tg.ready();
      tg.expand?.();
      setHostColors('dark', 'telegram');
      return true;
    } catch (err) {
      console.warn('[NHL Diggest] Telegram WebApp init failed:', err);
      return false;
    }
  }

  function initMax() {
    const max = window.WebApp;
    if (!max || typeof max.ready !== 'function') return false;
    try {
      // Notify Max host that the Mini App is ready (required for display).
      max.ready();
      // Current max-web-app.js has no expand(); call only if a future bridge adds it.
      if (typeof max.expand === 'function') max.expand();
      return true;
    } catch (err) {
      console.warn('[NHL Diggest] Max WebApp init failed:', err);
      return false;
    }
  }

  function init() {
    const env = detectEnvironment();
    let ready = false;

    if (env === 'telegram') {
      // Keep Telegram path identical in spirit: ready + expand + theme colors.
      ready = initTelegram();
    } else {
      // Max (and browser soft-fail): always notify Max bridge when present.
      // Some Max WebViews expose initData/platform only after WebAppReady.
      const maxOk = initMax();
      if (env === 'max') ready = maxOk;
      // Browser preview stays usable even if Max CDN failed (initMax returns false).
    }

    const host = env === 'telegram' ? window.Telegram?.WebApp : env === 'max' ? window.WebApp : null;
    const initialTheme = detectTheme(host) || 'dark';
    const themeListeners = new Set();
    const applyTheme = theme => {
      const nextTheme = normalizeTheme(theme) || 'dark';
      const changed = document.documentElement.dataset.theme !== nextTheme;
      document.documentElement.dataset.theme = nextTheme;
      setHostColors(nextTheme, env);
      if (changed) themeListeners.forEach(listener => listener(nextTheme));
      return nextTheme;
    };
    document.documentElement.dataset.messenger = env;
    document.documentElement.dataset.theme = initialTheme;
    if (document.body) document.body.dataset.messenger = env;
    setHostColors(initialTheme, env);

    const subscribeToHostTheme = () => {
      ['themeChanged', 'theme_changed'].forEach(eventName => {
        try { host?.onEvent?.(eventName, () => applyTheme(detectTheme(host) || initialTheme)); } catch { /* optional host API */ }
      });
    };
    subscribeToHostTheme();

    const openLink = (url, options = {}) => {
      if (!url || typeof url !== 'string') return false;
      try {
        if (env === 'telegram' && typeof window.Telegram?.WebApp?.openLink === 'function') {
          window.Telegram.WebApp.openLink(url, options?.tryInstantView ? { try_instant_view: true } : undefined);
          return true;
        }
        if (env === 'max' && typeof window.WebApp?.openLink === 'function') {
          window.WebApp.openLink(url);
          return true;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
      } catch (err) {
        console.warn('[NHL Diggest] openLink failed', err);
        return false;
      }
    };

    window.NHL_BRIDGE = {
      env,
      ready,
      isTelegram: env === 'telegram',
      isMax: env === 'max',
      isBrowser: env === 'browser',
      theme: initialTheme,
      getTheme: () => detectTheme(host) || initialTheme,
      applyTheme,
      openLink,
      subscribeTheme: listener => { themeListeners.add(listener); return () => themeListeners.delete(listener); },
      telegram: window.Telegram?.WebApp || null,
      max: window.WebApp && typeof window.WebApp.ready === 'function' ? window.WebApp : null
    };

    return window.NHL_BRIDGE;
  }

  // Run immediately when this script loads (after host bridge scripts).
  init();
})();
