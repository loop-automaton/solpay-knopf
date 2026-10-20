/*
 * solpay-knopf – core v0.2 (pure functions, no DOM)
 * Solana Pay transfer requests (spec: https://docs.solanapay.com/spec)
 * Read-only: builds URLs and checks payments via public JSON-RPC. Never handles keys, never signs.
 * License: MIT – see LICENSE
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolPayCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

  // Fest hinterlegt und eingefroren. USDC-Mint (Circle) auf Solana-Mainnet.
  var USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var TOKENS = Object.freeze({
    SOL: Object.freeze({ mint: null, decimals: 9 }),
    USDC: Object.freeze({ mint: USDC_MINT, decimals: 6 })
  });

  // Adressen, an die niemand bezahlen sollte (Programme / Sysvars / Token-Mints).
  var FORBIDDEN_RECIPIENTS = Object.freeze([
    '11111111111111111111111111111111',            // System Program
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account Program
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo Program
    'ComputeBudget111111111111111111111111111111',
    'SysvarRent111111111111111111111111111111111',
    'SysvarC1ock11111111111111111111111111111111',
    USDC_MINT
  ]);

  var LIMITS = Object.freeze({ label: 64, message: 140, memo: 120, maxAmount: '1000000', maxReferences: 3 });

  function SolPayError(code, message) {
    var e = new Error(message);
    e.name = 'SolPayError';
    e.code = code;
    return e;
  }

  function base58Encode(bytes) {
    var digits = [];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    var out = '';
    for (var k = 0; k < bytes.length && bytes[k] === 0; k++) out += '1';
    for (var q = digits.length - 1; q >= 0; q--) out += ALPHABET[digits[q]];
    return out;
  }

  function base58Decode(str) {
    if (typeof str !== 'string' || !str.length) throw SolPayError('BASE58', 'base58: leerer Wert');
    if (str.length > 128) throw SolPayError('BASE58', 'base58: Wert zu lang');
    if (!BASE58_RE.test(str)) throw SolPayError('BASE58', 'base58: ungültiges Zeichen');
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var carry = ALPHABET.indexOf(str[i]);
      for (var j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (var k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  function decodedLength(str) {
    try { return base58Decode(str).length; } catch (e) { return -1; }
  }
  function isPublicKey(str) { return typeof str === 'string' && str.length >= 32 && str.length <= 44 && decodedLength(str) === 32; }
  function isSignature(str) { return typeof str === 'string' && str.length >= 64 && str.length <= 88 && decodedLength(str) === 64; }

  function validateRecipient(addr) {
    var a = typeof addr === 'string' ? addr.trim() : '';
    if (/^0x[0-9a-f]{40}$/i.test(a)) throw SolPayError('RECIPIENT', 'Das ist eine EVM-Adresse (0x…), keine Solana-Adresse');
    if (!isPublicKey(a)) throw SolPayError('RECIPIENT', 'Empfänger-Adresse ist keine gültige Solana-Adresse');
    if (FORBIDDEN_RECIPIENTS.indexOf(a) >= 0) throw SolPayError('RECIPIENT', 'Empfänger ist eine Programm- oder Token-Adresse, keine Wallet');
    return a;
  }

  function randomReference(rng) {
    var b = new Uint8Array(32);
    if (rng) rng(b);
    else if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else require('crypto').randomFillSync(b);
    return base58Encode(b);
  }

  function getToken(symbol) {
    var key = String(symbol || 'SOL').trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(TOKENS, key)) throw SolPayError('TOKEN', 'Unbekannter Token (erlaubt: SOL, USDC)');
    return { symbol: key, mint: TOKENS[key].mint, decimals: TOKENS[key].decimals };
  }

  function normalizeAmount(amount) {
    var s = String(amount).trim().replace(/\s/g, '');
    if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.'); // nur EIN DE-Komma als Dezimaltrenner
    if (s.charAt(0) === '.') s = '0' + s;
    return s;
  }

  /** Decimal string -> BigInt minor units. No scientific notation, no signs, no excess decimals (spec). */
  function toMinorUnits(amount, decimals) {
    var s = String(amount).trim();
    if (s.length > 32 || !/^\d+(\.\d+)?$/.test(s)) throw SolPayError('AMOUNT', 'Betrag ungültig (nur Ziffern und ein Dezimaltrenner, z. B. 0.5)');
    var parts = s.split('.');
    var frac = parts[1] || '';
    if (frac.length > decimals) throw SolPayError('AMOUNT', 'Betrag hat mehr als ' + decimals + ' Nachkommastellen');
    while (frac.length < decimals) frac += '0';
    return BigInt(parts[0]) * (BigInt(10) ** BigInt(decimals)) + BigInt(frac || '0');
  }

  /** Validate a payment amount: > 0 and <= LIMITS.maxAmount. Returns normalized decimal string. */
  function validateAmount(amount, token) {
    var a = normalizeAmount(amount);
    var minor = toMinorUnits(a, token.decimals);
    if (minor <= BigInt(0)) throw SolPayError('AMOUNT', 'Betrag muss größer als 0 sein');
    if (minor > toMinorUnits(LIMITS.maxAmount, token.decimals)) throw SolPayError('AMOUNT', 'Betrag zu hoch (max. ' + LIMITS.maxAmount + ')');
    return a.replace(/^0+(?=\d)/, '');
  }

  /** Clean free text: strip control chars / bidi overrides, collapse whitespace, enforce max length. */
  function cleanText(value, field) {
    if (value === undefined || value === null) return '';
    var s = String(value)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/g, '')
      .replace(/\s+/g, ' ').trim();
    var max = LIMITS[field];
    if (Array.from(s).length > max) throw SolPayError('TEXT', field + ' ist zu lang (max. ' + max + ' Zeichen)');
    return s;
  }

  /** Memo is public on-chain forever: reject obvious personal data (e-mail, IBAN, phone). */
  function validateMemo(memo) {
    var m = cleanText(memo, 'memo');
    if (!m) return '';
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(m)) throw SolPayError('MEMO', 'Memo ist öffentlich: bitte keine E-Mail-Adresse');
    if (/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/i.test(m)) throw SolPayError('MEMO', 'Memo ist öffentlich: bitte keine IBAN');
    if (/(?:\+|00)\d[\d\s\/-]{7,}\d/.test(m)) throw SolPayError('MEMO', 'Memo ist öffentlich: bitte keine Telefonnummer');
    return m;
  }

  /** Build a Solana Pay transfer-request URL. Throws SolPayError on any invalid input. */
  function buildTransferUrl(opts) {
    opts = opts || {};
    var recipient = validateRecipient(opts.recipient);
    var token = getToken(opts.token);
    var params = [];
    if (opts.amount !== undefined && opts.amount !== null && opts.amount !== '') {
      params.push('amount=' + validateAmount(opts.amount, token));
    }
    if (token.mint) params.push('spl-token=' + token.mint);
    var refs = opts.references || [];
    if (!Array.isArray(refs) || refs.length > LIMITS.maxReferences) throw SolPayError('REFERENCE', 'Zu viele Referenzen');
    var seen = {};
    refs.forEach(function (r) {
      if (!isPublicKey(r)) throw SolPayError('REFERENCE', 'Referenz ungültig (32-Byte-base58)');
      if (r === recipient || seen[r]) throw SolPayError('REFERENCE', 'Referenz doppelt oder gleich Empfänger');
      seen[r] = true;
      params.push('reference=' + r);
    });
    var label = cleanText(opts.label, 'label');
    var message = cleanText(opts.message, 'message');
    var memo = validateMemo(opts.memo);
    if (label) params.push('label=' + encodeURIComponent(label));
    if (message) params.push('message=' + encodeURIComponent(message));
    if (memo) params.push('memo=' + encodeURIComponent(memo));
    return 'solana:' + recipient + (params.length ? '?' + params.join('&') : '');
  }

  function keyStr(k) { return typeof k === 'string' ? k : (k && k.pubkey) || ''; }

  /**
   * Check a jsonParsed getTransaction result against the expected payment.
   * Returns { ok: boolean, code: string, reason: string }.
   */
  function verifyTransaction(tx, expected) {
    function fail(code, reason) { return { ok: false, code: code, reason: reason }; }
    if (!tx || typeof tx !== 'object' || !tx.meta || !tx.transaction || !tx.transaction.message ||
        !Array.isArray(tx.transaction.message.accountKeys)) return fail('NOT_FOUND', 'Transaktion nicht gefunden');
    if (tx.meta.err) return fail('TX_FAILED', 'Transaktion fehlgeschlagen');
    var keys = tx.transaction.message.accountKeys.map(keyStr);
    if (expected.reference && keys.indexOf(expected.reference) < 0) return fail('NO_REFERENCE', 'Referenz fehlt');
    var token = getToken(expected.token);
    var need = expected.amount ? toMinorUnits(normalizeAmount(expected.amount), token.decimals) : BigInt(1);
    var got;
    try {
      if (!token.mint) {
        var idx = keys.indexOf(expected.recipient);
        if (idx < 0) return fail('NO_RECIPIENT', 'Empfänger nicht in der Transaktion');
        got = BigInt(tx.meta.postBalances[idx]) - BigInt(tx.meta.preBalances[idx]);
      } else {
        var bad = false;
        var find = function (list) {
          var e = (list || []).filter(function (b) { return b && b.owner === expected.recipient && b.mint === token.mint; })[0];
          if (!e) return BigInt(0);
          if (e.uiTokenAmount && e.uiTokenAmount.decimals !== undefined && e.uiTokenAmount.decimals !== token.decimals) bad = true;
          return BigInt(e.uiTokenAmount.amount);
        };
        got = find(tx.meta.postTokenBalances) - find(tx.meta.preTokenBalances);
        if (bad) return fail('WRONG_MINT', 'Token-Dezimalstellen passen nicht zu USDC');
        if (got <= BigInt(0)) {
          var otherMint = (tx.meta.postTokenBalances || []).some(function (b) { return b && b.owner === expected.recipient && b.mint !== token.mint; });
          if (otherMint) return fail('WRONG_MINT', 'Falscher Token (nicht die offizielle USDC-Mint)');
        }
      }
    } catch (e) {
      return fail('MALFORMED', 'Transaktionsdaten unlesbar');
    }
    if (got < need) return fail('UNDERPAID', 'Betrag zu niedrig (erhalten ' + got + ', erwartet ' + need + ' kleinste Einheiten)');
    return { ok: true, code: 'OK', reason: 'Zahlung bestätigt' };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function validateRpcUrl(url) {
    var u;
    try { u = new URL(url); } catch (e) { throw SolPayError('RPC_URL', 'RPC-URL ungültig'); }
    var local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw SolPayError('RPC_URL', 'RPC-URL muss https:// sein');
    if (u.username || u.password) throw SolPayError('RPC_URL', 'RPC-URL darf keine Zugangsdaten enthalten');
    return u.toString();
  }

  /**
   * JSON-RPC call with timeout, retries + exponential backoff for 429 / 5xx / network errors.
   * opts: { fetch, timeoutMs=8000, retries=3, baseDelayMs=500, sleep }
   * Errors carry .code: RATE_LIMIT | HTTP | NETWORK | TIMEOUT | BAD_RESPONSE | RPC
   */
  function rpc(url, method, params, opts) {
    if (typeof opts === 'function') opts = { fetch: opts };
    opts = opts || {};
    var f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var timeoutMs = opts.timeoutMs || 8000;
    var retries = opts.retries === undefined ? 3 : opts.retries;
    var base = opts.baseDelayMs === undefined ? 500 : opts.baseDelayMs;
    var wait = opts.sleep || sleep;
    var target = validateRpcUrl(url);

    function attempt(n) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer;
      var timeout = new Promise(function (_, rej) {
        timer = setTimeout(function () { if (ctrl) ctrl.abort(); rej(SolPayError('TIMEOUT', 'RPC antwortet nicht (Timeout)')); }, timeoutMs);
      });
      var req = Promise.resolve().then(function () {
        return f(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }),
          signal: ctrl ? ctrl.signal : undefined,
          credentials: 'omit',
          referrerPolicy: 'no-referrer'
        });
      }).then(function (res) {
        if (res.status === 429) {
          var ra = parseInt(res.headers && res.headers.get && res.headers.get('retry-after'), 10);
          var e = SolPayError('RATE_LIMIT', 'RPC-Ratenlimit erreicht');
          e.retryAfterMs = isFinite(ra) ? Math.min(ra * 1000, 30000) : null;
          throw e;
        }
        if (res.status >= 500) throw SolPayError('HTTP', 'RPC-Serverfehler ' + res.status);
        if (res.status && (res.status < 200 || res.status >= 300)) { var h = SolPayError('HTTP', 'RPC-Fehler ' + res.status); h.fatal = true; throw h; }
        return res.json().catch(function () { var b = SolPayError('BAD_RESPONSE', 'RPC-Antwort ist kein JSON'); b.fatal = true; throw b; });
      }, function (err) {
        if (err && err.code) throw err;
        throw SolPayError('NETWORK', 'Netzwerkfehler beim RPC');
      }).then(function (j) {
        if (!j || typeof j !== 'object' || j.jsonrpc !== '2.0') { var b = SolPayError('BAD_RESPONSE', 'Unerwartete RPC-Antwort'); b.fatal = true; throw b; }
        if (j.error) {
          var rate = j.error.code === 429 || /rate|too many/i.test(String(j.error.message));
          var e = SolPayError(rate ? 'RATE_LIMIT' : 'RPC', 'RPC-Fehler: ' + String(j.error.message).slice(0, 200));
          if (!rate) e.fatal = true;
          throw e;
        }
        return j.result;
      });
      return Promise.race([req, timeout]).then(function (r) { clearTimeout(timer); return r; }, function (err) {
        clearTimeout(timer);
        if (err.fatal || n >= retries) throw err;
        var delay = err.retryAfterMs || base * Math.pow(2, n) + Math.floor(Math.random() * base);
        return wait(delay).then(function () { return attempt(n + 1); });
      });
    }
    return attempt(0);
  }

  /**
   * Look up a payment by reference (read-only).
   * Resolves { status: 'pending'|'confirmed'|'invalid', signature?, code?, reason? }. Rejects with SolPayError on RPC trouble.
   */
  function findPayment(rpcUrl, expected, opts) {
    if (!isPublicKey(expected.reference)) return Promise.reject(SolPayError('REFERENCE', 'Referenz ungültig'));
    return rpc(rpcUrl, 'getSignaturesForAddress', [expected.reference, { limit: 10, commitment: 'confirmed' }], opts)
      .then(function (sigs) {
        if (!Array.isArray(sigs)) throw SolPayError('BAD_RESPONSE', 'Unerwartete RPC-Antwort');
        var valid = sigs.filter(function (s) { return s && isSignature(s.signature) && !s.err; });
        if (!valid.length) return { status: 'pending' };
        var sig = valid[valid.length - 1].signature; // älteste erfolgreiche = erste Zahlung
        return rpc(rpcUrl, 'getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], opts)
          .then(function (tx) {
            if (tx === null) return { status: 'pending' }; // noch nicht abrufbar
            var v = verifyTransaction(tx, expected);
            return { status: v.ok ? 'confirmed' : 'invalid', signature: sig, code: v.code, reason: v.reason };
          });
      });
  }

  return {
    TOKENS: TOKENS, USDC_MINT: USDC_MINT, LIMITS: LIMITS, FORBIDDEN_RECIPIENTS: FORBIDDEN_RECIPIENTS,
    base58Encode: base58Encode, base58Decode: base58Decode, isPublicKey: isPublicKey, isSignature: isSignature,
    validateRecipient: validateRecipient, validateAmount: validateAmount, validateMemo: validateMemo, cleanText: cleanText,
    getToken: getToken, randomReference: randomReference, toMinorUnits: toMinorUnits, normalizeAmount: normalizeAmount,
    buildTransferUrl: buildTransferUrl, verifyTransaction: verifyTransaction, findPayment: findPayment, rpc: rpc,
    validateRpcUrl: validateRpcUrl
  };
});
