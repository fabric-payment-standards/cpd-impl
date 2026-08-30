import { describe, expect, it } from "vitest";
import { Payment, PaymentState } from "../src/index.js";
import {
  CpdUriError,
  UnresolvedTokenUriError,
  decodeURI,
  encodeEnvelopeURI,
  encodeStringifiedURI,
  encodeTokenURI,
  parseURI,
  toEnvelopeURI,
} from "../src/cpd/uri.js";

function samplePayment(): Payment {
  return Payment.create({
    id: "pay_uri_fixture",
    payer: { id: "acct:payer", roles: ["payer"] },
    payee: { id: "acct:payee", roles: ["payee"] },
    value: { amount: "12.50", asset: "USD" },
    intent: { reference: "invoice-4471" },
    authorization: { method: "signature", data: { sig: "3045..." } },
    state: PaymentState.CREATED,
  });
}

describe("Form 1 — Opaque Envelope", () => {
  it("round-trips a payment through encodeEnvelopeURI / decodeURI", () => {
    const original = samplePayment();
    const uri = encodeEnvelopeURI(original);
    expect(uri.startsWith("fpsf-pay:cpd-json-v1.")).toBe(true);
    const decoded = decodeURI(uri);
    expect(decoded.toJSON()).toEqual(original.toJSON());
  });

  it("parses into the envelope form with codec and payload fields", () => {
    const uri = encodeEnvelopeURI(samplePayment());
    const parsed = parseURI(uri);
    expect(parsed.form).toBe("envelope");
    if (parsed.form === "envelope") {
      expect(parsed.codec).toBe("cpd-json-v1");
      expect(parsed.payload.length).toBeGreaterThan(0);
    }
  });

  it("rejects a query string appended after a valid Form 1 body", () => {
    const uri = encodeEnvelopeURI(samplePayment()) + "?evil=1";
    expect(() => parseURI(uri)).toThrow(CpdUriError);
  });

  it("rejects the reserved codec token \"token\" in Form 1", () => {
    expect(() => toEnvelopeURI("token", "abc123")).toThrow(CpdUriError);
  });

  it("rejects a non-base64url payload", () => {
    expect(() => toEnvelopeURI("cpd-json-v1", "not base64!! + / =")).toThrow(CpdUriError);
  });

  it("rejects a body with no \".\" separator", () => {
    expect(() => parseURI("fpsf-pay:nodotpayload")).toThrow(CpdUriError);
  });

  it("rejects an unsupported codec token on decode", () => {
    const uri = toEnvelopeURI("cpre1", "AQGAAA");
    expect(() => decodeURI(uri)).toThrow(/unsupported codec token/);
  });
});

describe("Form 2 — Stringified Envelope", () => {
  it("round-trips a payment through encodeStringifiedURI / decodeURI", () => {
    const original = samplePayment();
    const uri = encodeStringifiedURI(original);
    expect(uri.startsWith("fpsf-pay:cpd-json-v1?envelope=")).toBe(true);
    const decoded = decodeURI(uri);
    expect(decoded.toJSON()).toEqual(original.toJSON());
  });

  it("percent-encodes JSON delimiters", () => {
    const uri = encodeStringifiedURI(samplePayment());
    expect(uri).not.toContain("{");
    expect(uri).not.toContain('"');
    expect(uri).toContain("%7B"); // {
    expect(uri).toContain("%22"); // "
  });

  it("never interprets a literal \"+\" as a space", () => {
    const withPlus = Payment.create({
      id: "pay_plus",
      payer: { id: "acct:payer", roles: ["payer"] },
      payee: { id: "acct:payee", roles: ["payee"] },
      value: { amount: "1.00", asset: "USD" },
      intent: { reference: "a+b literal plus" },
      authorization: { method: "signature", data: {} },
      state: PaymentState.CREATED,
    });
    const uri = encodeStringifiedURI(withPlus);
    // The literal "+" must itself be percent-encoded (%2B), not left bare.
    expect(uri).toContain("%2B");
    const decoded = decodeURI(uri);
    expect(decoded.intent.reference).toBe("a+b literal plus");
  });

  it("rejects extra query parameters", () => {
    const base = encodeStringifiedURI(samplePayment());
    expect(() => parseURI(`${base}&extra=1`)).toThrow(CpdUriError);
  });

  it("rejects a missing envelope parameter", () => {
    expect(() => parseURI("fpsf-pay:cpd-json-v1?nope=1")).toThrow(CpdUriError);
  });

  it("rejects duplicate parameters", () => {
    const encoded = encodeURIComponent(JSON.stringify({ a: 1 }));
    expect(() => parseURI(`fpsf-pay:cpd-json-v1?envelope=${encoded}&envelope=${encoded}`)).toThrow(CpdUriError);
  });

  it("rejects the cpre1 codec token for Form 2 on decode (no stringified form defined)", () => {
    const encoded = encodeURIComponent(JSON.stringify({ a: 1 }));
    const uri = `fpsf-pay:cpre1?envelope=${encoded}`;
    expect(() => decodeURI(uri)).toThrow(/unsupported codec token/);
  });
});

