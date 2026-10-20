// Nur lesend gegen Solana-Mainnet. Wird ohne SOLPAY_LIVE_WALLET übersprungen.
// Start: SOLPAY_LIVE_WALLET=<Solana-Adresse> [SOLPAY_LIVE_AMOUNT=<SOL-Betrag der ältesten Eingangszahlung>] npm run test:live
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core.js');
const RPC = process.env.SOLPAY_LIVE_RPC || 'https://api.mainnet-beta.solana.com';
const WALLET = process.env.SOLPAY_LIVE_WALLET;
const AMOUNT = process.env.SOLPAY_LIVE_AMOUNT;
const skip = WALLET ? false : 'SOLPAY_LIVE_WALLET nicht gesetzt';
const skipAmount = skip || (AMOUNT ? false : 'SOLPAY_LIVE_AMOUNT nicht gesetzt');

// Betrag + 1 Lamport als Dezimal-String (für den UNDERPAID-Gegentest)
function plusOneLamport(amount) {
  const [i, f = ''] = String(amount).split('.');
  const lamports = BigInt(i) * 1000000000n + BigInt((f + '000000000').slice(0, 9)) + 1n;
  const s = lamports.toString().padStart(10, '0');
  return (s.slice(0, -9) + '.' + s.slice(-9)).replace(/\.?0+$/, '');
}

test('unbenutzte Referenz => pending', { skip }, async () => {
  const r = await C.findPayment(RPC, { recipient: WALLET, reference: C.randomReference() });
  assert.strictEqual(r.status, 'pending');
});

test('älteste Eingangszahlung (SOLPAY_LIVE_AMOUNT) wird erkannt', { skip: skipAmount }, async () => {
  const sigs = await C.rpc(RPC, 'getSignaturesForAddress', [WALLET, { limit: 1000 }]);
  const first = sigs[sigs.length - 1].signature;
  const tx = await C.rpc(RPC, 'getTransaction', [first, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
  assert.strictEqual(C.verifyTransaction(tx, { recipient: WALLET, amount: AMOUNT, token: 'SOL' }).ok, true);
  assert.strictEqual(C.verifyTransaction(tx, { recipient: WALLET, amount: plusOneLamport(AMOUNT), token: 'SOL' }).code, 'UNDERPAID');
});

test('hinterlegte USDC-Mint ist on-chain ein SPL-Token-Mint mit 6 Dezimalstellen', { skip }, async () => {
  const info = await C.rpc(RPC, 'getAccountInfo', [C.USDC_MINT, { encoding: 'jsonParsed' }]);
  assert.strictEqual(info.value.owner, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.strictEqual(info.value.data.parsed.type, 'mint');
  assert.strictEqual(info.value.data.parsed.info.decimals, 6);
});
