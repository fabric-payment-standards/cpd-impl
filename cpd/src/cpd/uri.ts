/**
 * FPSF-CPD-003 — Payment URI Scheme (`fpsf-pay:`) reference implementation.
 *
 * Implements construction and parsing for all three representation forms
 * defined by CPD-003:
 *
 *   Form 1 — Opaque Envelope (preferred):    fpsf-pay:<codec>.<payload>
 *   Form 2 — Stringified Envelope:            fpsf-pay:<codec>?envelope=<percent-encoded JSON>
 *   Form 3 — Ephemeral Token + Signature:     fpsf-pay:token?value=<token>&sig=<alg>:<sig>
 *
 * This module implements the `cpd-json-v1` side of the codec registry only.
 * It does not implement `cpre1` (FPSF-SS-005) encoding or decoding, and it
 * intentionally does not implement Form 3 *resolution* — CPD-003 §12.4
 * scopes that out as an application/deployment concern.
 *
 * Every decoder function here follows CPD-003 §9 (common parsing algorithm)
 * and §10 (closed parameter vocabulary): unrecognized query parameters,
 * duplicate keys, missing required keys, and any mixing of forms are all
 * hard rejections, never a tolerant best-effort parse.
 */

import { Payment } from "./Payment.js";
import { CODEC_ID, canonicalJSON, decode as decodeEnvelope, encode as encodeEnvelope } from "./codec.js";

export const URI_SCHEME = "fpsf-pay";
const SCHEME_PREFIX = `${URI_SCHEME}:`;

/** The literal path segment reserved for Form 3. MUST NOT be registered as a codec token. */
export const RESERVED_TOKEN_SEGMENT = "token";

const CODEC_TOKEN_RE = /^[A-Za-z0-9-]{1,32}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const ALG_ID_RE = /^[A-Za-z0-9-]{1,16}$/;

export class CpdUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CpdUriError";
  }
}

/** Thrown by `decodeURI` when given a well-formed Form 3 URI — it has no embedded payload to decode. */
export class UnresolvedTokenUriError extends CpdUriError {
  readonly value: string;
  readonly signatureAlg: string;
  readonly signature: string;

  constructor(value: string, signatureAlg: string, signature: string) {
    super(
      `fpsf-pay: URI is a Form 3 (ephemeral token) reference, not an embedded payload. ` +
        `Resolve "${value}" out of band per CPD-003 §12.4 before decoding.`,
    );
    this.name = "UnresolvedTokenUriError";
    this.value = value;
    this.signatureAlg = signatureAlg;
    this.signature = signature;
  }
}

export interface ParsedEnvelopeUri {
  readonly form: "envelope";
  readonly codec: string;
  readonly payload: string;
}

export interface ParsedStringifiedUri {
  readonly form: "stringified";
  readonly codec: string;
  readonly json: string;
}

export interface ParsedTokenUri {
  readonly form: "token";
  readonly value: string;
  readonly signatureAlg: string;
  readonly signature: string;
}

export type ParsedUri = ParsedEnvelopeUri | ParsedStringifiedUri | ParsedTokenUri;

/* ------------------------------------------------------------------ */
/* Strict query-string parsing (CPD-003 §10)                           */
/* ------------------------------------------------------------------ */

/**
 * Split a query string into a Map of raw (still percent-encoded) values,
 * enforcing: every segment contains exactly one `=`, and no key repeats.
 * Does NOT decode values — callers decode per-parameter, since only some
 * parameters (Form 2's `envelope`) are ever percent-encoded at all.
 */
function splitQueryStrict(query: string): Map<string, string> {
  if (query.length === 0) {
    throw new CpdUriError("fpsf-pay: URI has an empty query string");
  }
  const out = new Map<string, string>();
  for (const segment of query.split("&")) {
    const eq = segment.indexOf("=");
    if (eq === -1) {
      throw new CpdUriError(`fpsf-pay: malformed query segment (no "="): "${segment}"`);
    }
    const key = segment.slice(0, eq);
    const rawValue = segment.slice(eq + 1);
    if (out.has(key)) {
      throw new CpdUriError(`fpsf-pay: duplicate query parameter "${key}"`);
    }
    out.set(key, rawValue);
  }
  return out;
}