describe("Form 3 — Ephemeral Token + Signature", () => {
  it("constructs a well-formed URI", () => {
    const uri = encodeTokenURI("a1b2c3", "ed25519", "MEUCIQDx");
    expect(uri).toBe("fpsf-pay:token?value=a1b2c3&sig=ed25519:MEUCIQDx");
  });

  it("parses value, signatureAlg, and signature regardless of parameter order", () => {
    const p1 = parseURI("fpsf-pay:token?value=abc&sig=ed25519:xyz");
    const p2 = parseURI("fpsf-pay:token?sig=ed25519:xyz&value=abc");
    expect(p1).toEqual(p2);
    expect(p1.form).toBe("token");
  });

  it("decodeURI throws UnresolvedTokenUriError, carrying the parsed fields", () => {
    const uri = encodeTokenURI("a1b2c3", "ed25519", "MEUCIQDx");
    try {
      decodeURI(uri);
      throw new Error("expected decodeURI to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnresolvedTokenUriError);
      if (err instanceof UnresolvedTokenUriError) {
        expect(err.value).toBe("a1b2c3");
        expect(err.signatureAlg).toBe("ed25519");
        expect(err.signature).toBe("MEUCIQDx");
      }
    }
  });

  it("rejects a missing sig parameter", () => {
    expect(() => parseURI("fpsf-pay:token?value=abc")).toThrow(CpdUriError);
  });

  it("rejects an extra parameter alongside value and sig", () => {
    expect(() => parseURI("fpsf-pay:token?value=abc&sig=ed25519:xyz&expires=123")).toThrow(CpdUriError);
  });

  it("rejects a sig with no algorithm prefix", () => {
    expect(() => parseURI("fpsf-pay:token?value=abc&sig=justbytes")).toThrow(CpdUriError);
  });

  it("rejects construction with a non-base64url token value", () => {
    expect(() => encodeTokenURI("not a token!", "ed25519", "abc")).toThrow(CpdUriError);
  });
});

describe("Common parsing algorithm — cross-form rejections", () => {
  it("rejects a totally malformed scheme prefix", () => {
    expect(() => parseURI("not-fpsf-pay:cpd-json-v1.abc")).toThrow(CpdUriError);
  });

  it("rejects an empty query string", () => {
    expect(() => parseURI("fpsf-pay:cpd-json-v1?")).toThrow(CpdUriError);
  });

  it("rejects a Form 2 codec token containing a literal \".\"", () => {
    expect(() => parseURI("fpsf-pay:cpd.json-v1?envelope=abc")).toThrow(CpdUriError);
  });

  it("treats parameter keys as case-sensitive", () => {
    expect(() => parseURI("fpsf-pay:token?Value=abc&sig=ed25519:xyz")).toThrow(CpdUriError);
  });
});
