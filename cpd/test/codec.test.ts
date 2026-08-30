import { describe, expect, it } from "vitest";
import { Payment, PaymentState } from "../src/index.js";
import { canonicalJSON, decode, encode, roundTrip } from "../src/cpd/codec.js";

function samplePayment(): Payment {
  return Payment.create({
    id: "pay_fixture_001",
    payer: { id: "acct:payer", roles: ["payer"] },
    payee: { id: "acct:payee", roles: ["payee"] },
    value: { amount: "12.50", asset: "USD" },
    intent: { reference: "invoice-4471" },
    authorization: { method: "signature", data: { sig: "3045..." } },
    state: PaymentState.CREATED,
  });
}

describe("canonicalJSON", () => {
  it("sorts object keys deterministically regardless of input order", () => {
    const a = canonicalJSON({ b: 1, a: 2, c: { z: 1, a: 2 } });
    const b = canonicalJSON({ c: { a: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"a":2,"z":1}}');
  });

  it("omits undefined fields rather than emitting null", () => {
    const json = canonicalJSON({ a: 1, b: undefined });
    expect(json).toBe('{"a":1}');
  });
});

describe("encode / decode", () => {
  it("round-trips a payment without semantic drift", () => {
    const original = samplePayment();
    const decoded = roundTrip(original);
    expect(decoded.toJSON()).toEqual(original.toJSON());
  });

  it("produces a deterministic payload for the same payment", () => {
    const p1 = samplePayment();
    const p2 = samplePayment();
    expect(encode(p1).payload).toBe(encode(p2).payload);
  });

  it("reports the encoding id and byte length", () => {
    const encoded = encode(samplePayment());
    expect(encoded.encoding).toBe("cpd-json-v1");
    expect(encoded.length).toBeGreaterThan(0);
  });

  it("rejects a payload that is not valid base64url", () => {
    expect(() => decode("not-base64!!! @@@")).toThrow();
  });

  it("rejects a payload that decodes to invalid JSON", () => {
    const garbage = Buffer.from("not json", "utf-8").toString("base64url");
    expect(() => decode(garbage)).toThrow(SyntaxError);
  });

  it("rejects a payload that decodes to JSON failing CPD-001 validation", () => {
    const invalid = Buffer.from(JSON.stringify({ id: "" }), "utf-8").toString("base64url");
    expect(() => decode(invalid)).toThrow();
  });

  it("rejects a truncated payload", () => {
    const encoded = encode(samplePayment()).payload;
    expect(() => decode(encoded.slice(0, Math.floor(encoded.length / 2)))).toThrow();
  });
});
