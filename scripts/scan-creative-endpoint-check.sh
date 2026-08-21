#!/usr/bin/env bash
set -e
BASE="${1:-https://www.tryselfmade.ai}"
echo "1) missing brief → expect 400"
curl -s -o /dev/null -w "%{http_code}\n" -XPOST "$BASE/api/scan/creative" -H 'content-type: application/json' -d '{}'
echo "2) valid brief → expect 200 (imageUrl) or clean 429/503, NEVER 500"
curl -s -XPOST "$BASE/api/scan/creative" -H 'content-type: application/json' \
  -d '{"brandName":"Füm","niche":"Health & Wellness","brief":{"key":"brief-0","gapLabel":"Video","headline":"Break the habit","hook":"I made this","angle":"origin","persona":"first-timer","offer":"20% off","prompt":"Füm health ad, clean product-forward composition"}}' | head -c 400
echo
