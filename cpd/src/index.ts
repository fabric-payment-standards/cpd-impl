/**
 * @fpsf/cpd — reference implementation of FPSF-CPD-001.
 *
 * Import from here for the local, HTTP-independent domain model:
 *
 *   import { Payment, PaymentState, encode, decode } from "@fpsf/cpd";
 *
 * The HTTP server (`src/http`) is a separate, optional layer built on top
 * of this module — it is not required to use CPD-001 locally.
 */
export * from "./cpd/index.js";
