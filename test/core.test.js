const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core.js');

const R = 'mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN';
const code = (c) => (e) => e && e.code === c;

// ---------- base58 ----------
test('base58: System Program = 32 Null-Bytes, Roundtrip', () => {
  const b = C.base58Decode('11111111111111111111111111111111');
  assert.strictEqual(b.length, 32);
  assert.ok(b.every((x) => x === 0));
  assert.strictEqual(C.base58Encode(b), '11111111111111111111111111111111');
  for (let i = 0; i < 200; i++) {
    const ref = C.randomReference();
    assert.ok(C.isPublicKey(ref), ref);
    assert.strictEqual(C.base58Encode(C.base58Decode(ref)), ref);
  }
});

test('base58: ungültige Zeichen und Überlänge', () => {
  for (const s of ['0OIl', 'abc def', '', 'x'.repeat(200), '<script>']) assert.throws(() => C.base58Decode(s), code('BASE58'));
  assert.strictEqual(C.isPublicKey(null), false);
  assert.strictEqual(C.isPublicKey(42), false);
  assert.strictEqual(C.isSignature('2VUhmW227sihGESaLLNiZPtoZKCtdKBUz1jgFAPdnGfpeXRRRCNVPDi75JqxbqPG1gpFwRY8J6jESDaxygqiGJP6'), true);
  assert.strictEqual(C.isSignature(R), false);
});

// ---------- Adresse ----------
test('Empfänger: gültig, EVM, Programm-Adressen, Müll', () => {
  assert.strictEqual(C.validateRecipient('  ' + R + ' '), R);
  assert.throws(() => C.validateRecipient('0x000000000000000000000000000000000000dEaD'), code('RECIPIENT'));
  for (const a of C.FORBIDDEN_RECIPIENTS) assert.throws(() => C.validateRecipient(a), code('RECIPIENT'), a);
  assert.throws(() => C.validateRecipient(R.slice(0, -1)), code('RECIPIENT'));
  assert.throws(() => C.validateRecipient(undefined), code('RECIPIENT'));
});

