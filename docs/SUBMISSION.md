# Devpost submission: SpaceKasa

**Tagline:** Talk to your till. A language-model assistant for the cashier that takes PayPal payments and never moves money without a human tap.

**Built with:** PayPal Orders v2, PayPal Invoicing v2, PayPal Payments v2 (refunds), PayPal Payouts, WebCrypto Ed25519, SHA-256 Merkle trees, gpt-oss-120b (OpenAI-compatible tool calling), Node.js 22 with no dependencies, Web Speech API, Docker, Cloudflare Tunnel.

**Try it:** https://kasa.spacecode.tech (sandbox) · **Code:** https://git.spacecode.tech/shaban/spacekasa (MIT) · **Video:** https://youtu.be/Tkkn3lPCKdg

## Inspiration
Small cafés and shops in Kosovo run on cash, a paper notebook of who owes what, and a phone. A card terminal costs money every month, and invoicing software expects a back office the shop doesn't have. Yet the cashier already says everything the system needs: "two macchiatos and a water", "invoice the office next door for twelve cappuccinos", "give her the money back, the croissant was cold".

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
- **The model can't use a SKU it didn't look up.** During testing (with an earlier mixed-shop catalogue), the model "remembered" a charger SKU when the cashier said "USB-C cable". Now the server accepts only SKUs that came back from a search in the same turn, and the model corrects itself.
- **Refunds are bounded** by what was actually paid, minus earlier refunds.
- **Injection-resistant.** "Charge 0.01 for a cappuccino" and HTML in customer names are covered by an adversarial test suite (`test/api.sh`).

## Agents that spend, provably
The till assistant never moves money. Its second agent does, within limits a human signs, and every step leaves evidence that a third party can check:
- **Signed mandates.** The owner's key is made in the browser (WebCrypto Ed25519, non-extractable). The owner signs per-order, per-week and price limits, and signs each request to run the agent. A deterministic verifier, with no model in it, rules on every bid and every payment.
- **Procurement without a human tap.** The agent forecasts what will run out from the till's own sales (TSB intermittent demand with weekday factors), haggles with the supplier and pays with **PayPal Payouts** when the deal is inside the mandate. Anything outside the mandate goes to a human, with the reason.
- **Two live instances, agent to agent.** The supplier is a separate server (kasa-supplier.spacecode.tech) with its own key and floor prices that the till never sees. They trade in signed alternating offers (Faratin concession curves). The till pins the supplier's key. The supplier refuses skipped rounds and acceptances of asks it never made. The signed acceptance is the contract, and its hash goes into the books next to the payout.
- **Books with a witness.** Every payment state goes into a hash-linked chain. The supplier countersigns the chain's tree head only after checking that it was only appended to. When our tests rewrite history and re-hash it end to end, the witness refuses.
- **Receipts the customer verifies.** The QR on the paid page pins the receipt's hash in the URL fragment. The customer's phone checks the Merkle proof and both signatures, and fetches the witness key from the supplier directly.

## Challenges
- Small models drift between languages and sometimes propose twice (a partial basket, then the corrected one). We pin the reply language on each turn and let a newer proposal replace the earlier one.
- PayPal sandbox compliance rules depend on the merchant's country: captures failed with COMPLIANCE_VIOLATION until we moved to a US sandbox merchant.
- Cashiers describe orders, not references: "refund the two macchiatos". The model first asked for the K-XXXXXX code; now it looks the payment up with `list_payments` and matches it by items, customer or amount.
- The model provider sometimes rejects a tool call whose arguments miss the schema (a number where a note was expected). Optional fields accept null, and one rejected call is retried once.

## What we learned
Agentic commerce works when the language model handles the words, and the system holds the money and the prices. Splitting the work this way made the language-model part *more* useful, because we could let it act freely.

## What's next
- Connect it to a real point-of-sale catalogue and stock.
- More witnesses (other suppliers, a bank) so that no single party's countersignature is load-bearing.
- PayPal webhooks instead of polling.
- Receipts and end-of-day reports by email.
- An offline-first shop tablet build.
