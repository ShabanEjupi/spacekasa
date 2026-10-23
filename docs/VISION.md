# SpaceKasa 2: provably bounded autonomous commerce

Version 1 is an assistant: the model proposes, a human taps Confirm for every payment. That is safe, and it is also
where every other entry stops. Version 2 lets agents spend money **on their own**, and makes it impossible for them to
spend it outside what a human signed, with a proof anyone can check.

## 1. Mandates: a human signs the limits once
A mandate is a small, typed document the shop owner signs (Ed25519, key in the browser):

```
agent: procurement
may:   buy  sku in [milk-1l, coffee-beans-1kg]  from suppliers [S-0042]
limit: €200 per ISO week, €60 per order, unit price ≤ 1.10 × 30-day median paid
until: 2026-12-31
```

Every tool call that moves money is checked by a **deterministic verifier** (no model involved) against the signed
mandates. Inside the mandate it executes without a tap; outside it becomes a proposal for a human, exactly like v1.
The verifier is small enough to test exhaustively (property tests: no sequence of calls can exceed any limit).

## 2. A ledger nobody can quietly rewrite
Every decision (call, verdict, mandate id, PayPal id) is appended to a hash chain; each day's Merkle root is
published. A receipt QR carries its inclusion proof, so a customer, an auditor or the tax office can check that a
payment is in the books and the books were not edited afterwards.

## 3. Agents that run the shop between customers
- **Forecasting** from the ledger itself (intermittent demand, Croston/TSB with weekly seasonality) decides what will
  run out and when.
- **Procurement** orders before it runs out, inside its mandate.
- **Agent-to-agent trade:** the supplier runs SpaceKasa too. The two agents negotiate quantity and price in a
  structured protocol (offers, counter-offers, bounded by both sides' mandates) and settle with a PayPal invoice
  that the buyer's agent pays. Two instances on the live demo trade with each other in real time.
- **Reconciliation** matches PayPal transactions to ledger entries and flags anything that does not belong.

## 4. What the demo shows
A morning at a café compressed into three minutes: sales at the till by voice, the forecast curve bending, the
procurement agent negotiating with the supplier agent, an order paid inside the mandate with no tap, an order that
would break the mandate stopping for a human, and a receipt verified against the published Merkle root on a phone.
