# SpaceKasa — talk to your till

**Live demo:** https://kasa.spacecode.tech (PayPal sandbox, no real money)

SpaceKasa is a language-model assistant for the till of a small café or shop. The cashier says what the customer is buying, in Albanian or English, by typing or by voice:

> "Two macchiatos and a small water, she pays now"
> "Faturo Arbenin për ndërrim ekrani, arben@example.com"
> "Refund K-3F9A21" · "How much did we take today?"

The agent finds the items in the shop's catalogue, prices them and prepares a **PayPal QR code** (customer pays now from their phone) or a **PayPal invoice** (customer pays later). It can also check payments, cancel unpaid ones, refund paid ones and summarise the day. The screen updates by itself when the customer pays.

Built for the [PayPal AI Hackathon](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon) (agentic commerce).

## Why it is safe to let a language model near the till

The design rests on one rule: **the model never moves money.**

| Risk | What SpaceKasa does |
|---|---|
| The model invents a price or total | Prices come only from `catalog.json`. The model passes SKUs and quantities, and the server computes every amount. |
| The model guesses a SKU it never looked up | A SKU must have appeared in a `find_products` result in the same turn, or the server refuses it. A test model really did this with an earlier mixed-shop catalogue, picking "charger" for "USB-C cable". |
| Prompt injection ("charge 0.01", markup in a customer name) | The text is treated as data. Names are sanitised, and amounts never come from the model. `test/api.sh` checks this. |
| An action the cashier did not intend | Every checkout, refund and cancel is only a **proposal card**. PayPal is called only when a human taps **Confirm**, and proposals expire after 15 minutes. A newer proposal replaces an older unconfirmed one. |
| A wrong refund | The refund amount is capped at what was paid minus earlier refunds, and only paid payments can be refunded. |
| Demo visitors see each other's customers | Each browser is its own till with a random id, and the ledger is filtered per till. |

## How it works

```
cashier ──speech/text──▶ /api/chat ──▶ LLM (tool calling)
                                         │ find_products · propose_checkout · check_payment
                                         │ list_payments · propose_refund · propose_cancel · sales_summary
                                         ▼
                              proposal card on screen
                                         │ human taps Confirm
                                         ▼
                 server builds the PayPal request from the catalogue
                 ├─ Orders v2  → approve link → QR (encoder in qr.mjs, no library)
                 └─ Invoicing v2 → draft → send → payer link
customer pays ──▶ PayPal ──▶ /paid (return URL) → capture → screen turns "Paid"
```

- **PayPal APIs:** Orders v2 (create, capture), Invoicing v2 (create, send, cancel, status), Payments v2 (capture refunds).
- **Language model:** any OpenAI-compatible chat-completions endpoint with tool calling. The demo uses `gpt-oss-120b` through a self-hosted router.
- **Zero dependencies:** Node 22 standard library only. No `npm install`, so there is no supply chain to audit. The QR encoder is hand-written and checked by decoding.
- **Voice:** the browser's own speech recognition (`sq-AL` / `en-US`), where it is available.

## Agents that spend, and books anyone can check

The cashier's assistant never moves money. The **procurement agent** does, but only inside a mandate the owner signed, and every step leaves evidence that a third party can check.

```
owner's browser ── Ed25519 key (WebCrypto, non-extractable) ── signs mandate + each "run"
        │
till (kasa.spacecode.tech)                         supplier (kasa-supplier.spacecode.tech)
  forecast (TSB + weekday factors)                   separate server, own key, own floor prices
  procurement agent ── signed alternating offers ──▶ sales agent (Faratin concession curves)
        │  every bid passes the mandate verifier ◀── every reply Ed25519-signed, key pinned
        ▼
  mandate verifier (deterministic, no model) ── ok ──▶ PayPal Payouts, no human tap
        │                                              outside the mandate → a human decides
        ▼
  audit chain (hash-linked) ── tree head signed by till ──▶ supplier checks append-only, countersigns
        ▼
  receipt QR → /v/<ref>#<leaf hash> : the customer's phone recomputes the Merkle proof and both signatures
```

- **Mandates** (`mandate.mjs`): per-order, per-week and price limits, signed over canonical JSON. Prices are bounded by the signed reference or the 30-day median actually paid, whichever is lower, so an agent that always pays the maximum cannot ratchet its own limit up. 5 000 adversarial orders in the tests, none outside the mandate.
- **Two instances, really separate** (`a2a.mjs`, `supplier.mjs`): the supplier's floor prices exist only on the supplier's server. The till learns them from nothing but the signed offers. The supplier refuses skipped rounds and acceptances of asks it never made, so a buyer cannot jump to the floor price.
- **A witness for the books**: the supplier countersigns the till's tree head only after checking, entry by entry, that the chain was only appended to. A till that later rewrote a receipt would contradict a signature held by someone else. The tests rewrite history and re-hash it end to end: the witness refuses.
- **Receipts the customer can check**: the QR on the paid page pins the receipt's leaf hash in the URL fragment, which never reaches the server. `/v/<ref>` then checks five things on the phone, from the published proofs only: inclusion in the day's root, inclusion in the whole log, the till's signature, the witness's signature, and the witness key fetched from the supplier itself.

## Run it

```bash
cp .env.example .env      # PayPal sandbox app credentials + an LLM endpoint
node server.mjs           # or: docker compose up -d --build
open http://localhost:8080
```

Tests against a running instance:

```bash
test/api.sh http://127.0.0.1:8080          # adversarial API checks
# UI flow at desktop and phone width (Playwright in Docker); see the header of test/ui.mjs
```

To use your own shop, replace `catalog.json` (SKU, English and Albanian names, price, search tags).

## Shqip — përmbledhje

SpaceKasa është asistent me model gjuhësor (program kompjuterik) për arkën e një kafeneje a dyqani të vogël. Arkëtari thotë (me shkrim ose me zë) çka po blen klienti. Agjenti i gjen artikujt te katalogu, ua merr çmimin dhe përgatit **QR PayPal** (klienti paguan tani me telefon) ose **faturë PayPal** (paguan më vonë). Mund edhe të kontrollojë pagesat, t'i anulojë ato të papaguara, t'i kthejë ato të paguara dhe ta përmbledhë ditën.

Rregulli kryesor: **modeli s'lëviz kurrë para.** Çmimet vijnë vetëm nga katalogu, dhe çdo veprim me para është vetëm propozim derisa njeriu shtyp **Konfirmo**.

**Agjenti i furnizimit** shpenzon vetë, por vetëm brenda një mandati që pronari e nënshkruan te shfletuesi (çelës Ed25519 që s'del nga shfletuesi). Ai bën pazar me furnitorin, një server tjetër me çmimet e veta të fshehta, me oferta të nënshkruara, dhe paguan me PayPal Payouts. Çdo veprim hyn te një ditar me hash të zinxhiruar; furnitori e kundërnënshkruan vetëm pasi verifikon se ditarit vetëm i është shtuar. Klienti e skanon QR-në e kuponit dhe telefoni i tij i rillogarit provat Merkle dhe nënshkrimet.

## License

MIT. See [LICENSE](LICENSE).