/** Reject any key set that is not exactly `required` (no extra, no missing, no duplicates). */
function assertExactKeys(keys: Set<string>, required: readonly string[], form: string): void {
  const requiredSet = new Set(required);
  for (const k of keys) {
    if (!requiredSet.has(k)) {
      throw new CpdUriError(`fpsf-pay: unrecognized query parameter "${k}" for Form ${form} — rejected per CPD-003 §10`);
    }
  }
  for (const r of required) {
    if (!keys.has(r)) {
      throw new CpdUriError(`fpsf-pay: missing required query parameter "${r}" for Form ${form}`);
    }
  }
}

/** Strict RFC 3986 §2.1 percent-decoding. Never treats "+" as space. */
function percentDecodeStrict(value: string): string {
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) {
    throw new CpdUriError("fpsf-pay: malformed percent-encoding");
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw new CpdUriError("fpsf-pay: malformed percent-encoding");
  }
}

/** Strict RFC 3986 §2.1 percent-encoding matching CPD-003 §7.3 (encode "+" explicitly). */
function percentEncodeStrict(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, "%2B");
}

/* ------------------------------------------------------------------ */
/* Parsing (CPD-003 §9)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Parse a `fpsf-pay:` URI into one of the three representation forms,
 * per CPD-003 §9. Throws `CpdUriError` on any grammar or vocabulary
 * violation. Never silently ignores unrecognized content.
 */
export function parseURI(uri: string): ParsedUri {
  if (typeof uri !== "string" || !uri.startsWith(SCHEME_PREFIX)) {
    throw new CpdUriError(`fpsf-pay: URI must start with "${SCHEME_PREFIX}"`);
  }
  const body = uri.slice(SCHEME_PREFIX.length);
  const qIndex = body.indexOf("?");

  if (qIndex === -1) {
    // Form 1 — Opaque Envelope
    const dot = body.indexOf(".");
    if (dot === -1) {
      throw new CpdUriError("fpsf-pay: Form 1 URI must contain a codec token and payload separated by \".\"");
    }
    const codec = body.slice(0, dot);
    const payload = body.slice(dot + 1);
    if (!CODEC_TOKEN_RE.test(codec)) {
      throw new CpdUriError(`fpsf-pay: invalid codec token "${codec}"`);
    }
    if (codec === RESERVED_TOKEN_SEGMENT) {
      throw new CpdUriError('fpsf-pay: codec token "token" is reserved for Form 3 and cannot be used in Form 1');
    }
    if (!BASE64URL_RE.test(payload)) {
      throw new CpdUriError("fpsf-pay: Form 1 payload must be base64url (no padding, no percent-encoding)");
    }
    return { form: "envelope", codec, payload };
  }

  const head = body.slice(0, qIndex);
  const query = body.slice(qIndex + 1);

  if (head === RESERVED_TOKEN_SEGMENT) {
    // Form 3 — Ephemeral Token + Signature
    const params = splitQueryStrict(query);
    assertExactKeys(new Set(params.keys()), ["value", "sig"], "3");
    const value = params.get("value")!;
    const sig = params.get("sig")!;
    if (!BASE64URL_RE.test(value)) {
      throw new CpdUriError("fpsf-pay: Form 3 \"value\" must be base64url-safe");
    }
    const colon = sig.indexOf(":");
    if (colon === -1) {
      throw new CpdUriError('fpsf-pay: Form 3 "sig" must be of the form "<alg-id>:<signature>"');
    }
    const alg = sig.slice(0, colon);
    const sigBody = sig.slice(colon + 1);
    if (!ALG_ID_RE.test(alg)) {
      throw new CpdUriError(`fpsf-pay: invalid signature algorithm identifier "${alg}"`);
    }
    if (!BASE64URL_RE.test(sigBody)) {
      throw new CpdUriError("fpsf-pay: Form 3 signature body must be base64url-safe");
    }
    return { form: "token", value, signatureAlg: alg, signature: sigBody };
  }

  // Form 2 — Stringified Envelope
  if (head.includes(".")) {
    throw new CpdUriError('fpsf-pay: Form 2 codec token must not contain "." — did you mean Form 1 (no query string)?');
  }
  if (!CODEC_TOKEN_RE.test(head)) {
    throw new CpdUriError(`fpsf-pay: invalid codec token "${head}"`);
  }
  const params = splitQueryStrict(query);
  assertExactKeys(new Set(params.keys()), ["envelope"], "2");
  const json = percentDecodeStrict(params.get("envelope")!);
  return { form: "stringified", codec: head, json };
}

