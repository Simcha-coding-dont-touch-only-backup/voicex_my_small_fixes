(function () {
  var RELOAD_KEY = 'voicex:stale-reload';
  function forceReload(reason) {
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch (_) {}
    console.warn('[voicex] stale deploy detected, reloading:', reason);
    var url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
  }
  window.addEventListener(
    'error',
    function (ev) {
      var t = ev && ev.target;
      if (!t || t === window) return;
      var src = t.src || t.href;
      if (!src) return;
      if (/\/assets\/index-.*\.(js|css)(\?|$)/.test(src)) {
        forceReload('asset failed: ' + src);
      }
    },
    true
  );
  window.addEventListener('unhandledrejection', function (ev) {
    var msg = ev && ev.reason && (ev.reason.message || String(ev.reason));
    if (msg && /Failed to (fetch dynamically imported|load module script)/i.test(msg)) {
      forceReload('dynamic import failed: ' + msg);
    }
  });
  window.addEventListener('load', function () {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch (_) {}
  });
})();