// ---------- USDC-Mint ----------
test('USDC-Mint fest hinterlegt und eingefroren', () => {
  assert.strictEqual(C.USDC_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.ok(Object.isFrozen(C.TOKENS) && Object.isFrozen(C.TOKENS.USDC));
  assert.throws(() => { 'use strict'; C.TOKENS.USDC.mint = 'evil'; });
  assert.strictEqual(C.TOKENS.USDC.mint, C.USDC_MINT);
  assert.throws(() => C.getToken('constructor'), code('TOKEN'));
  assert.throws(() => C.getToken('__proto__'), code('TOKEN'));
  assert.strictEqual(C.getToken(' usdc ').mint, C.USDC_MINT);
});

// ---------- Beträge ----------
test('Beträge: gültig, DE-Komma, Grenzen', () => {
  const sol = C.getToken('SOL'), usdc = C.getToken('USDC');
  assert.strictEqual(C.validateAmount('0,5', sol), '0.5');
  assert.strictEqual(C.validateAmount('.5', sol), '0.5');
  assert.strictEqual(C.validateAmount('007', sol), '7');
  assert.strictEqual(C.validateAmount('0.000000001', sol), '0.000000001');
  for (const bad of ['0', '0.0', '-1', '1e3', '1,000.5', '1.000,5', 'abc', '', ' ', '1.2.3', 'Infinity', 'NaN', '0x10', '1000001'])
    assert.throws(() => C.validateAmount(bad, sol), code('AMOUNT'), bad);
  assert.throws(() => C.validateAmount('0.1234567', usdc), code('AMOUNT'));
  assert.strictEqual(C.toMinorUnits('1.5', 9), 1500000000n);
});

// ---------- Texte / Memo ----------
test('Texte: Steuerzeichen, Bidi, Längen', () => {
  assert.strictEqual(C.cleanText('Café\u202E am\n\tMarkt\u0000', 'label'), 'Café am Markt');
  assert.throws(() => C.cleanText('x'.repeat(65), 'label'), code('TEXT'));
  assert.strictEqual(C.cleanText('😀'.repeat(64), 'label').length, 128); // 64 Zeichen erlaubt (Codepoints)
});

test('Memo: keine personenbezogenen Daten', () => {
  assert.strictEqual(C.validateMemo('Bestellung 4711'), 'Bestellung 4711');
  assert.throws(() => C.validateMemo('max@example.de'), code('MEMO'));
  assert.throws(() => C.validateMemo('DE89 3704 0044 0532 0130 00'), code('MEMO'));
  assert.throws(() => C.validateMemo('Tel +49 170 1234567'), code('MEMO'));
  assert.throws(() => C.validateMemo('x'.repeat(121)), code('TEXT'));
});

// ---------- URL ----------
test('Spec-Beispiele exakt', () => {
  assert.strictEqual(C.buildTransferUrl({ recipient: R, amount: '1', label: 'Michael', message: 'Thanks for all the fish', memo: 'OrderId12345' }),
    'solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=1&label=Michael&message=Thanks%20for%20all%20the%20fish&memo=OrderId12345');
  assert.strictEqual(C.buildTransferUrl({ recipient: R, amount: '0.01', token: 'USDC' }),
    'solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=0.01&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
});

test('URL: Injection in Label/Message wird kodiert', () => {
  const url = C.buildTransferUrl({ recipient: R, amount: '1', label: 'a&amount=999&spl-token=X', message: '"><script>alert(1)</script>' });
  assert.strictEqual((url.match(/amount=/g) || []).length, 1);
  assert.ok(!/[<>"]/.test(url));
  const q = new URLSearchParams(url.split('?')[1]);
  assert.strictEqual(q.get('label'), 'a&amount=999&spl-token=X');
  assert.strictEqual(q.get('amount'), '1');
});

test('URL: Referenzen validiert', () => {
  const ref = C.randomReference();
  assert.match(C.buildTransferUrl({ recipient: R, references: [ref] }), new RegExp('reference=' + ref));
  assert.throws(() => C.buildTransferUrl({ recipient: R, references: ['kaputt'] }), code('REFERENCE'));
  assert.throws(() => C.buildTransferUrl({ recipient: R, references: [ref, ref] }), code('REFERENCE'));
  assert.throws(() => C.buildTransferUrl({ recipient: R, references: [R] }), code('REFERENCE'));
  assert.throws(() => C.buildTransferUrl({ recipient: R, references: [1, 2, 3, 4].map(() => C.randomReference()) }), code('REFERENCE'));
  assert.throws(() => C.buildTransferUrl({ recipient: R, token: 'DOGE' }), code('TOKEN'));
});

// ---------- verifyTransaction ----------
const ref = C.randomReference();
function solTx(delta, { withRef = true, err = null } = {}) {
  return { meta: { err, preBalances: [5e9, 1e9, 1], postBalances: [5e9 - delta - 5000, 1e9 + delta, 1], preTokenBalances: [], postTokenBalances: [] },
    transaction: { message: { accountKeys: [{ pubkey: 'payer' }, { pubkey: R }, ...(withRef ? [{ pubkey: ref }] : [])] } } };
}
function usdcTx(pre, post, { mint = C.USDC_MINT, decimals = 6 } = {}) {
  return { meta: { err: null, preBalances: [], postBalances: [],
      preTokenBalances: [{ owner: R, mint, uiTokenAmount: { amount: pre, decimals } }],
      postTokenBalances: [{ owner: R, mint, uiTokenAmount: { amount: post, decimals } }] },
    transaction: { message: { accountKeys: ['payer', ref] } } };
}

test('verifyTransaction SOL', () => {
  const exp = { recipient: R, amount: '0.01', token: 'SOL', reference: ref };
  assert.strictEqual(C.verifyTransaction(solTx(10_000_000), exp).ok, true);
  assert.strictEqual(C.verifyTransaction(solTx(9_999_999), exp).code, 'UNDERPAID');
  assert.strictEqual(C.verifyTransaction(solTx(10_000_000, { withRef: false }), exp).code, 'NO_REFERENCE');
  assert.strictEqual(C.verifyTransaction(solTx(10_000_000, { err: { InstructionError: [] } }), exp).code, 'TX_FAILED');
  assert.strictEqual(C.verifyTransaction(null, exp).code, 'NOT_FOUND');
  assert.strictEqual(C.verifyTransaction({ meta: {}, transaction: { message: {} } }, exp).code, 'NOT_FOUND');
  const broken = solTx(10_000_000); broken.meta.postBalances = ['x'];
  assert.strictEqual(C.verifyTransaction(broken, exp).code, 'MALFORMED');
});

test('verifyTransaction USDC inkl. Fake-Mint', () => {
  const exp = { recipient: R, amount: '5', token: 'USDC', reference: ref };
  assert.strictEqual(C.verifyTransaction(usdcTx('1000000', '6000000'), exp).ok, true);
  assert.strictEqual(C.verifyTransaction(usdcTx('1000000', '5999999'), exp).code, 'UNDERPAID');
  const fakeMint = C.randomReference();
  assert.strictEqual(C.verifyTransaction(usdcTx('0', '5000000', { mint: fakeMint }), exp).code, 'WRONG_MINT');
  assert.strictEqual(C.verifyTransaction(usdcTx('0', '5000000', { decimals: 9 }), exp).code, 'WRONG_MINT');
});

// ---------- RPC: Ausfälle & Ratenlimits ----------
const RPC = 'https://rpc.example.test';
const noSleep = () => Promise.resolve();
function res(status, body, headers = {}) {
  return { status, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => { if (body instanceof Error) throw body; return body; } };
}
const ok = (result) => res(200, { jsonrpc: '2.0', id: 1, result });

test('RPC-URL: nur https, keine Zugangsdaten', () => {
  assert.throws(() => C.validateRpcUrl('http://evil.example'), code('RPC_URL'));
  assert.throws(() => C.validateRpcUrl('javascript:alert(1)'), code('RPC_URL'));
  assert.throws(() => C.validateRpcUrl('https://user:pw@rpc.example'), code('RPC_URL'));
  assert.ok(C.validateRpcUrl('http://127.0.0.1:8899'));
});

test('RPC: 429 mit Retry-After, dann Erfolg', async () => {
  const calls = []; const delays = [];
  const f = async () => { calls.push(1); return calls.length < 3 ? res(429, {}, { 'retry-after': '2' }) : ok(42); };
  const r = await C.rpc(RPC, 'x', [], { fetch: f, sleep: (ms) => { delays.push(ms); return Promise.resolve(); } });
  assert.strictEqual(r, 42);
  assert.deepStrictEqual(delays, [2000, 2000]);
});

test('RPC: 429 dauerhaft -> RATE_LIMIT nach Retries', async () => {
  let n = 0;
  await assert.rejects(C.rpc(RPC, 'x', [], { fetch: async () => { n++; return res(429, {}); }, sleep: noSleep, retries: 3 }), code('RATE_LIMIT'));
  assert.strictEqual(n, 4);
});

test('RPC: JSON-RPC-Fehler mit Ratenlimit-Text wird wiederholt', async () => {
  let n = 0;
  const f = async () => (++n === 1 ? res(200, { jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Too many requests' } }) : ok('fine'));
  assert.strictEqual(await C.rpc(RPC, 'x', [], { fetch: f, sleep: noSleep }), 'fine');
});

test('RPC: 5xx und Netzwerkfehler werden wiederholt', async () => {
  let n = 0;
  const f = async () => { n++; if (n === 1) return res(503, {}); if (n === 2) throw new TypeError('Failed to fetch'); return ok(true); };
  assert.strictEqual(await C.rpc(RPC, 'x', [], { fetch: f, sleep: noSleep }), true);
  await assert.rejects(C.rpc(RPC, 'x', [], { fetch: async () => { throw new TypeError('offline'); }, sleep: noSleep, retries: 1 }), code('NETWORK'));
});

test('RPC: Timeout', async () => {
  const hang = () => new Promise(() => {});
  await assert.rejects(C.rpc(RPC, 'x', [], { fetch: hang, timeoutMs: 30, retries: 1, sleep: noSleep }), code('TIMEOUT'));
});

test('RPC: kaputte Antworten sind fatal (kein Retry)', async () => {
  let n = 0;
  await assert.rejects(C.rpc(RPC, 'x', [], { fetch: async () => { n++; return res(200, new SyntaxError('bad')); }, sleep: noSleep }), code('BAD_RESPONSE'));
  assert.strictEqual(n, 1);
  await assert.rejects(C.rpc(RPC, 'x', [], { fetch: async () => res(200, { hello: 'world' }), sleep: noSleep }), code('BAD_RESPONSE'));
  await assert.rejects(C.rpc(RPC, 'x', [], { fetch: async () => res(200, { jsonrpc: '2.0', error: { code: -32602, message: 'Invalid param' } }), sleep: noSleep }), code('RPC'));
  await assert.rejects(C.rpc(RPC, 'x', [], { fetch: async () => res(404, {}), sleep: noSleep }), code('HTTP'));
});

// ---------- findPayment ----------
function fakeChain(sigs, tx) {
  return async (_u, o) => {
    const m = JSON.parse(o.body).method;
    return ok(m === 'getSignaturesForAddress' ? sigs : tx);
  };
}
const SIG = '2VUhmW227sihGESaLLNiZPtoZKCtdKBUz1jgFAPdnGfpeXRRRCNVPDi75JqxbqPG1gpFwRY8J6jESDaxygqiGJP6';

test('findPayment: pending / confirmed / invalid / Müll-Signaturen', async () => {
  const exp = { recipient: R, amount: '0.01', token: 'SOL', reference: ref };
  const o = (f) => ({ fetch: f, sleep: noSleep });
  assert.deepStrictEqual(await C.findPayment(RPC, exp, o(fakeChain([], null))), { status: 'pending' });
  const r = await C.findPayment(RPC, exp, o(fakeChain([{ signature: SIG, err: null }], solTx(10_000_000))));
  assert.strictEqual(r.status, 'confirmed'); assert.strictEqual(r.signature, SIG);
  assert.strictEqual((await C.findPayment(RPC, exp, o(fakeChain([{ signature: SIG }], solTx(1))))).code, 'UNDERPAID');
  assert.deepStrictEqual(await C.findPayment(RPC, exp, o(fakeChain([{ signature: '<img>' }, { signature: SIG, err: { x: 1 } }], null))), { status: 'pending' });
  assert.deepStrictEqual(await C.findPayment(RPC, exp, o(fakeChain([{ signature: SIG }], null))), { status: 'pending' });
  await assert.rejects(C.findPayment(RPC, exp, o(fakeChain({ not: 'array' }, null))), code('BAD_RESPONSE'));
  await assert.rejects(C.findPayment(RPC, { ...exp, reference: 'kaputt' }, o(fakeChain([], null))), code('REFERENCE'));
});
