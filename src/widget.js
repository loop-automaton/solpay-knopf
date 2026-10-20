/*
 * solpay-knopf – widget v0.2 (DOM). Needs: core.js + qrcode-generator (MIT, kazuhikoarase).
 *   <div data-solpay data-recipient="<Adresse>" data-amount="5" data-token="USDC"
 *        data-label="Café am Markt" data-message="Gutschein" data-lang="de"></div>
 * Security: no HTML-string rendering anywhere – all text via textContent, QR built as SVG via DOM APIs.
 * Never asks for keys, never signs; the payer's own wallet does that.
 * License: MIT – see LICENSE
 */
(function () {
  'use strict';
  var Core = window.SolPayCore;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var T = {
    de: { pay: 'Mit Solana bezahlen', scan: 'QR-Code mit Phantom, Solflare o. ä. scannen', check: 'Zahlung prüfen',
          waiting: 'Warte auf Zahlung …', ok: 'Zahlung eingegangen ✔', bad: 'Zahlung ungültig: ', err: 'Fehler: ',
          view: 'Beleg auf Solscan', copy: 'Link kopieren', copied: 'Kopiert ✔', copyFail: 'Kopieren nicht möglich',
          timeout: 'Keine Zahlung gefunden. Bitte erneut prüfen.', rate: 'Netzwerk ausgelastet, neuer Versuch in Kürze …',
          offline: 'Solana-Netzwerk gerade nicht erreichbar. Später erneut prüfen.', config: 'Knopf falsch eingerichtet: ',
          qr: 'QR-Code für die Zahlung' },
    en: { pay: 'Pay with Solana', scan: 'Scan with Phantom, Solflare or similar', check: 'Check payment',
          waiting: 'Waiting for payment …', ok: 'Payment received ✔', bad: 'Invalid payment: ', err: 'Error: ',
          view: 'Receipt on Solscan', copy: 'Copy link', copied: 'Copied ✔', copyFail: 'Copy not available',
          timeout: 'No payment found yet. Please check again.', rate: 'Network busy, retrying shortly …',
          offline: 'Solana network unreachable right now. Please check again later.', config: 'Button misconfigured: ',
          qr: 'QR code for the payment' }
  };
  // Englische Texte für Konfigurationsfehler (core.js meldet auf Deutsch + Fehlercode)
  var EN_ERR = { RECIPIENT: 'invalid or unsupported recipient address', AMOUNT: 'invalid amount', TOKEN: 'unsupported token (SOL, USDC)',
                 TEXT: 'label/message/memo too long', MEMO: 'memo is public – no personal data', REFERENCE: 'invalid reference',
                 RPC_URL: 'RPC URL must be https:// without credentials' };
  function errText(e, l) { return l === 'en' && e && EN_ERR[e.code] ? EN_ERR[e.code] : (e && e.message) || 'unknown'; }
  var POLL_MS = 5000, MAX_POLLS = 120, MAX_BACKOFF_MS = 60000;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Build the QR as SVG using DOM APIs only (no HTML string parsing). */
  function qrSvg(text, label) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount(), m = 2, size = n + 2 * m;
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('shape-rendering', 'crispEdges');
    var title = document.createElementNS(SVG_NS, 'title');
    title.textContent = label;
    svg.appendChild(title);
    var bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
    svg.appendChild(bg);
    var d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', '#000');
    svg.appendChild(path);
    return svg;
  }

  function mount(node, options) {
    options = options || {};
    var d = node.dataset;
    var lang = (options.lang || d.lang) === 'en' ? 'en' : 'de';
    var t = T[lang];
    var reference = Core.randomReference();
    var url, rpcUrl, token, amount;
    while (node.firstChild) node.removeChild(node.firstChild);
    node.classList.add('solpay');
    try {
      token = Core.getToken(d.token);
      amount = d.amount ? Core.validateAmount(d.amount, token) : '';
      rpcUrl = Core.validateRpcUrl(d.rpc || 'https://api.mainnet-beta.solana.com');
      url = Core.buildTransferUrl({ recipient: d.recipient, amount: amount, token: token.symbol, references: [reference],
                                    label: d.label, message: d.message, memo: d.memo });
    } catch (e) {
      var errBox = el('p', 'solpay-status solpay-error', t.config + errText(e, lang));
      errBox.setAttribute('role', 'alert');
      node.appendChild(errBox);
      return { destroy: function () {}, error: e,
               setLang: function (l) { l = l === 'en' ? 'en' : 'de'; errBox.textContent = T[l].config + errText(e, l); } };
    }
    var expected = { recipient: d.recipient.trim(), amount: amount, token: token.symbol, reference: reference };

    var a = el('a', 'solpay-btn');
    a.setAttribute('href', url); // url ist validiert und beginnt immer mit "solana:"
    var qrBox = el('div', 'solpay-qr');
    var qrNode = qrSvg(url, t.qr);
    qrBox.appendChild(qrNode);
    var hint = el('p', 'solpay-hint');
    var row = el('div', 'solpay-row');
    var copy = el('button', 'solpay-copy'); copy.type = 'button';
    var check = el('button', 'solpay-check'); check.type = 'button';
    row.appendChild(copy); row.appendChild(check);
    var status = el('p', 'solpay-status');
    status.setAttribute('aria-live', 'polite');
    [a, qrBox, hint, row, status].forEach(function (c) { node.appendChild(c); });

    function paintTexts() {
      a.textContent = t.pay + (amount ? ' · ' + amount + ' ' + token.symbol : '');
      qrNode.firstChild.textContent = t.qr;
      hint.textContent = t.scan;
      copy.textContent = t.copy;
      check.textContent = t.check;
    }
    paintTexts();

    function setStatus(text, cls) {
      while (status.firstChild) status.removeChild(status.firstChild);
      status.className = 'solpay-status' + (cls ? ' ' + cls : '');
      status.textContent = text;
    }

    copy.addEventListener('click', function () {
      if (!navigator.clipboard) { copy.textContent = t.copyFail; return; }
      navigator.clipboard.writeText(url).then(function () { copy.textContent = t.copied; }, function () { copy.textContent = t.copyFail; });
    });

    var timer = null, tries = 0, backoff = POLL_MS, running = false, done = false;
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(poll, ms); }
    function poll() {
      if (done) return;
      if (typeof document !== 'undefined' && document.hidden) { schedule(POLL_MS); return; } // Tab im Hintergrund: nicht pollen
      if (running) return;
      running = true;
      if (!status.textContent || status.className.indexOf('solpay-wait') >= 0) setStatus(t.waiting, 'solpay-wait');
      Core.findPayment(rpcUrl, expected, options.rpcOptions).then(function (r) {
        running = false;
        backoff = POLL_MS;
        if (r.status === 'pending') {
          if (++tries < MAX_POLLS) schedule(POLL_MS); else setStatus(t.timeout, 'solpay-warn');
          return;
        }
        done = r.status === 'confirmed';
        setStatus(r.status === 'confirmed' ? t.ok : t.bad + r.reason, r.status === 'confirmed' ? 'solpay-ok' : 'solpay-error');
        if (Core.isSignature(r.signature)) {
          var link = el('a', 'solpay-link', t.view);
          link.setAttribute('href', 'https://solscan.io/tx/' + encodeURIComponent(r.signature));
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
          status.appendChild(document.createTextNode(' '));
          status.appendChild(link);
        }
        node.dispatchEvent(new CustomEvent('solpay:' + r.status, { detail: { status: r.status, signature: r.signature, code: r.code }, bubbles: true }));
      }).catch(function (e) {
        running = false;
        if (e && (e.code === 'RATE_LIMIT' || e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'HTTP')) {
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          setStatus(e.code === 'RATE_LIMIT' ? t.rate : t.offline, 'solpay-warn');
          if (++tries < MAX_POLLS) schedule(backoff);
          return;
        }
        setStatus(t.err + (e && e.message ? e.message : 'unbekannt'), 'solpay-error');
      });
    }
    check.addEventListener('click', function () { if (done) return; tries = 0; backoff = POLL_MS; clearTimeout(timer); poll(); });

    return {
      reference: reference,
      url: url,
      setLang: function (l) { t = T[l === 'en' ? 'en' : 'de']; paintTexts(); },
      destroy: function () { done = true; clearTimeout(timer); }
    };
  }

  var instances = [];
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-solpay]'), function (n) { instances.push(mount(n)); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SolPayKnopf = {
    mount: mount,
    setLang: function (l) { instances.forEach(function (i) { i.setLang(l); }); }
  };
})();
