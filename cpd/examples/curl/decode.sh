#!/usr/bin/env bash
# POST /v1/payments/decode — pass the "payload" value returned by encode.sh
PAYLOAD="${1:?usage: decode.sh <payload>}"
curl -s -X POST http://localhost:8787/v1/payments/decode \
  -H "Content-Type: application/json" \
  -d "{\"payload\": \"${PAYLOAD}\"}" | python3 -m json.tool
