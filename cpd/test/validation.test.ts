import { describe, expect, it } from "vitest";
import { PaymentState } from "../src/cpd/types.js";
import { validatePaymentFields } from "../src/cpd/validation.js";

const base = {
  id: "pay_1",
  payer: { id: "p1", roles: ["payer"] },
  payee: { id: "p2", roles: ["payee"] },
  value: { amount: "1.00", asset: "USD" },
  intent: {},
  authorization: { method: "signature", data: {} },
  state: PaymentState.CREATED,
};

describe("validatePaymentFields — structural", () => {
  it("passes for a fully valid payment", () => {
    expect(validatePaymentFields(base)).toHaveLength(0);
  });

  it("flags missing payer.id", () => {
    const errors = validatePaymentFields({ ...base, payer: { id: "", roles: [] } });
    expect(errors.some((e) => e.field === "payer.id")).toBe(true);
  });

  it("flags a non-array roles field", () => {
    const errors = validatePaymentFields({
      ...base,
      // @ts-expect-error intentional
      payee: { id: "p2", roles: "payee" },
    });
    expect(errors.some((e) => e.field === "payee.roles")).toBe(true);
  });

  it("flags an unrecognized state", () => {
    const errors = validatePaymentFields({ ...base, state: "SOMETHING_ELSE" as PaymentState });
    expect(errors.some((e) => e.field === "state")).toBe(true);
  });

  it("flags missing authorization.data (opaque but required)", () => {
    const errors = validatePaymentFields({
      ...base,
      // @ts-expect-error intentional
      authorization: { method: "signature" },
    });
    expect(errors.some((e) => e.field === "authorization.data")).toBe(true);
  });
});

describe("validatePaymentFields — representational", () => {
  it("flags a number used for value.amount", () => {
    const errors = validatePaymentFields({ ...base, value: { amount: 1 as unknown as string, asset: "USD" } });
    expect(errors.some((e) => e.field === "value.amount" && e.kind === "representational")).toBe(true);
  });
});

describe("validatePaymentFields — optional fields", () => {
  it("accepts absent context and derived_from", () => {
    expect(validatePaymentFields(base)).toHaveLength(0);
  });

  it("flags a malformed context when present", () => {
    const errors = validatePaymentFields({
      ...base,
      // @ts-expect-error intentional
      context: { network: 5 },
    });
    expect(errors.some((e) => e.field === "context.network")).toBe(true);
  });

  it("flags an incomplete derived_from when present", () => {
    const errors = validatePaymentFields({
      ...base,
      // @ts-expect-error intentional
      derived_from: { request_id: "req_1" },
    });
    expect(errors.some((e) => e.field === "derived_from.cpr_version")).toBe(true);
  });
});
