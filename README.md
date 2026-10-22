# SpaceKasa — talk to your till

**Live demo:** https://kasa.spacecode.tech (PayPal sandbox, no real money)

SpaceKasa is an AI assistant for the till of a small shop. The cashier says what the customer is buying, in Albanian or English, by typing or by voice:

> "Two macchiatos and a small water, she pays now"
> "Faturo Arbenin për ndërrim ekrani, arben@example.com"
> "Refund K-3F9A21" · "How much did we take today?"

The agent finds the items in the shop's catalogue, prices them and prepares a **PayPal QR code** (customer pays now from their phone) or a **PayPal invoice** (customer pays later). It can also check payments, cancel unpaid ones, refund paid ones and summarise the day. The screen updates by itself when the customer pays.

Built for the [PayPal AI Hackathon](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon) (agentic commerce).

## Why it is safe to let an AI near the till

The design rests on one rule: **the model never moves money.**

| Risk | What SpaceKasa does |
|---|---|
| The model invents a price or total | Prices come only from `catalog.json`. The model passes SKUs and quantities, and the server computes every amount. |
| The model guesses a SKU it never looked up | A SKU must have appeared in a `find_products` result in the same turn, or the server refuses it. A test model really did this, picking "charger" for "USB-C cable". |
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
- **AI:** any OpenAI-compatible chat-completions endpoint with tool calling. The demo uses `gpt-oss-120b` through a self-hosted router.
- **Zero dependencies:** Node 22 standard library only. No `npm install`, so there is no supply chain to audit. The QR encoder is hand-written and checked by decoding.
- **Voice:** the browser's own speech recognition (`sq-AL` / `en-US`), where it is available.

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

SpaceKasa është asistent AI për arkën e një dyqani të vogël. Arkëtari thotë (me shkrim ose me zë) çka po blen klienti. Agjenti i gjen artikujt te katalogu, ua merr çmimin dhe përgatit **QR PayPal** (klienti paguan tani me telefon) ose **faturë PayPal** (paguan më vonë). Mund edhe të kontrollojë pagesat, t'i anulojë ato të papaguara, t'i kthejë ato të paguara dhe ta përmbledhë ditën.

Rregulli kryesor: **modeli s'lëviz kurrë para.** Çmimet vijnë vetëm nga katalogu, dhe çdo veprim me para është vetëm propozim derisa njeriu shtyp **Konfirmo**.

## License

MIT. See [LICENSE](LICENSE).
