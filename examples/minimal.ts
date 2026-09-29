// The smallest possible paid search: the official x402 client wraps fetch,
// so paying is a one-line change. Run with: npm run minimal
//
// This example has no spending caps. src/search.ts adds them.
import "dotenv/config";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`) });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment("https://api.ceramic.ai/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "solid-state batteries" }),
});

const { result } = await res.json();
for (const r of result.results.slice(0, 5)) console.log(`${r.title}\n  ${r.url}`);
