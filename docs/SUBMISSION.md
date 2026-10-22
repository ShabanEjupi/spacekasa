# Devpost submission: SpaceKasa

**Tagline:** Talk to your till. An AI cashier's assistant that takes PayPal payments and never moves money without a human tap.

**Built with:** PayPal Orders v2, PayPal Invoicing v2, PayPal Payments v2 (refunds), gpt-oss-120b (OpenAI-compatible tool calling), Node.js 22 with no dependencies, Web Speech API, Docker, Cloudflare Tunnel.

**Try it:** https://kasa.spacecode.tech (sandbox) · **Code:** https://git.spacecode.tech/shaban/spacekasa (MIT)

## Inspiration
Small shops in Kosovo run on cash, a paper notebook of who owes what, and a phone. A card terminal costs money every month, and invoicing software expects a back office the shop doesn't have. Yet the cashier already says everything the system needs: "two macchiatos and a water", "put the screen repair on Arben's tab", "give her the money back for the cable".

## What it does
The cashier speaks or types, in Albanian or English. SpaceKasa:
- finds the items in the shop's catalogue and prices them;
- prepares a **PayPal QR code** for customers paying now, or a **PayPal invoice** (with or without email) for customers paying later;
- turns the screen to **Paid** by itself when the customer completes the payment on their phone;
- checks, lists, cancels and refunds payments, and answers "how much did we take today?".

## How we built it
A single Node 22 server with no npm dependencies. The model gets seven tools: `find_products`, `propose_checkout`, `check_payment`, `list_payments`, `propose_refund`, `propose_cancel` and `sales_summary`. Every tool that would move money returns a **proposal card** instead of acting. Only the Confirm button calls PayPal. When it does, the server builds the Orders v2 or Invoicing v2 request from the catalogue, not from anything the model said. The QR encoder is our own, so a code printed on the counter is one we can verify by decoding it.

## Agentic commerce, safely
- **The model never moves money.** Checkout, refund and cancel are proposals until a human taps Confirm. Proposals expire, and a newer one replaces an older one.
- **The model never sets a price.** It passes SKUs and quantities, and the server computes every amount.
- **The model can't use a SKU it didn't look up.** During testing, the model "remembered" a charger SKU when the cashier said "USB-C cable". Now the server accepts only SKUs that came back from a search in the same turn, and the model corrects itself.
- **Refunds are bounded** by what was actually paid, minus earlier refunds.
- **Injection-resistant.** "Charge 0.01 for the repair" and HTML in customer names are covered by an adversarial test suite (`test/api.sh`).

## Challenges
- Small models drift between languages and sometimes propose twice (a partial basket, then the corrected one). We pin the reply language on each turn and let a newer proposal replace the earlier one.
- PayPal sandbox compliance rules depend on the merchant's country: captures failed with COMPLIANCE_VIOLATION until we moved to a US sandbox merchant.

## What we learned
Agentic commerce works when the agent handles language and judgement, and the system holds the money and the prices. Splitting the work this way made the AI part *more* useful, because we could let it act freely.

## What's next
- Connect it to a real point-of-sale catalogue and stock.
- PayPal webhooks instead of polling.
- Receipts and end-of-day reports by email.
- An offline-first shop tablet build.
