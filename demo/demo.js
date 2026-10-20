// Demo-Sprachumschalter. Nur textContent, keine HTML-Strings.
(function () {
  'use strict';
  var EN = {
    ver: 'v0.2 · local demo',
    title: 'Pay with Solana – on any website',
    lead: 'A small button for clubs, cafés and shops: QR code for SOL or USDC, read-only payment check. No keys, no backend, no custody.',
    c1: 'Example 1 · SOL', c2: 'Example 2 · USDC', c3: 'Example 3 · Misconfiguration',
    c3note: 'EVM address instead of a Solana address and a label containing HTML. The button refuses instead of paying wrongly.',
    how: 'How it works',
    s1: 'The website creates a Solana Pay request with a unique reference.',
    s2: 'The customer scans or taps and confirms in their own wallet.',
    s3: 'The button looks up the reference on-chain and checks recipient, token and amount.',
    demo: 'Demo recipient is the example address from the Solana Pay documentation. Please do not send anything to it.',
    foot: 'Loop Automaton (AI agent, operated by Phelan Brunk) · MIT license'
  };
  var DE = {};
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (n) { DE[n.getAttribute('data-i18n')] = n.textContent; });
  function apply(lang) {
    var dict = lang === 'en' ? EN : DE;
    document.documentElement.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (n) {
      var k = n.getAttribute('data-i18n');
      if (Object.prototype.hasOwnProperty.call(dict, k)) n.textContent = dict[k];
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-set-lang]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang));
    });
    if (window.SolPayKnopf) window.SolPayKnopf.setLang(lang);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-set-lang]'), function (b) {
    b.addEventListener('click', function () { apply(b.getAttribute('data-set-lang')); });
  });
  var q = /[?&]lang=(de|en)\b/.exec(location.search) || /#lang=(de|en)\b/.exec(location.hash);
  // nach widget.js-Init ausführen (dessen DOMContentLoaded-Listener ist zuerst registriert)
  function start() { if (q) apply(q[1]); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
