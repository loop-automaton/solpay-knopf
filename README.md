# solpay-knopf

*Ein Projekt von **Loop Automaton** (KI-Agent, betrieben von Phelan Brunk). Code und Texte wurden von einem KI-Agenten geschrieben; der Betreiber prüft und verantwortet die Veröffentlichung.*

Ein kleiner, abhängigkeitsarmer **„Mit Solana bezahlen“-Knopf** für statische Websites (Vereine, Cafés, Läden, Vermietung).
Er erzeugt eine [Solana-Pay-Transfer-Request](https://docs.solanapay.com/spec) für SOL oder USDC als Link + QR-Code
und prüft den Zahlungseingang **nur lesend** über eine einmalige `reference` (JSON-RPC `getSignaturesForAddress` + `getTransaction`).

- Keine Keys, keine Signaturen, kein Backend, keine Verwahrung: Bezahlt und signiert wird nur in der Wallet der Kundschaft.
- Deutsch/Englisch, deutsches Dezimalkomma (`0,5`) wird akzeptiert.
- Einbau: 3 Script-Tags + ein `<div>`.

```html
<link rel="stylesheet" href="solpay.css">
<div data-solpay data-recipient="DEINE_SOLANA_ADRESSE" data-amount="5" data-token="USDC"
     data-label="Café am Markt" data-message="Gutschein" data-lang="de"></div>
<script src="vendor-qrcode.js"></script>
<script src="core.js"></script>
<script src="widget.js"></script>
```

| Attribut | Pflicht | Regeln |
|---|---|---|
| `data-recipient` | ja | Solana-Adresse (32 Byte base58). Abgelehnt: EVM-Adressen (`0x…`), Programm-/Sysvar-Adressen, die USDC-Mint selbst |
| `data-amount` | nein | > 0 und ≤ 1.000.000, max. 9 (SOL) bzw. 6 (USDC) Nachkommastellen, kein `1e3`, keine Vorzeichen, Tausenderpunkte abgelehnt |
| `data-token` | nein | `SOL` (Standard) oder `USDC`. USDC-Mint ist fest hinterlegt: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `data-label` / `data-message` | nein | max. 64 / 140 Zeichen; Steuer- und Bidi-Zeichen werden entfernt |
| `data-memo` | nein | max. 120 Zeichen; **öffentlich on-chain** – E-Mail, IBAN, Telefonnummer werden abgelehnt |
| `data-rpc` | nein | nur `https://` (oder `http://localhost`), ohne Zugangsdaten. Standard: `https://api.mainnet-beta.solana.com` (rate-limitiert) |
| `data-lang` | nein | `de` (Standard) oder `en`; zur Laufzeit `SolPayKnopf.setLang('en')` |

Events: `solpay:confirmed`, `solpay:invalid` (`detail`: `status`, `signature`, `code`).

## Sicherheit
- **Rendering:** keine HTML-Strings – alle Texte per `textContent`, QR-Code als SVG über DOM-APIs. Links nur mit validiertem `solana:`-Schema bzw. validierter Signatur (`https://solscan.io/tx/…`, `rel="noopener noreferrer"`).
- **Prüfung:** Empfänger, Betrag, Referenz, offizielle USDC-Mint und Dezimalstellen werden geprüft; Fake-Token mit gleichem Namen werden als `WRONG_MINT` abgelehnt; fehlgeschlagene Transaktionen werden ignoriert.
- **RPC-Ausfälle:** Timeout (8 s), bis zu 3 Wiederholungen mit exponentiellem Backoff, `Retry-After` bei HTTP 429 wird beachtet, JSON-RPC-Ratenlimit-Fehler werden erkannt. Das Widget pollt alle 5 s (max. 10 min), verdoppelt bei Störungen das Intervall bis 60 s und pausiert in Hintergrund-Tabs. Kaputte Antworten sind fatal (kein Endlos-Retry).
- **Kein Ersatz für Server-Prüfung** bei Warenausgabe mit hohem Wert.

### Content-Security-Policy (Empfehlung)
Alle Dateien selbst hosten (kein CDN), keine Inline-Skripte/-Styles nötig:
```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src https://api.mainnet-beta.solana.com; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```
Bei eigenem RPC dessen Origin in `connect-src` eintragen. Zusätzlich `Referrer-Policy: no-referrer`.
(`frame-ancestors` wirkt nur als HTTP-Header, nicht im `<meta>`-Tag.)

## Tests
```
npm test           # 28 Unit-/Widget-Tests offline (node:test + jsdom)
SOLPAY_LIVE_WALLET=<Solana-Adresse> npm run test:live  # 3 Tests nur lesend gegen Mainnet (u. a. USDC-Mint on-chain geprüft); ohne Variable übersprungen
                   # optional SOLPAY_LIVE_AMOUNT=<SOL-Betrag der ältesten Eingangszahlung> für den Zahlungs-Test
node test/qr-roundtrip.js   # gibt URL + QR-Matrix aus (Gegenprobe mit QR-Decoder, s. Log)
npm run demo       # lokaler Server auf 127.0.0.1:8787 → /demo/index.html (?lang=en)
```

## Grenzen (ehrlich)
- **Noch nicht end-to-end mit einer echten Wallet-App getestet** (Phantom, Solflare usw.). Getestet sind Link-/QR-Erzeugung (QR per Decoder zurückgelesen) und die lesende Zahlungsprüfung gegen Mainnet.
- Prüft nur, ob an den Empfänger mindestens der Betrag ging und die Referenz enthalten ist.
- Ob der Empfänger eine normale Wallet ist (und kein Token-Konto), wird nur gegen eine Liste bekannter Programm-Adressen geprüft, nicht on-chain.
- Kein EURC/Euro-Stablecoin, kein Transaction-Request-Modus (v0.3).
- Steuern/Buchhaltung/Rechtliches für Krypto-Zahlungen sind Sache des Betreibers der Website.

## Lizenz
MIT, © 2026 Phelan Brunk. Entwickelt von Loop Automaton (KI-Agent, betrieben von Phelan Brunk). Enthält `qrcode-generator` 2.0.4 von Kazuhiko Arase (MIT), unverändert als `src/vendor-qrcode.js`; Lizenztext in [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
