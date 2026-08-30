# @fpsf/cpd

**FPSF-CPD-001 — Canonical Payment Definition**

**One payment interface. Any payment rail.**

`@fpsf/cpd` is a reference implementation of [FPSF-CPD-001](./spec/CPD-001.md), an open,
minimal, rail-agnostic model of a **Payment**. It gives you a canonical `Payment` object,
validation against the specification's normative constraints, a small deterministic codec
for transporting a Payment as an opaque token, and a thin REST server exposing all of it.

CPD is not a payment processor, a wallet, a blockchain, or a settlement network. It does not
move money. It defines what a payment *is*, independently of how it gets settled — so that
the rail underneath can be swapped without rewriting everything above it.

---

## What CPD does

- Defines canonical payment semantics: participants, value, intent, authorization, lifecycle
  state.
- Normalizes and validates payment information against CPD-001's stated invariants.
- Provides an interoperable, JSON-friendly representation.
- Provides codec boundaries — a Payment can be represented as JSON, as this reference
  implementation's compact token, or as a completely different specialized encoding (see
  [Specialized codecs](#specialized-codecs) below).
- Lets downstream systems choose their own settlement mechanism.

## What CPD does not do

- Custody funds.
- Settle transactions.
- Operate a payment network.
- Replace wallets, banks, or card networks.
- Determine which rail must be used for a given payment.

---

## Architecture

```
Payment intent
      │
      ▼
   CPD-001                (this package: src/cpd)
      │
      ├──── REST / JSON    (this package: src/http)
      ├──── Compact / QR   (FPSF-SS-005 / CPRE — a separate, specialized codec)
      └──── Other codecs
      │
      ▼
Rail adapter                (not part of this package)
      │
      ▼
Settlement                  (SEPA, cards, the Stablecoin Stack, ...)
```

The payment rail should be replaceable without rewriting the payment interface. This package
implements the top of that diagram — nothing below "Rail adapter" is in scope here.

---

## Install

```bash
npm install
```

(This repository is a self-contained reference implementation, not yet published to a
registry — `npm install` here installs its own dependencies for local use.)

---

## Five-minute quickstart (TypeScript)

```ts
import { Payment, PaymentState } from "@fpsf/cpd";

const payment = Payment.create({
  id: "pay_9f2c1e7a",
  payer: { id: "acct:payer-042", roles: ["payer"] },
  payee: { id: "acct:payee-777", roles: ["payee"] },
  value: { amount: "12.50", asset: "USD" },
  intent: { reference: "invoice-4471" },
  authorization: { method: "signature", data: { sig: "3045..." } },
  state: PaymentState.CREATED,
});

payment.validate();          // throws CpdValidationError on any violation
console.log(payment.toJSON());

const authorized = payment.authorize({ method: "signature", data: { sig: "3046..." } });
console.log(authorized.state); // "AUTHORIZED"
```

Run the equivalent example directly:

```bash
npm run example:create
npm run example:encode
npm run example:decode
```

---

## REST quickstart

Start the reference server:

```bash
npm run dev
# @fpsf/cpd reference server listening on http://localhost:8787
```

```bash
curl -s -X POST http://localhost:8787/v1/payments \
  -H "Content-Type: application/json" \
  -d '{
    "id": "pay_9f2c1e7a",
    "payer": { "id": "acct:payer-042", "roles": ["payer"] },
    "payee": { "id": "acct:payee-777", "roles": ["payee"] },
    "value": { "amount": "12.50", "asset": "USD" },
    "intent": { "reference": "invoice-4471" },
    "authorization": { "method": "signature", "data": { "sig": "3045..." } },
    "state": "CREATED"
  }'
```

More copy/paste examples, including `encode` and `decode`, are in
[`examples/curl/`](./examples/curl/).

The conceptual flow:

```
Create canonical payment
        ↓
POST to codec
        ↓
Receive encoded representation
        ↓
Transport it through your existing system
        ↓
Decode it
        ↓
Select/execute your settlement rail
```

CPD does not settle the transaction. It only carries the intent.

---

## The smallest possible Payment

```json
{
  "id": "pay_9f2c1e7a",
  "payer": { "id": "acct:payer-042", "roles": ["payer"] },
  "payee": { "id": "acct:payee-777", "roles": ["payee"] },
  "value": { "amount": "12.50", "asset": "USD" },
  "intent": {},
  "authorization": { "method": "signature", "data": {} },
  "state": "CREATED"
}
```

Every field here corresponds directly to a field defined in CPD-001 §3 — nothing has been
renamed, and nothing implicit has been added.

---

## API surface

### Domain (`src/cpd`)

| Export | Description |
|---|---|
| `Payment.create(draft)` | Construct and validate a Payment. `state` defaults to `CREATED`. Throws `CpdValidationError`. |
| `Payment.fromJSON(input)` | Construct a Payment from an already-JSON-shaped object (e.g. a decoded payload). |
| `Payment.check(draft)` | Non-throwing validation — returns the full list of `FieldError`s. |
| `payment.authorize(proof)` | CPD-001 §5.2 — attach authorization, transition to `AUTHORIZED`. |
| `payment.submit(context?)` | CPD-001 §5.3 — transition to `IN_FLIGHT`. |
| `payment.settle()` | CPD-001 §5.4 — transition to `SETTLED`. |
| `payment.cancel()` | CPD-001 §5.6 — transition to `CANCELLED` (only valid before settlement). |
| `payment.fail()` | Transition to `FAILED`. |
| `payment.toJSON()` | Canonical, JSON-serializable representation. |
| `encode(payment)` / `decode(payload)` | This implementation's reference codec (see below). |

Every mutator (`authorize`, `submit`, `settle`, `cancel`, `fail`) returns a **new**, frozen
`Payment` instance. Instances are never mutated in place, and every transition is validated
against CPD-001's transition graph before it is allowed.

### HTTP (`src/http`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1` | Implementation metadata (name, version, spec ID, supported codecs). |
| `GET` | `/v1/health` | `{ "status": "ok" }` |
| `POST` | `/v1/payments` | Validate and normalize a candidate Payment. |
| `POST` | `/v1/payments/encode` | Encode a Payment with the reference codec. |
| `POST` | `/v1/payments/decode` | Decode a reference-codec payload back into a Payment. |

---

## The reference codec — important normative note

**CPD-001 defines Payment *semantics*, not a wire format.** Encoding and transport are
explicitly left to companion specifications or to rail-specific adapters.

This package's `src/cpd/codec.ts` therefore implements one deliberately simple codec,
`cpd-json-v1`, as a *reference* transport: deterministic key-sorted JSON, UTF-8 encoded, then
base64url-encoded into a single opaque token. **This codec is this implementation's choice,
not a CPD-001 requirement.** Do not cite `cpd-json-v1` as normative CPD-001 wire format.

---

## Specialized codecs

CPD-001 is the canonical semantic layer. Specialized, transport-optimized encodings are built
*on top of* it for particular use cases:

```
CPD-001
  canonical payment semantics
       │
       ├── REST / JSON codec              (this package)
       │
       └── CPRE / FPSF-SS-005
             Cryptocurrency payment request encoding —
             a compact, QR-optimized binary format for
             crypto-settled payment requests within the
             Stablecoin Stack.
```

[FPSF-SS-005](../ss-005) is a specialized crypto-payment-request representation, not the
parent concept. It is a sibling codec, not a dependency of this package.

---

## Use cases

If your system accepts more than one payment rail, CPD gives those rails a common payment
interface:

- Checkout and point-of-sale
- Invoicing and B2B billing
- Cross-border payments
- Payment orchestration across multiple processors
- Fintech platforms and wallets normalizing inbound payment data
- Marketplaces reconciling payouts across settlement mechanisms
- Recurring payment requests
- Multi-rail payment routing

CPD does not perform routing itself — it gives the systems that do routing a shared
representation to route on top of.

---

## Integration checklist

- [ ] CPD objects validate successfully (`Payment.create` / `Payment.check`).
- [ ] Monetary values are handled as decimal strings — never `number` — end to end.
- [ ] Canonical serialization is deterministic in your usage (`canonicalJSON`).
- [ ] Errors are surfaced explicitly to the caller, not swallowed.
- [ ] Settlement logic lives outside the CPD layer, in your rail adapter.
- [ ] Your rail adapter consumes the canonical Payment representation (`payment.toJSON()`),
      not internal implementation details of this package.
- [ ] Round-trip encode/decode tests pass for the payloads you actually send (`npm test`).
- [ ] State transitions in your system follow the CPD-001 transition graph — no direct writes
      to `state` outside of `authorize` / `submit` / `settle` / `fail` / `cancel`.

---

## The `fpsf-pay:` URI scheme (FPSF-CPD-003)

Alongside the JSON codec above, this package implements [FPSF-CPD-003](./spec/CPD-003.md), a
companion specification defining a minimal, codec-agnostic URI scheme for carrying — or
pointing to — a payment payload across a link, deep link, or QR code. It defines **three**
distinct, closed representation forms, not one:

| Form | Looks like | Compactness | QR-appropriate |
|---|---|---|---|
| **1 — Opaque Envelope** (preferred) | `fpsf-pay:cpd-json-v1.eyJhdXRo...` | Best | Only if the Payment is known to be small |
| **2 — Stringified Envelope** | `fpsf-pay:cpd-json-v1?envelope=%7B%22id%22...` | Worst — JSON's delimiters expand under percent-encoding | No |
| **3 — Ephemeral Token + Signature** | `fpsf-pay:token?value=a1b2c3&sig=ed25519:MEUC...` | Best, and independent of Payment size | Yes, by design |

Form 3 does not carry the payload at all — it carries a short, signed *reference* to one,
resolved out of band. This exists because a CPD-001 `Payment` has several genuinely unbounded
fields (`intent.conditions`, opaque `authorization.data`, and so on), so — unlike FPSF-SS-005's
fixed-width CPRE payloads, which are engineered to fit a QR code by design — there's no
guarantee an arbitrary Payment's full envelope does too. See CPD-003 §13 for the full
reasoning, and `examples/uri-payment.ts` for real size numbers (a representative Payment: 397
chars for Form 1, 518 for Form 2, 81 — constant — for Form 3).

```ts
import { encodeEnvelopeURI, encodeStringifiedURI, encodeTokenURI, decodeURI } from "@fpsf/cpd";

encodeEnvelopeURI(payment);      // Form 1 — preferred
encodeStringifiedURI(payment);   // Form 2 — human-legible, larger
encodeTokenURI(value, "ed25519", signature); // Form 3 — a reference, not a payload

decodeURI(uri); // resolves Forms 1–2 to a Payment; throws UnresolvedTokenUriError for Form 3
```

Run `npx tsx examples/uri-payment.ts` to see all three side by side, or `POST
/v1/payments/uri/decode`, `/v1/payments/uri/token`, and `/v1/payments/uri/parse` over REST.

**Building a client?** [`public/uri-scheme-guide.html`](./public/uri-scheme-guide.html) has full
TypeScript (React) and Flutter (Dart) integration code for all three forms — receiving,
resolving Form 3, and constructing — covering both the hosted-codec and local/copy-pasted paths.

**Closed parameter vocabulary.** Every query parameter this scheme accepts is enumerated in
CPD-003 §10 — a decoder MUST reject any URI carrying an unrecognized parameter, a missing
required one, or a duplicate, rather than tolerantly ignoring it. This implementation enforces
that rejection at the parser level (`src/cpd/uri.ts`), not as an afterthought.

**Relationship to RFC 8905 (`payto:`).** [`payto:`](https://datatracker.ietf.org/doc/html/rfc8905)
is an IETF-standardized scheme for identifying a payment *target* (an IBAN, a card reference) —
closer to `mailto:` for a payment address. `fpsf-pay:` operates one layer up: it carries a
structured payment (or payment request) object, or a verifiable reference to one. The two are
complementary, not competing — a CPD-001 Payment's `payee.id` or `context` MAY itself carry a
`payto:` value where that's the natural way to express a target for the settlement rail in use.
See CPD-003 §3.4 for the full comparison.

---

## Development

```bash
npm install
npm run build        # builds src/ only, to dist/
npm test              # runs the full test suite (vitest)
npm run dev            # runs the REST server directly from source (tsx)
npm start                # runs the compiled REST server from dist/
```

### Repository layout

```
cpd/
├── spec/
│   ├── CPD-001.md            working copy of the Payment definition
│   ├── CPD-002.md            working copy of the Canonical Payment Request
│   └── CPD-003.md            working copy of the fpsf-pay: URI scheme
├── src/
│   ├── cpd/                 domain model — usable standalone, no HTTP dependency
│   │   ├── types.ts
│   │   ├── Payment.ts
│   │   ├── validation.ts
│   │   ├── codec.ts
│   │   ├── uri.ts           FPSF-CPD-003 — all three representation forms
│   │   └── index.ts
│   ├── http/                thin REST layer on top of src/cpd
│   │   ├── server.ts
│   │   ├── routes.ts
│   │   └── errors.ts
│   └── index.ts
├── test/                    vitest suite (domain, validation, codec, uri, HTTP)
├── examples/                minimal runnable TypeScript + curl examples
└── public/index.html        developer landing page
```

---

## Testing and conformance

Run `npm test` to execute the full suite: domain-model construction and lifecycle rules,
field-level validation (structural, semantic, and representational failures), codec
round-tripping and tamper rejection, and the complete HTTP surface exercised in-process.

There is no claim of conformance beyond what these tests actually check. Read them —
`test/` is designed to be inspected, not taken on faith.

---

## Specification reference

- [FPSF-CPD-001 — Canonical Payment Definition](./spec/CPD-001.md) (working copy)
- [FPSF-CPD-002 — Canonical Payment Request](./spec/CPD-002.md) (working copy; defines the
  payer-agnostic `CanonicalPaymentRequest` and the `derivePayment` procedure — not yet
  implemented in this package, see CPD-002 §13)
- [FPSF-CPD-003 — Payment URI Scheme (`fpsf-pay:`)](./spec/CPD-003.md) (working copy)
- FPSF-SS-005 — Cryptocurrency Payment Request Encoding (a specialized, sibling codec)
- [RFC 8905 — The 'payto' URI Scheme for Payments](https://datatracker.ietf.org/doc/html/rfc8905)
  (a related, complementary IETF scheme — see CPD-003 §3.4)

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

CPD-001 is an open specification maintained by the Fabric Payment Standards Foundation. Read
the specification, run this implementation, and inspect the tests — that is the intended way
to evaluate it.
