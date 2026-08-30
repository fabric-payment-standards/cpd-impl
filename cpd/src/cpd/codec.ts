/**
 * FPSF-CPD-001 — reference codec.
 *
 * IMPORTANT — normative status: CPD-001 defines Payment *semantics*, not a
 * wire format. Section 7 (Extensibility) and the accompanying architecture
 * note explicitly leave transport/encoding to companion specifications
 * (e.g. FPSF-SS-005 / CPRE for compact, QR-oriented crypto payment
 * requests) or to a rail-specific adapter.
 *
 * This module therefore implements a single, deliberately simple codec —
 * "canonical JSON" — as a reference transport for CPD-001 payments. It is
 * NOT part of the CPD-001 specification; it is this implementation's
 * choice of a deterministic, inspectable, dependency-free serialization.
 * Do not cite `cpd-json-v1` as a normative CPD-001 wire format.
 *
 * Canonicalization rules (this implementation only):
 *   - Object keys are sorted lexicographically (Unicode code point order)
 *     at every nesting level, recursively.
 *   - No insignificant whitespace.
 *   - `undefined` fields are omitted, never emitted as `null`.
 *   - The canonical JSON string is UTF-8 encoded, then Base64url-encoded
 *     (RFC 4648 §5, no padding) for transport as a single opaque token.
 */

import { Payment } from "./Payment.js";

export const CODEC_ID = "cpd-json-v1";

/** Recursively sort object keys to produce a deterministic JSON string. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue; // omit, never emit null-for-undefined
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** Produce the canonical JSON string for a Payment (or any CPD-shaped object). */
export function canonicalJSON(payment: Payment | Record<string, unknown>): string {
  const plain = payment instanceof Payment ? payment.toJSON() : payment;
  return JSON.stringify(canonicalize(plain));
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64url");
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf-8");
}

export interface EncodedPayment {
  encoding: typeof CODEC_ID;
  payload: string; // base64url
  length: number; // byte length of the raw canonical JSON, before base64url
}

/** Encode a Payment into the reference transport token described above. */
export function encode(payment: Payment): EncodedPayment {
  const json = canonicalJSON(payment);
  return {
    encoding: CODEC_ID,
    payload: base64urlEncode(json),
    length: Buffer.byteLength(json, "utf-8"),
  };
}

/**
 * Decode a reference transport token back into a Payment. Throws if the
 * payload is not valid base64url, not valid JSON, or fails CPD-001
 * validation once parsed.
 */
export function decode(payload: string): Payment {
  let json: string;
  try {
    json = base64urlDecode(payload);
  } catch {
    throw new SyntaxError("cpd codec: payload is not valid base64url");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SyntaxError("cpd codec: decoded payload is not valid JSON");
  }
  return Payment.fromJSON(parsed);
}

/**
 * Round-trip helper: encode then immediately decode. Used by tests and by
 * callers who want to assert that a Payment survives the reference codec
 * unchanged.
 */
export function roundTrip(payment: Payment): Payment {
  return decode(encode(payment).payload);
}
