#!/usr/bin/env bash
# npm run curl-demo: the x402 protocol with nothing hidden.
#
#   1. Search without paying     → 402 + PAYMENT-REQUIRED (the price)
#   2. Sign the USDC payment      → EIP-3009 authorization, signed locally with `cast`
#   3. Search again, with payment → 200 + results + PAYMENT-RESPONSE (the receipt)
#
# Needs curl, jq, openssl, and Foundry's cast: curl -L https://foundry.paradigm.xyz | bash && foundryup
# Reads PRIVATE_KEY, SEARCH_URL, and MAX_USDC_PER_SEARCH from .env. Optional: QUERY="…".

set -euo pipefail
if [[ -f .env ]]; then set -a; . ./.env; set +a; fi

SEARCH_URL="${SEARCH_URL:-https://api.ceramic.ai/search}"
QUERY="${QUERY:-solid-state batteries}"
MAX_USDC_PER_SEARCH="${MAX_USDC_PER_SEARCH:-0.01}"
: "${PRIVATE_KEY:?No PRIVATE_KEY. Create a demo wallet with: npm run wallet:new}"

for bin in curl jq openssl cast; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin (see the comment at the top of this script)" >&2; exit 1; }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
body="$(jq -nc --arg q "$QUERY" '{query: $q}')"

b64decode() { base64 -d 2>/dev/null || base64 -D; }
header() { grep -i "^$1:" "$2" | head -1 | cut -d' ' -f2- | tr -d '\r'; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1. Search without paying"
echo "\$ curl -X POST $SEARCH_URL -d '$body'"
status=$(curl -sS -X POST "$SEARCH_URL" -H 'Content-Type: application/json' -d "$body" \
  -D "$work/h1" -o "$work/b1" -w '%{http_code}')
echo "HTTP $status"
[[ "$status" == "402" ]] || { echo "Expected 402 Payment Required:"; cat "$work/b1"; echo; exit 1; }

header PAYMENT-REQUIRED "$work/h1" | b64decode > "$work/required.json"
echo "PAYMENT-REQUIRED (decoded):"
jq . "$work/required.json"

req=$(jq -c '.accepts[0]' "$work/required.json")
[[ "$(jq -r .scheme <<<"$req")" == "exact" ]] || { echo "This demo signs the \"exact\" scheme only." >&2; exit 1; }
amount=$(jq -r .amount <<<"$req")
price=$(awk -v a="$amount" 'BEGIN { printf "%.6f", a / 1000000 }' | sed 's/0*$//; s/\.$//')
if awk -v p="$price" -v m="$MAX_USDC_PER_SEARCH" 'BEGIN { exit !(p > m) }'; then
  echo "Price $price USDC is above MAX_USDC_PER_SEARCH ($MAX_USDC_PER_SEARCH). Not paying." >&2; exit 1
fi
echo "→ Price: $price USDC on $(jq -r .network <<<"$req"), paid to $(jq -r .payTo <<<"$req")"

say "2. Sign the payment (locally, with cast)"
from=$(cast wallet address --private-key "$PRIVATE_KEY")
now=$(date +%s)
nonce="0x$(openssl rand -hex 32)"
timeout=$(jq -r '.maxTimeoutSeconds // 300' <<<"$req")

jq -n --argjson r "$req" --arg from "$from" --arg nonce "$nonce" \
  --arg after "$((now - 600))" --arg before "$((now + timeout - 60))" '{
  types: {
    EIP712Domain: [
      {name: "name", type: "string"}, {name: "version", type: "string"},
      {name: "chainId", type: "uint256"}, {name: "verifyingContract", type: "address"}
    ],
    TransferWithAuthorization: [
      {name: "from", type: "address"}, {name: "to", type: "address"},
      {name: "value", type: "uint256"}, {name: "validAfter", type: "uint256"},
      {name: "validBefore", type: "uint256"}, {name: "nonce", type: "bytes32"}
    ]
  },
  primaryType: "TransferWithAuthorization",
  domain: {
    name: ($r.extra.name // "USD Coin"), version: ($r.extra.version // "2"),
    chainId: ($r.network | split(":")[1] | tonumber), verifyingContract: $r.asset
  },
  message: {from: $from, to: $r.payTo, value: $r.amount, validAfter: $after, validBefore: $before, nonce: $nonce}
}' > "$work/typed.json"

signature=$(cast wallet sign --private-key "$PRIVATE_KEY" --data --from-file "$work/typed.json")
echo "Authorized $price USDC from $from"
echo "Signature: ${signature:0:20}…"

payment=$(jq -c --argjson r "$req" --argjson pr "$(cat "$work/required.json")" --arg sig "$signature" \
  '{x402Version: 2, resource: $pr.resource, accepted: $r, payload: {signature: $sig, authorization: .message}}' \
  "$work/typed.json" | base64 | tr -d '\n')

say "3. Search again, with the payment attached"
echo "\$ curl -X POST $SEARCH_URL -H 'PAYMENT-SIGNATURE: ${payment:0:24}…' -d '$body'"
status=$(curl -sS -X POST "$SEARCH_URL" -H 'Content-Type: application/json' \
  -H "PAYMENT-SIGNATURE: $payment" -d "$body" -D "$work/h2" -o "$work/b2" -w '%{http_code}')
echo "HTTP $status"

receipt=$(header PAYMENT-RESPONSE "$work/h2")
if [[ -n "$receipt" ]]; then
  echo "PAYMENT-RESPONSE (decoded):"
  b64decode <<<"$receipt" | jq .
fi

if [[ "$status" == "200" ]]; then
  echo "Top results:"
  jq -r '(.result.results // .results // [])[:5][] | "  \(.title)\n    \(.url)"' "$work/b2"
else
  echo "Paid search failed:"; cat "$work/b2"; echo; exit 1
fi
