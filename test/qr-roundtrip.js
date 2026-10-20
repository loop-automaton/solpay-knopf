// Hilfsskript: rendert das Widget in jsdom und gibt URL + QR-Modulmatrix (aus dem SVG-Pfad) als JSON aus.
const fs = require('node:fs'); const path = require('node:path'); const { JSDOM } = require('jsdom');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const cases = [
  { recipient: 'mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN', amount: '0,01', label: 'Café am Markt', message: 'Kaffee to go' },
  { recipient: 'mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN', amount: '5', token: 'USDC', label: 'Fahrradverleih Harz', message: 'Kaution', memo: 'Bestellung 4711' }
];
const out = cases.map((c) => {
  const dom = new JSDOM('<!doctype html><body><div id="k"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; Object.defineProperty(w.document, 'readyState', { value: 'complete' });
  w.eval(src('vendor-qrcode.js')); w.eval(src('core.js')); w.eval(src('widget.js'));
  const n = w.document.getElementById('k'); Object.assign(n.dataset, c);
  const inst = w.SolPayKnopf.mount(n);
  const svg = n.querySelector('svg'); const size = +svg.getAttribute('viewBox').split(' ')[2];
  const cells = [...svg.querySelector('path').getAttribute('d').matchAll(/M(\d+) (\d+)/g)].map((m) => [+m[1], +m[2]]);
  return { url: inst.url, size, cells };
});
process.stdout.write(JSON.stringify(out));
