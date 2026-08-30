#!/usr/bin/env bash
# POST /v1/payments/encode — get the reference-codec transport token.
curl -s -X POST http://localhost:8787/v1/payments/encode \
  -H "Content-Type: application/json" \
  -d '{
    "id": "pay_9f2c1e7a",
    "payer": { "id": "acct:payer-042", "roles": ["payer"] },
    "payee": { "id": "acct:payee-777", "roles": ["payee"] },
    "value": { "amount": "12.50", "asset": "USD" },
    "intent": { "reference": "invoice-4471" },
    "authorization": { "method": "signature", "data": { "sig": "3045..." } },
    "state": "CREATED"
  }' | python3 -m json.tool
