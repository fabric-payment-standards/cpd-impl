import { describe, expect, it } from "vitest";
import { CpdValidationError, Payment, PaymentState } from "../src/index.js";

function validDraft() {
  return {
    id: "pay_abc123",
    payer: { id: "acct:payer", roles: ["payer"] },
    payee: { id: "acct:payee", roles: ["payee"] },
    value: { amount: "10.00", asset: "USD" },
    intent: { reference: "ref-1" },
    authorization: { method: "signature", data: { sig: "0x0" } },
  } as const;
}

describe("Payment.create", () => {
  it("constructs a valid payment and defaults state to CREATED", () => {
    const payment = Payment.create(validDraft());
    expect(payment.state).toBe(PaymentState.CREATED);
    expect(payment.id).toBe("pay_abc123");
  });

  it("rejects a missing id", () => {
    const draft = validDraft();
    // @ts-expect-error intentional violation for the test
    delete draft.id;
    expect(() => Payment.create(draft)).toThrow(CpdValidationError);
  });

  it("rejects a numeric amount masquerading as a value (precision safety)", () => {
    const draft = { ...validDraft(), value: { amount: 10 as unknown as string, asset: "USD" } };
    expect(() => Payment.create(draft)).toThrow(CpdValidationError);
  });

  it("rejects a negative amount", () => {
    const draft = { ...validDraft(), value: { amount: "-1.00", asset: "USD" } };
    expect(() => Payment.create(draft)).toThrow(CpdValidationError);
  });

  it("rejects a malformed decimal amount", () => {
    const draft = { ...validDraft(), value: { amount: "12.50.00", asset: "USD" } };
    expect(() => Payment.create(draft)).toThrow(CpdValidationError);
  });

  it("accepts optional context and derived_from", () => {
    const payment = Payment.create({
      ...validDraft(),
      context: { network: "polygon", rail: "stablecoin-stack" },
      derived_from: { request_id: "req_1", cpr_version: "1.0.0" },
    });
    expect(payment.context?.network).toBe("polygon");
    expect(payment.derived_from?.request_id).toBe("req_1");
  });
});

describe("Payment lifecycle", () => {
  it("follows the CPD-001 monotonic transition graph", () => {
    const created = Payment.create(validDraft());
    const authorized = created.authorize({ method: "signature", data: { sig: "0x1" } });
    expect(authorized.state).toBe(PaymentState.AUTHORIZED);

    const inFlight = authorized.submit({ rail: "stablecoin-stack" });
    expect(inFlight.state).toBe(PaymentState.IN_FLIGHT);

    const settled = inFlight.settle();
    expect(settled.state).toBe(PaymentState.SETTLED);
  });

  it("allows AUTHORIZED -> CANCELLED", () => {
    const created = Payment.create(validDraft());
    const authorized = created.authorize({ method: "signature", data: {} });
    const cancelled = authorized.cancel();
    expect(cancelled.state).toBe(PaymentState.CANCELLED);
  });

  it("rejects CREATED -> IN_FLIGHT (skipping AUTHORIZED)", () => {
    const created = Payment.create(validDraft());
    expect(() => created.submit()).toThrow(CpdValidationError);
  });

  it("rejects any transition out of a terminal state", () => {
    const created = Payment.create(validDraft());
    const authorized = created.authorize({ method: "signature", data: {} });
    const inFlight = authorized.submit();
    const settled = inFlight.settle();
    expect(() => settled.settle()).toThrow(CpdValidationError);
    expect(() => settled.fail()).toThrow(CpdValidationError);
  });

  it("does not mutate the original instance — transitions return new objects", () => {
    const created = Payment.create(validDraft());
    const authorized = created.authorize({ method: "signature", data: {} });
    expect(created.state).toBe(PaymentState.CREATED);
    expect(authorized.state).toBe(PaymentState.AUTHORIZED);
    expect(created).not.toBe(authorized);
  });

  it("Payment instances are frozen", () => {
    const created = Payment.create(validDraft());
    expect(Object.isFrozen(created)).toBe(true);
  });
});

describe("Payment.check", () => {
  it("returns field-level errors without throwing", () => {
    const errors = Payment.check({});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === "id")).toBe(true);
  });
});
