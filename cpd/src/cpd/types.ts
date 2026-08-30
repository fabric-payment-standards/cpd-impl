/**
 * FPSF-CPD-001 — Canonical Payment Definition
 * Domain types.
 *
 * These types are a direct, field-for-field translation of the entities
 * defined in CPD-001 Section 3. No field has been renamed, dropped, or
 * given implicit default semantics beyond what the specification states.
 *
 * Monetary amounts are always represented as decimal strings, never as
 * `number`. CPD-001 does not bound the magnitude or precision of
 * `Value.amount`, and JavaScript's `number` type cannot represent
 * arbitrary-precision decimals without silent loss of accuracy.
 */

/** CPD-001 §3.3 — the sole persistent identifier of a Payment. */
export type PaymentIdentifier = string;

/** CPD-001 §3.1 — an entity capable of initiating or receiving a Payment. */
export interface Participant {
  id: string;
  roles: readonly string[];
}

/** CPD-001 §3.2 — the economic unit being transferred. */
export interface Value {
  /** Decimal string. Never a `number`. E.g. "12.50", "0.00000001". */
  amount: string;
  /** Asset identifier — a currency code, tokenized-value identifier, or similar. */
  asset: string;
}

/** CPD-001 §3.4 — describes the purpose and conditions of the Payment. */
export interface IntentDescriptor {
  reference?: string;
  conditions?: readonly string[];
}

/** CPD-001 §3.5 — evidence that the payer has approved the Payment. */
export interface AuthorizationProof {
  method: string;
  /** Opaque payload — CPD-001 does not constrain its shape. */
  data: unknown;
}

/** CPD-001 §4 — the finite set of lifecycle states a Payment may occupy. */
export enum PaymentState {
  CREATED = "CREATED",
  AUTHORIZED = "AUTHORIZED",
  IN_FLIGHT = "IN_FLIGHT",
  SETTLED = "SETTLED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

/** CPD-001 §3.6 — describes the environment in which the Payment is processed. Optional. */
export interface ExecutionContext {
  network?: string;
  rail?: string;
  settlementModel?: string;
}

/**
 * CPD-001 §3.7 — records the origin of a Payment derived from a
 * Canonical Payment Request (FPSF-CPD-002). Informational only; presence
 * or absence does not affect the validity of the Payment.
 */
export interface PaymentRequestReference {
  request_id: string;
  cpr_version: string;
}

/** The full set of fields making up a CPD-001 Payment object. */
export interface PaymentFields {
  id: PaymentIdentifier;
  payer: Participant;
  payee: Participant;
  value: Value;
  intent: IntentDescriptor;
  authorization: AuthorizationProof;
  state: PaymentState;
  context?: ExecutionContext;
  derived_from?: PaymentRequestReference;
}

/** CPD-001 §4 — terminal states admit no further transition. */
export const TERMINAL_STATES: ReadonlySet<PaymentState> = new Set([
  PaymentState.SETTLED,
  PaymentState.FAILED,
  PaymentState.CANCELLED,
]);

/** CPD-001 §4 — the complete, monotonic state transition graph. */
export const ALLOWED_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  [PaymentState.CREATED]: [PaymentState.AUTHORIZED],
  [PaymentState.AUTHORIZED]: [PaymentState.IN_FLIGHT, PaymentState.CANCELLED],
  [PaymentState.IN_FLIGHT]: [PaymentState.SETTLED, PaymentState.FAILED],
  [PaymentState.SETTLED]: [],
  [PaymentState.FAILED]: [],
  [PaymentState.CANCELLED]: [],
};

/** Input shape accepted by `Payment.create` — same as `PaymentFields`, `state` optional (defaults to CREATED). */
export type PaymentDraft = Omit<PaymentFields, "state"> & { state?: PaymentState };
