/**
 * FPSF-CPD-003 — the three representation forms of the `fpsf-pay:` URI
 * scheme, side by side.
 *
 * Run: npx tsx examples/uri-payment.ts
 */
import {
  Payment,
  PaymentState,
  decodeURI,
  encodeEnvelopeURI,
  encodeStringifiedURI,
  encodeTokenURI,
  UnresolvedTokenUriError,
} from "../src/index.js";

const payment = Payment.create({
  id: "pay_9f2c1e7a",
  payer: { id: "acct:payer-042", roles: ["payer"] },
  payee: { id: "acct:payee-777", roles: ["payee"] },
  value: { amount: "12.50", asset: "USD" },
  intent: { reference: "invoice-4471" },
  authorization: { method: "signature", data: { sig: "3045..." } },
  state: PaymentState.CREATED,
});

// Form 1 — Opaque Envelope (preferred: most compact, no percent-encoding)
const envelopeUri = encodeEnvelopeURI(payment);
console.log("Form 1 (opaque envelope):");
console.log(`  ${envelopeUri}`);
console.log(`  length: ${envelopeUri.length} chars\n`);

// Form 2 — Stringified Envelope (human-legible, larger due to percent-encoding)
const stringifiedUri = encodeStringifiedURI(payment);
console.log("Form 2 (stringified envelope):");
console.log(`  ${stringifiedUri}`);
console.log(`  length: ${stringifiedUri.length} chars\n`);

// Form 3 — Ephemeral Token + Signature (a *reference*, not the payload itself)
// In a real deployment, `value` and `sig` would be minted and signed by the
// payee's issuing system, and resolved out of band (CPD-003 §12.4) — this
// package does not implement that resolution step.
const tokenUri = encodeTokenURI("a1b2c3d4e5f6", "ed25519", "MEUCIQDxSampleEd25519SignatureBytes");
console.log("Form 3 (ephemeral token + signature):");
console.log(`  ${tokenUri}`);
console.log(`  length: ${tokenUri.length} chars — constant, independent of Payment size\n`);

// decodeURI resolves Forms 1 and 2 directly...
console.log("decodeURI(Form 1) ->", decodeURI(envelopeUri).id);
console.log("decodeURI(Form 2) ->", decodeURI(stringifiedUri).id);

// ...but Form 3 has no embedded payload, so decodeURI throws a typed,
// catchable error carrying the token reference instead.
try {
  decodeURI(tokenUri);
} catch (err) {
  if (err instanceof UnresolvedTokenUriError) {
    console.log(`decodeURI(Form 3) -> UnresolvedTokenUriError: value="${err.value}" alg=${err.signatureAlg}`);
  } else {
    throw err;
  }
}
