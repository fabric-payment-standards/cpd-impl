/**
 * Run: npm run example:encode
 */
import { Payment, PaymentState, encode } from "../src/index.js";

const payment = Payment.create({
  id: "pay_9f2c1e7a",
  payer: { id: "acct:payer-042", roles: ["payer"] },
  payee: { id: "acct:payee-777", roles: ["payee"] },
  value: { amount: "12.50", asset: "USD" },
  intent: { reference: "invoice-4471" },
  authorization: { method: "signature", data: { sig: "3045..." } },
  state: PaymentState.CREATED,
});

const encoded = encode(payment);
console.log(encoded);
