/**
 * The smallest possible working example: construct a CPD-001 Payment,
 * validate it, and print its canonical JSON representation.
 *
 * Run: npm run example:create
 */
import { Payment, PaymentState } from "../src/index.js";

const payment = Payment.create({
  id: "pay_9f2c1e7a",
  payer: { id: "acct:payer-042", roles: ["payer"] },
  payee: { id: "acct:payee-777", roles: ["payee"] },
  value: { amount: "12.50", asset: "USD" },
  intent: { reference: "invoice-4471" },
  authorization: { method: "signature", data: { sig: "3045..." } },
  state: PaymentState.CREATED,
});

console.log(JSON.stringify(payment.toJSON(), null, 2));

const authorized = payment.authorize({ method: "signature", data: { sig: "3046..." } });
console.log(`\nstate after authorize(): ${authorized.state}`);