/* ------------------------------------------------------------------ */
/* Construction                                                         */
/* ------------------------------------------------------------------ */

/** Form 1 — build a `fpsf-pay:` URI directly from an already-encoded payload. */
export function toEnvelopeURI(codec: string, payload: string): string {
  if (!CODEC_TOKEN_RE.test(codec) || codec === RESERVED_TOKEN_SEGMENT) {
    throw new CpdUriError(`fpsf-pay: invalid codec token "${codec}"`);
  }
  if (!BASE64URL_RE.test(payload)) {
    throw new CpdUriError("fpsf-pay: payload must be base64url-safe");
  }
  return `${SCHEME_PREFIX}${codec}.${payload}`;
}

/** Form 1 — encode a Payment with the reference codec and wrap it as a `fpsf-pay:` URI. */
export function encodeEnvelopeURI(payment: Payment): string {
  const { encoding, payload } = encodeEnvelope(payment);
  return toEnvelopeURI(encoding, payload);
}

/** Form 2 — encode a Payment as a percent-encoded, human-legible stringified envelope URI. */
export function encodeStringifiedURI(payment: Payment): string {
  const json = canonicalJSON(payment);
  return `${SCHEME_PREFIX}${CODEC_ID}?envelope=${percentEncodeStrict(json)}`;
}

/**
 * Form 3 — build a `fpsf-pay:` URI carrying only an ephemeral token reference
 * and its signature. Does not embed, and cannot embed, the payload itself —
 * see CPD-003 §12.4.
 */
export function encodeTokenURI(value: string, signatureAlg: string, signature: string): string {
  if (!BASE64URL_RE.test(value)) {
    throw new CpdUriError("fpsf-pay: token value must be base64url-safe");
  }
  if (!ALG_ID_RE.test(signatureAlg)) {
    throw new CpdUriError(`fpsf-pay: invalid signature algorithm identifier "${signatureAlg}"`);
  }
  if (!BASE64URL_RE.test(signature)) {
    throw new CpdUriError("fpsf-pay: signature body must be base64url-safe");
  }
  return `${SCHEME_PREFIX}${RESERVED_TOKEN_SEGMENT}?value=${value}&sig=${signatureAlg}:${signature}`;
}

/* ------------------------------------------------------------------ */
/* Decoding                                                              */
/* ------------------------------------------------------------------ */

/**
 * Parse and fully decode a `fpsf-pay:` URI into a `Payment`.
 *
 * Supports Form 1 and Form 2 for the `cpd-json-v1` codec. Throws
 * `UnresolvedTokenUriError` for a well-formed Form 3 URI — resolving an
 * ephemeral token into a payload is an out-of-band step this package does
 * not implement (CPD-003 §12.4). Throws `CpdUriError` for any codec token
 * this implementation does not support, or for a malformed URI.
 */
export function decodeURI(uri: string): Payment {
  const parsed = parseURI(uri);

  if (parsed.form === "token") {
    throw new UnresolvedTokenUriError(parsed.value, parsed.signatureAlg, parsed.signature);
  }

  if (parsed.codec !== CODEC_ID) {
    throw new CpdUriError(
      `fpsf-pay: unsupported codec token "${parsed.codec}" — this implementation only decodes "${CODEC_ID}"`,
    );
  }

  if (parsed.form === "envelope") {
    return decodeEnvelope(parsed.payload);
  }

  // form === "stringified"
  let json: unknown;
  try {
    json = JSON.parse(parsed.json);
  } catch {
    throw new SyntaxError("fpsf-pay: Form 2 envelope is not valid JSON");
  }
  return Payment.fromJSON(json);
}
