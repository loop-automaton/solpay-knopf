// Widget-Tests im simulierten Browser (jsdom). Kein Netzwerk: fetch wird gefälscht.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const R = 'mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN';

function page(body) {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://shop.example/' });
  const w = dom.window;
  Object.defineProperty(w.document, 'readyState', { value: 'complete', configurable: true }); // wie nach dem Laden
  w.alertCalled = false;
  w.alert = () => { w.alertCalled = true; };
  w.eval(src('vendor-qrcode.js')); w.eval(src('core.js')); w.eval(src('widget.js'));
  return w;
}

test('rendert Knopf, QR (SVG via DOM) und gültigen solana:-Link', () => {
  const w = page(`<div data-solpay data-recipient="${R}" data-amount="0,01" data-label="Café" data-lang="de"></div>`);
  const a = w.document.querySelector('.solpay-btn');
  assert.match(a.getAttribute('href'), /^solana:mvines9.*amount=0\.01&reference=[1-9A-HJ-NP-Za-km-z]+&label=Caf%C3%A9$/);
  assert.strictEqual(a.textContent, 'Mit Solana bezahlen · 0.01 SOL');
  assert.ok(w.document.querySelector('.solpay-qr svg path').getAttribute('d').length > 100);
});

test('XSS: HTML in Label/Message wird nie als HTML gerendert', () => {
  const evil = '&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;';
  const w = page(`<div data-solpay data-recipient="${R}" data-amount="1" data-label="${evil}" data-message="${evil}"></div>`);
  assert.strictEqual(w.document.querySelectorAll('.solpay img, .solpay script').length, 0);
  assert.strictEqual(w.alertCalled, false);
  assert.ok(!/[<>]/.test(w.document.querySelector('.solpay-btn').getAttribute('href')));
});

test('Fehlkonfiguration: EVM-Adresse und Programmadresse zeigen Fehler statt Knopf', () => {
  for (const bad of ['0x000000000000000000000000000000000000dEaD', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'javascript:alert(1)']) {
    const w = page(`<div data-solpay data-recipient="${bad}" data-amount="5"></div>`);
    assert.strictEqual(w.document.querySelector('.solpay-btn'), null, bad);
    assert.match(w.document.querySelector('.solpay-error').textContent, /Knopf falsch eingerichtet/);
  }
  const w = page(`<div data-solpay data-recipient="0x000000000000000000000000000000000000dEaD"></div>`);
  assert.match(w.document.querySelector('.solpay-error').textContent, /EVM-Adresse/);
  w.SolPayKnopf.setLang('en');
  assert.strictEqual(w.document.querySelector('.solpay-error').textContent, 'Button misconfigured: invalid or unsupported recipient address');
});

test('Fehlkonfiguration: Betrag, Token, RPC-URL', () => {
  for (const attrs of ['data-amount="-1"', 'data-amount="1e9"', 'data-token="DOGE"', 'data-rpc="http://evil.example"', 'data-memo="ich@example.de"']) {
    const w = page(`<div data-solpay data-recipient="${R}" ${attrs}></div>`);
    assert.strictEqual(w.document.querySelector('.solpay-btn'), null, attrs);
  }
});

test('Sprachwechsel DE -> EN ohne neue Referenz', () => {
  const w = page(`<div data-solpay data-recipient="${R}" data-amount="5" data-token="USDC"></div>`);
  const before = w.document.querySelector('.solpay-btn').getAttribute('href');
  w.SolPayKnopf.setLang('en');
  assert.strictEqual(w.document.querySelector('.solpay-btn').textContent, 'Pay with Solana · 5 USDC');
  assert.strictEqual(w.document.querySelector('.solpay-check').textContent, 'Check payment');
  assert.strictEqual(w.document.querySelector('.solpay-btn').getAttribute('href'), before);
});

test('Zahlung prüfen: Ratenlimit zeigt Hinweis, bestätigte Zahlung zeigt sicheren Link', async () => {
  const w = page(`<div id="k"></div>`);
  const node = w.document.getElementById('k');
  node.dataset.recipient = R; node.dataset.amount = '0.01';
  let mode = '429';
  const SIG = '2VUhmW227sihGESaLLNiZPtoZKCtdKBUz1jgFAPdnGfpeXRRRCNVPDi75JqxbqPG1gpFwRY8J6jESDaxygqiGJP6';
  let inst;
  const fetch = async (_u, o) => {
    const m = JSON.parse(o.body).method;
    if (mode === '429') return { status: 429, headers: { get: () => null }, json: async () => ({}) };
    if (m === 'getSignaturesForAddress') return { status: 200, headers: { get: () => null }, json: async () => ({ jsonrpc: '2.0', result: [{ signature: SIG, err: null }] }) };
    return { status: 200, headers: { get: () => null }, json: async () => ({ jsonrpc: '2.0', result: {
      meta: { err: null, preBalances: [0, 0, 0], postBalances: [0, 10_000_000, 0] },
      transaction: { message: { accountKeys: ['payer', R, inst.reference] } } } }) };
  };
  inst = w.SolPayKnopf.mount(node, { rpcOptions: { fetch, retries: 0, sleep: () => Promise.resolve() } });
  const tick = () => new Promise((r) => setTimeout(r, 20));
  node.querySelector('.solpay-check').click(); await tick();
  assert.match(node.querySelector('.solpay-status').textContent, /Netzwerk ausgelastet/);
  mode = 'ok';
  let event = null;
  node.addEventListener('solpay:confirmed', (e) => { event = e.detail; });
  node.querySelector('.solpay-check').click(); await tick();
  assert.match(node.querySelector('.solpay-status').textContent, /Zahlung eingegangen/);
  const link = node.querySelector('.solpay-link');
  assert.strictEqual(link.getAttribute('href'), 'https://solscan.io/tx/' + SIG);
  assert.strictEqual(link.getAttribute('rel'), 'noopener noreferrer');
  assert.strictEqual(event.signature, SIG);
  inst.destroy();
});

test('Hintergrund-Tab: kein RPC-Aufruf, solange document.hidden', async () => {
  const w = page(`<div id="k"></div>`);
  Object.defineProperty(w.document, 'hidden', { value: true, configurable: true });
  const node = w.document.getElementById('k');
  node.dataset.recipient = R;
  let calls = 0;
  const inst = w.SolPayKnopf.mount(node, { rpcOptions: { fetch: async () => { calls++; return {}; } } });
  node.querySelector('.solpay-check').click();
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(calls, 0);
  inst.destroy();
});

test('Quellcode enthält kein innerHTML / eval / document.write', () => {
  for (const f of ['core.js', 'widget.js']) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src(f)), f);
  }
});
