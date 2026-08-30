import { describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "../src/http/server.js";

const app = createServer();

const validPayment = {
  id: "pay_http_001",
  payer: { id: "acct:payer", roles: ["payer"] },
  payee: { id: "acct:payee", roles: ["payee"] },
  value: { amount: "5.00", asset: "USD" },
  intent: { reference: "ref" },
  authorization: { method: "signature", data: {} },
  state: "CREATED",
};

describe("GET /v1", () => {
  it("returns implementation metadata", async () => {
    const res = await request(app).get("/v1");
    expect(res.status).toBe(200);
    expect(res.body.spec).toBe("FPSF-CPD-001");
    expect(res.body.codecs).toContain("cpd-json-v1");
  });
});

describe("GET /v1/health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /v1/payments", () => {
  it("accepts a valid payment", async () => {
    const res = await request(app).post("/v1/payments").send(validPayment);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.payment.id).toBe("pay_http_001");
  });

  it("returns 422 with field errors for an invalid payment", async () => {
    const res = await request(app).post("/v1/payments").send({ id: "" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fields).toBeTruthy();
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/v1/payments")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/payments/encode + decode", () => {
  it("round-trips through the HTTP layer", async () => {
    const encodeRes = await request(app).post("/v1/payments/encode").send(validPayment);
    expect(encodeRes.status).toBe(200);
    expect(encodeRes.body.encoding).toBe("cpd-json-v1");
    expect(encodeRes.body.uri).toMatch(/^fpsf-pay:cpd-json-v1\./);
    expect(encodeRes.body.stringifiedUri).toMatch(/^fpsf-pay:cpd-json-v1\?envelope=/);

    const decodeRes = await request(app)
      .post("/v1/payments/decode")
      .send({ payload: encodeRes.body.payload });
    expect(decodeRes.status).toBe(200);
    expect(decodeRes.body.payment.id).toBe("pay_http_001");
  });

  it("returns 400 when payload field is missing", async () => {
    const res = await request(app).post("/v1/payments/decode").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/payments/uri/decode", () => {
  it("decodes a Form 1 (envelope) fpsf-pay: URI", async () => {
    const encodeRes = await request(app).post("/v1/payments/encode").send(validPayment);
    const res = await request(app).post("/v1/payments/uri/decode").send({ uri: encodeRes.body.uri });
    expect(res.status).toBe(200);
    expect(res.body.form).toBe("envelope-or-stringified");
    expect(res.body.payment.id).toBe("pay_http_001");
  });

  it("decodes a Form 2 (stringified) fpsf-pay: URI", async () => {
    const encodeRes = await request(app).post("/v1/payments/encode").send(validPayment);
    const res = await request(app).post("/v1/payments/uri/decode").send({ uri: encodeRes.body.stringifiedUri });
    expect(res.status).toBe(200);
    expect(res.body.payment.id).toBe("pay_http_001");
  });

  it("returns an unresolved token result for a Form 3 URI, not an error", async () => {
    const res = await request(app)
      .post("/v1/payments/uri/decode")
      .send({ uri: "fpsf-pay:token?value=a1b2c3&sig=ed25519:MEUCIQDx" });
    expect(res.status).toBe(200);
    expect(res.body.form).toBe("token");
    expect(res.body.resolved).toBe(false);
    expect(res.body.value).toBe("a1b2c3");
  });

  it("returns 400 for a malformed fpsf-pay: URI", async () => {
    const res = await request(app).post("/v1/payments/uri/decode").send({ uri: "fpsf-pay:garbage" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MALFORMED_URI");
  });

  it("returns 400 when uri field is missing", async () => {
    const res = await request(app).post("/v1/payments/uri/decode").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/payments/uri/token", () => {
  it("wraps an externally minted token and signature as a Form 3 URI", async () => {
    const res = await request(app)
      .post("/v1/payments/uri/token")
      .send({ value: "a1b2c3", signatureAlg: "ed25519", signature: "MEUCIQDx" });
    expect(res.status).toBe(200);
    expect(res.body.uri).toBe("fpsf-pay:token?value=a1b2c3&sig=ed25519:MEUCIQDx");
  });

  it("returns 400 for a non-base64url token value", async () => {
    const res = await request(app)
      .post("/v1/payments/uri/token")
      .send({ value: "not a token!", signatureAlg: "ed25519", signature: "MEUCIQDx" });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/payments/uri/parse", () => {
  it("parses without decoding", async () => {
    const res = await request(app)
      .post("/v1/payments/uri/parse")
      .send({ uri: "fpsf-pay:token?value=a1b2c3&sig=ed25519:MEUCIQDx" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ form: "token", value: "a1b2c3", signatureAlg: "ed25519", signature: "MEUCIQDx" });
  });
});

describe("unknown route", () => {
  it("returns 404", async () => {
    const res = await request(app).get("/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
