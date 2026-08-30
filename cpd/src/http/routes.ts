import { Router, type Request, type Response } from "express";
import { Payment } from "../cpd/Payment.js";
import { CODEC_ID, decode, encode } from "../cpd/codec.js";
import {
  CpdUriError,
  RESERVED_TOKEN_SEGMENT,
  UnresolvedTokenUriError,
  URI_SCHEME,
  decodeURI,
  encodeEnvelopeURI,
  encodeStringifiedURI,
  encodeTokenURI,
  parseURI,
} from "../cpd/uri.js";
import { ApiError } from "./errors.js";

export const router: Router = Router();

const IMPLEMENTATION_NAME = "@fpsf/cpd — CPD-001 reference implementation";
const IMPLEMENTATION_VERSION = "0.2.0";
const SPEC_ID = "FPSF-CPD-001";
const DOCS_URL = "https://fabricpaymentstandards.org/specs/cpd-001";
const URI_SPEC_ID = "FPSF-CPD-003";

/**
 * GET /v1
 * Machine-readable description of this implementation. Not a claim of
 * conformance to any other specification — see `spec` for what this
 * server actually implements.
 */
router.get("/v1", (_req: Request, res: Response) => {
  res.json({
    implementation: IMPLEMENTATION_NAME,
    version: IMPLEMENTATION_VERSION,
    spec: SPEC_ID,
    spec_version: "1.1.0",
    codecs: [CODEC_ID],
    documentation: DOCS_URL,
    uriScheme: {
      scheme: URI_SCHEME,
      spec: URI_SPEC_ID,
      forms: ["envelope", "stringified", "token"],
      codecs: [CODEC_ID],
      reservedSegment: RESERVED_TOKEN_SEGMENT,
    },
  });
});

/** GET /v1/health */
router.get("/v1/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

/**
 * POST /v1/payments
 * Accepts a candidate CPD-001 Payment as JSON. Validates and normalizes
 * it. Returns the canonical representation — this endpoint does not
 * settle anything; it only confirms that the server understood the
 * Payment.
 */
router.post("/v1/payments", (req: Request, res: Response) => {
  const payment = Payment.fromJSON(req.body);
  res.status(200).json({ payment: payment.toJSON(), valid: true });
});

/**
 * POST /v1/payments/encode
 * Accepts a candidate CPD-001 Payment and returns its reference codec
 * encoding (see src/cpd/codec.ts — not a CPD-001-mandated wire format),
 * plus the equivalent Form 1 (opaque) and Form 2 (stringified) `fpsf-pay:`
 * URIs defined by FPSF-CPD-003. Form 3 is not produced here — it requires
 * an externally minted ephemeral token; see POST /v1/payments/uri/token.
 */
router.post("/v1/payments/encode", (req: Request, res: Response) => {
  const payment = Payment.fromJSON(req.body);
  const encoded = encode(payment);
  res.status(200).json({
    ...encoded,
    uri: encodeEnvelopeURI(payment),
    stringifiedUri: encodeStringifiedURI(payment),
  });
});

/**
 * POST /v1/payments/decode
 * Accepts a reference-codec payload (`{ "payload": "<base64url>" }`) and
 * returns the decoded canonical Payment.
 */
router.post("/v1/payments/decode", (req: Request, res: Response) => {
  const body = req.body as { payload?: unknown };
  if (typeof body.payload !== "string" || body.payload.length === 0) {
    throw new ApiError(400, "MISSING_FIELD", "Body must contain a non-empty string field \"payload\".");
  }
  const payment = decode(body.payload);
  res.status(200).json({ payment: payment.toJSON() });
});

/**
 * POST /v1/payments/uri/decode
 * Accepts a full `fpsf-pay:` URI (any of the three CPD-003 forms) and
 * either returns the decoded Payment (Forms 1–2) or, for a well-formed
 * Form 3 URI, returns the unresolved token reference rather than a
 * Payment — resolving it is an out-of-band step this server does not
 * perform (CPD-003 §12.4).
 */
router.post("/v1/payments/uri/decode", (req: Request, res: Response) => {
  const body = req.body as { uri?: unknown };
  if (typeof body.uri !== "string" || body.uri.length === 0) {
    throw new ApiError(400, "MISSING_FIELD", "Body must contain a non-empty string field \"uri\".");
  }
  try {
    const payment = decodeURI(body.uri);
    res.status(200).json({ form: "envelope-or-stringified", payment: payment.toJSON() });
  } catch (err) {
    if (err instanceof UnresolvedTokenUriError) {
      res.status(200).json({
        form: "token",
        value: err.value,
        signatureAlg: err.signatureAlg,
        signature: err.signature,
        resolved: false,
      });
      return;
    }
    if (err instanceof CpdUriError) {
      throw new ApiError(400, "MALFORMED_URI", err.message);
    }
    throw err;
  }
});

/**
 * POST /v1/payments/uri/token
 * Wraps an externally minted ephemeral token and its signature as a
 * Form 3 `fpsf-pay:` URI. This endpoint does not mint tokens or verify
 * signatures — it only performs the wire-format construction defined by
 * CPD-003 §8.
 */
router.post("/v1/payments/uri/token", (req: Request, res: Response) => {
  const body = req.body as { value?: unknown; signatureAlg?: unknown; signature?: unknown };
  if (typeof body.value !== "string" || body.value.length === 0) {
    throw new ApiError(400, "MISSING_FIELD", "Body must contain a non-empty string field \"value\".");
  }
  if (typeof body.signatureAlg !== "string" || body.signatureAlg.length === 0) {
    throw new ApiError(400, "MISSING_FIELD", "Body must contain a non-empty string field \"signatureAlg\".");
  }
  if (typeof body.signature !== "string" || body.signature.length === 0) {
    throw new ApiError(400, "MISSING_FIELD", "Body must contain a non-empty string field \"signature\".");
  }
  try {
    const uri = encodeTokenURI(body.value, body.signatureAlg, body.signature);
    res.status(200).json({ uri });
  } catch (err) {
    if (err instanceof CpdUriError) {
      throw new ApiError(400, "MALFORMED_URI", err.message);
    }
    throw err;
  }
});

/**
 * POST /v1/payments/uri/parse
 * Parses (but does not decode) any `fpsf-pay:` URI and reports which
 * form it identified and its raw fields — useful for inspecting a URI
 * without committing to full Payment decoding.
 */
router.post("/v1/payments/uri/parse", (req: Request, res: Response) => {
  const body = req.body as { uri?: unknown };
  if (typeof body.uri !== "string" || body.uri.length === 0) {
    throw new ApiError(400, "MISSING_FIELD", "Body must contain a non-empty string field \"uri\".");
  }
  try {
    res.status(200).json(parseURI(body.uri));
  } catch (err) {
    if (err instanceof CpdUriError) {
      throw new ApiError(400, "MALFORMED_URI", err.message);
    }
    throw err;
  }
});
