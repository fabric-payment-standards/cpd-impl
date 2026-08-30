/**
 * FPSF-CPD-001 — Validation layer.
 *
 * Validation is kept as a distinct layer from the domain model so that
 * callers can inspect every failure at once, rather than stopping at the
 * first thrown error. Each failure identifies the field, the rule that
 * failed, and (where useful) the offending value.
 */

import {
  ALLOWED_TRANSITIONS,
  type ExecutionContext,
  type PaymentFields,
  type PaymentRequestReference,
  PaymentState,
  type Participant,
  type Value,
} from "./types.js";

export type ValidationKind = "structural" | "semantic" | "representational";

export interface FieldError {
  /** Dotted path to the offending field, e.g. "value.amount". */
  field: string;
  /** Human-readable description of the rule that failed. */
  rule: string;
  /** The offending value, when it can be usefully shown. */
  value?: unknown;
  kind: ValidationKind;
}

export class CpdValidationError extends Error {
  readonly errors: FieldError[];

  constructor(errors: FieldError[]) {
    super(
      `Payment failed validation: ${errors
        .map((e) => `${e.field}: ${e.rule}`)
        .join("; ")}`,
    );
    this.name = "CpdValidationError";
    this.errors = errors;
  }
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;
const NON_EMPTY = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function pushIf(errors: FieldError[], condition: boolean, error: FieldError): void {
  if (condition) errors.push(error);
}

function validateParticipant(field: string, p: Participant | undefined, errors: FieldError[]): void {
  if (p == null || typeof p !== "object") {
    errors.push({ field, rule: "must be a Participant object", kind: "structural", value: p });
    return;
  }
  pushIf(errors, !NON_EMPTY(p.id), {
    field: `${field}.id`,
    rule: "must be a non-empty string identifier",
    kind: "structural",
    value: p.id,
  });
  pushIf(errors, !Array.isArray(p.roles), {
    field: `${field}.roles`,
    rule: "must be an array of role strings",
    kind: "structural",
    value: p.roles,
  });
  if (Array.isArray(p.roles)) {
    p.roles.forEach((role, i) => {
      pushIf(errors, typeof role !== "string" || role.trim().length === 0, {
        field: `${field}.roles[${i}]`,
        rule: "must be a non-empty string",
        kind: "structural",
        value: role,
      });
    });
  }
}

function validateValue(value: Value | undefined, errors: FieldError[]): void {
  if (value == null || typeof value !== "object") {
    errors.push({ field: "value", rule: "must be a Value object", kind: "structural", value });
    return;
  }
  pushIf(errors, typeof value.amount !== "string", {
    field: "value.amount",
    rule: "must be a decimal string, never a number (precision safety)",
    kind: "representational",
    value: value.amount,
  });
  if (typeof value.amount === "string") {
    pushIf(errors, !DECIMAL_STRING.test(value.amount), {
      field: "value.amount",
      rule: "must match a non-negative or negative decimal string, e.g. \"12.50\"",
      kind: "structural",
      value: value.amount,
    });
    pushIf(errors, DECIMAL_STRING.test(value.amount) && value.amount.startsWith("-"), {
      field: "value.amount",
      rule: "must be non-negative — a Payment value cannot be negative",
      kind: "semantic",
      value: value.amount,
    });
  }
  pushIf(errors, !NON_EMPTY(value.asset), {
    field: "value.asset",
    rule: "must be a non-empty asset identifier",
    kind: "structural",
    value: value.asset,
  });
}

function validateContext(context: ExecutionContext | undefined, errors: FieldError[]): void {
  if (context === undefined) return;
  if (typeof context !== "object" || context === null) {
    errors.push({ field: "context", rule: "must be an object when present", kind: "structural", value: context });
    return;
  }
  for (const key of ["network", "rail", "settlementModel"] as const) {
    const v = context[key];
    pushIf(errors, v !== undefined && typeof v !== "string", {
      field: `context.${key}`,
      rule: "must be a string when present",
      kind: "structural",
      value: v,
    });
  }
}

function validateDerivedFrom(ref: PaymentRequestReference | undefined, errors: FieldError[]): void {
  if (ref === undefined) return;
  if (typeof ref !== "object" || ref === null) {
    errors.push({ field: "derived_from", rule: "must be an object when present", kind: "structural", value: ref });
    return;
  }
  pushIf(errors, !NON_EMPTY(ref.request_id), {
    field: "derived_from.request_id",
    rule: "must be a non-empty string",
    kind: "structural",
    value: ref.request_id,
  });
  pushIf(errors, !NON_EMPTY(ref.cpr_version), {
    field: "derived_from.cpr_version",
    rule: "must be a non-empty string",
    kind: "structural",
    value: ref.cpr_version,
  });
}

/**
 * Validate a candidate `PaymentFields` object against every constraint of
 * CPD-001 that can be checked locally (i.e. without contacting a system of
 * record). Returns the full list of failures — never throws.
 */
export function validatePaymentFields(input: Partial<PaymentFields>): FieldError[] {
  const errors: FieldError[] = [];

  pushIf(errors, !NON_EMPTY(input.id), {
    field: "id",
    rule: "must be a non-empty, contextually unique PaymentIdentifier (CPD-001 Invariant 1)",
    kind: "structural",
    value: input.id,
  });

  validateParticipant("payer", input.payer, errors);
  validateParticipant("payee", input.payee, errors);
  validateValue(input.value, errors);

  if (input.intent === undefined || typeof input.intent !== "object" || input.intent === null) {
    errors.push({ field: "intent", rule: "must be an IntentDescriptor object", kind: "structural", value: input.intent });
  } else {
    pushIf(errors, input.intent.reference !== undefined && typeof input.intent.reference !== "string", {
      field: "intent.reference",
      rule: "must be a string when present",
      kind: "structural",
      value: input.intent.reference,
    });
    pushIf(errors, input.intent.conditions !== undefined && !Array.isArray(input.intent.conditions), {
      field: "intent.conditions",
      rule: "must be an array when present",
      kind: "structural",
      value: input.intent.conditions,
    });
  }

  if (input.authorization === undefined || typeof input.authorization !== "object" || input.authorization === null) {
    errors.push({
      field: "authorization",
      rule: "must be an AuthorizationProof object, cryptographically or institutionally bound to payer, value, and payee (CPD-001 Invariant 3)",
      kind: "structural",
      value: input.authorization,
    });
  } else {
    pushIf(errors, !NON_EMPTY(input.authorization.method), {
      field: "authorization.method",
      rule: "must be a non-empty AuthorizationMethod string",
      kind: "structural",
      value: input.authorization.method,
    });
    pushIf(errors, !("data" in input.authorization), {
      field: "authorization.data",
      rule: "must be present, even if empty — CPD-001 treats it as opaque, not optional",
      kind: "structural",
    });
  }

  pushIf(errors, !Object.values(PaymentState).includes(input.state as PaymentState), {
    field: "state",
    rule: `must be one of: ${Object.values(PaymentState).join(", ")}`,
    kind: "structural",
    value: input.state,
  });

  validateContext(input.context, errors);
  validateDerivedFrom(input.derived_from, errors);

  return errors;
}

/**
 * Throws `CpdValidationError` if `validatePaymentFields` finds any failure.
 */
export function assertValidPaymentFields(input: Partial<PaymentFields>): asserts input is PaymentFields {
  const errors = validatePaymentFields(input);
  if (errors.length > 0) throw new CpdValidationError(errors);
}

/**
 * CPD-001 §4 — validate a proposed state transition against the allowed
 * transition graph. Transitions are monotonic; there is no reversal.
 */
export function assertValidTransition(from: PaymentState, to: PaymentState): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new CpdValidationError([
      {
        field: "state",
        rule: `illegal transition ${from} -> ${to}; allowed from ${from}: [${allowed.join(", ") || "none — terminal state"}]`,
        kind: "semantic",
        value: to,
      },
    ]);
  }
}
