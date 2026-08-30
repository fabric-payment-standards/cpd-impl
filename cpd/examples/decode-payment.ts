/**
 * Run: npm run example:decode
 */
import { Payment, PaymentState, canonicalJSON, encode, decode } from "../src/index.js";

const original = Payment.create({
  id: "pay_9f2c1e7a",
  payer: { id: "acct:payer-042", roles: ["payer"] },
  payee: { id: "acct:payee-777", roles: ["payee"] },
  value: { amount: "12.50", asset: "USD" },
  intent: { reference: "invoice-4471" },
  authorization: { method: "signature", data: { sig: "3045..." } },
  state: PaymentState.CREATED,
});

const { payload } = encode(original);
console.log(`payload: ${payload}\n`);

const decoded = decode(payload);
console.log(JSON.stringify(decoded.toJSON(), null, 2));

// Compare via canonicalJSON, not JSON.stringify(toJSON()) directly: the codec
// sorts object keys, so a naive string comparison of insertion-order JSON
// would report a false mismatch even though the payments are semantically
// identical. This is the correct way to assert round-trip equality.
console.log(`\nround-trip equal: ${canonicalJSON(decoded) === canonicalJSON(original)}`);
