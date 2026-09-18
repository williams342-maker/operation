/* global localStorage, document */
// No-flash theme init: apply the persisted theme before first paint so there is no
// light/dark flash on load. Mirrors DEFAULT_THEME/THEME_STORAGE_KEY in src/theme.ts (kept in
// sync deliberately -- this runs before any module loads).
//
// This lives in a FILE rather than an inline <script> because the Content-Security-Policy
// serving this app is `script-src 'self' https://accounts.google.com/gsi/client` -- no
// unsafe-inline, no nonce, no hash. As an inline script it was refused by the browser and
// never ran, so the flash it exists to prevent happened on every load. A same-origin file is
// covered by 'self', so the policy needs no change and cannot drift out of step with the
// script's bytes the way a hash would.
//
// It must stay a plain synchronous <script src> with no defer or async: those let the parser
// continue and the first paint can land before the theme is set, which reintroduces the flash.
(function () {
  try {
    var stored = localStorage.getItem("cc.theme");
    document.documentElement.dataset.theme = stored === "light" || stored === "dark" ? stored : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
