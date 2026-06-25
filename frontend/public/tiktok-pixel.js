/*!
 * iter413ci — TikTok Pixel base code (sdkid=D8UP6SJC77UCR7H8US60).
 *
 * Lives in /public/ so it's served as-is — webpack/terser never touch it.
 * Why this matters: when the snippet is inlined in index.html, CRA's
 * html-webpack-plugin minifies inline scripts and renames the literal
 * `ttq` local variable. TikTok's verification crawler does a literal
 * substring match for `ttq.load("PIXEL_ID")`, and can't find it after
 * minification — surface error: "We can't detect pixel … base code on
 * your page." Serving this file un-minified guarantees the literal
 * snippet is present in the script source TikTok fetches.
 *
 * SPA route-change `page()` calls happen from src/lib/analytics.js
 * (window.ttq.page() inside trackPageview).
 */
!function (w, d, t) {
  w.TiktokAnalyticsObject = t;
  var ttq = w[t] = w[t] || [];
  ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
  ttq.setAndDefer = function (t, e) {
    t[e] = function () {
      t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
    };
  };
  for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
  ttq.instance = function (t) {
    for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
    return e;
  };
  ttq.load = function (e, n) {
    var r = "https://analytics.tiktok.com/i18n/pixel/events.js";
    var o = n && n.partner;
    ttq._i = ttq._i || {};
    ttq._i[e] = [];
    ttq._i[e]._u = r;
    ttq._t = ttq._t || {};
    ttq._t[e] = +new Date();
    ttq._o = ttq._o || {};
    ttq._o[e] = n || {};
    n = document.createElement("script");
    n.type = "text/javascript";
    n.async = !0;
    n.src = r + "?sdkid=" + e + "&lib=" + t;
    e = document.getElementsByTagName("script")[0];
    e.parentNode.insertBefore(n, e);
  };

  ttq.load('D8UP6SJC77UCR7H8US60');
  ttq.page();
}(window, document, 'ttq');
