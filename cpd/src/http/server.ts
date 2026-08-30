import express, { type Express } from "express";
import { router } from "./routes.js";
import { errorHandler, notFound } from "./errors.js";

const BODY_LIMIT = "64kb"; // a Payment is a small object; guard against oversized-payload abuse

export function createServer(): Express {
  const app = express();
  app.use(express.json({ limit: BODY_LIMIT, strict: true }));
  app.use(router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/* istanbul ignore next -- exercised via `npm run dev` / `npm start`, not unit tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  const app = createServer();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`@fpsf/cpd reference server listening on http://localhost:${port}`);
    // eslint-disable-next-line no-console
    console.log(`  GET  /v1          implementation info`);
    // eslint-disable-next-line no-console
    console.log(`  GET  /v1/health`);
    // eslint-disable-next-line no-console
    console.log(`  POST /v1/payments`);
    // eslint-disable-next-line no-console
    console.log(`  POST /v1/payments/encode`);
    // eslint-disable-next-line no-console
    console.log(`  POST /v1/payments/decode`);
  });
}
