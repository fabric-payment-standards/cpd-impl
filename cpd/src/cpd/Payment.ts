/**
 * FPSF-CPD-001 — the canonical `Payment` object.
 *
 * This class is the central object of the library. It has no dependency on
 * HTTP, a framework, or any settlement rail — it is usable entirely as a
 * local, in-memory representation of CPD-001 semantics.
 */

import {
  type AuthorizationProof,
  type ExecutionContext,
  type IntentDescriptor,
  type Participant,
  type PaymentDraft,
  type PaymentFields,
  type PaymentRequestReference,
  PaymentState,
  type Value,
} from "./types.js";
import { assertValidPaymentFields, assertValidTransition, validatePaymentFields, type FieldError } from "./validation.js";

export class Payment {
  readonly id: string;
  readonly payer: Participant;
  readonly payee: Participant;
  readonly value: Value;
  readonly intent: IntentDescriptor;
  readonly authorization: AuthorizationProof;
  readonly state: PaymentState;
  readonly context?: ExecutionContext;
  readonly derived_from?: PaymentRequestReference;

  private constructor(fields: PaymentFields) {
    this.id = fields.id;
    this.payer = fields.payer;
    this.payee = fields.payee;
    this.value = fields.value;
    this.intent = fields.intent;
    this.authorization = fields.authorization;
    this.state = fields.state;
    if (fields.context !== undefined) this.context = fields.context;
    if (fields.derived_from !== undefined) this.derived_from = fields.derived_from;
    Object.freeze(this);
  }

  /**
   * Construct and validate a new Payment. `state` defaults to `CREATED`
   * (CPD-001 §5.1 `initiatePayment`) when omitted.
   *
   * Throws `CpdValidationError` if any normative constraint fails.
   */
  static create(draft: PaymentDraft): Payment {
    const fields: PaymentFields = { ...draft, state: draft.state ?? PaymentState.CREATED };
    assertValidPaymentFields(fields);
    return new Payment(fields);
  }

  /**
   * Construct a Payment from an already-canonical JSON-compatible object
   * (e.g. the output of `toJSON()` or a decoded payload). Equivalent to
   * `create`, but named to signal deserialization intent at call sites.
   */
  static fromJSON(input: unknown): Payment {
    if (typeof input !== "object" || input === null) {
      throw new TypeError("Payment.fromJSON: input must be a JSON object");
    }
    return Payment.create(input as PaymentDraft);
  }

  /** Non-throwing validation — returns the full list of failures, if any. */
  static check(draft: Partial<PaymentFields>): FieldError[] {
    return validatePaymentFields(draft);
  }

  /** Re-validates this instance. A frozen, already-constructed Payment should always pass. */
  validate(): void {
    assertValidPaymentFields(this.toJSON() as unknown as PaymentFields);
  }

  /** CPD-001 §5.2 — attach authorization proof and transition to AUTHORIZED. */
  authorize(authorization: AuthorizationProof): Payment {
    assertValidTransition(this.state, PaymentState.AUTHORIZED);
    return new Payment({ ...this.toFields(), authorization, state: PaymentState.AUTHORIZED });
  }

  /** CPD-001 §5.3 — submit to an execution environment and transition to IN_FLIGHT. */
  submit(context?: ExecutionContext): Payment {
    assertValidTransition(this.state, PaymentState.IN_FLIGHT);
    const fields = this.toFields();
    if (context !== undefined) fields.context = context;
    return new Payment({ ...fields, state: PaymentState.IN_FLIGHT });
  }

  /** CPD-001 §5.4 — finalize value transfer and transition to SETTLED. */
  settle(): Payment {
    assertValidTransition(this.state, PaymentState.SETTLED);
    return new Payment({ ...this.toFields(), state: PaymentState.SETTLED });
  }

  /** Transition to FAILED (irrecoverable failure). */
  fail(): Payment {
    assertValidTransition(this.state, PaymentState.FAILED);
    return new Payment({ ...this.toFields(), state: PaymentState.FAILED });
  }

  /** CPD-001 §5.6 — valid only before settlement; transition to CANCELLED. */
  cancel(): Payment {
    assertValidTransition(this.state, PaymentState.CANCELLED);
    return new Payment({ ...this.toFields(), state: PaymentState.CANCELLED });
  }

  private toFields(): PaymentFields {
    const fields: PaymentFields = {
      id: this.id,
      payer: this.payer,
      payee: this.payee,
      value: this.value,
      intent: this.intent,
      authorization: this.authorization,
      state: this.state,
    };
    if (this.context !== undefined) fields.context = this.context;
    if (this.derived_from !== undefined) fields.derived_from = this.derived_from;
    return fields;
  }

  /** Canonical, JSON-serializable representation using exactly the CPD-001 field names. */
  toJSON(): PaymentFields {
    return this.toFields();
  }
}
