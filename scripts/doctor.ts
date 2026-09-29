// npm run doctor: check everything the examples need, and say how to fix what's missing.
import Anthropic from "@anthropic-ai/sdk";
import { createPublicClient, erc20Abi, http } from "viem";
import { base } from "viem/chains";
import { BASE_NETWORK, USDC_BASE, config, formatUSDC, loadAccount } from "../src/config.js";

let problems = 0;
const ok = (msg: string) => console.log(`✓ ${msg}`);
const bad = (msg: string, fix: string) => {
  problems++;
  console.log(`✗ ${msg}\n    ${fix}`);
};

// 1. Wallet
const account = loadAccount();
ok(`Wallet ${account.address}`);

// 2. USDC on Base mainnet
let balance = 0n;
try {
  const client = createPublicClient({ chain: base, transport: http(config.baseRpcUrl) });
  balance = await client.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance > 0n) ok(`USDC on Base: ${formatUSDC(balance)}`);
  else
    bad(
      "No USDC on Base mainnet in this wallet.",
      `Send about $1 of USDC on Base (not Ethereum, not a testnet) to ${account.address}. No ETH is needed; payments are gasless.`,
    );
} catch (err) {
  bad(`Couldn't read the USDC balance: ${(err as Error).message}`, "Check your connection, or set BASE_RPC_URL in .env.");
}

// 3. The search endpoint and its price
try {
  const res = await fetch(config.searchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "doctor check" }),
  });
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (res.status !== 402 || !header) {
    bad(`${config.searchUrl} returned HTTP ${res.status} instead of a 402 payment request.`, "Check SEARCH_URL in .env.");
  } else {
    const terms = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const offer = terms.accepts?.find((a: any) => a.network === BASE_NETWORK) ?? terms.accepts?.[0];
    const price = BigInt(offer?.amount ?? 0);
    ok(`${config.searchUrl} asks for ${formatUSDC(price)} USDC per search on ${offer?.network}`);
    if (offer?.network !== BASE_NETWORK) bad(`The endpoint asks for payment on ${offer?.network}.`, "This demo pays on Base mainnet.");
    if (price > config.maxPerSearch)
      bad(
        `That's above MAX_USDC_PER_SEARCH (${formatUSDC(config.maxPerSearch)}), so searches would be refused.`,
        "Raise MAX_USDC_PER_SEARCH in .env if you're happy with the price.",
      );
    if (balance > 0n && balance < price) bad("Your USDC balance is below the price of one search.", "Add more USDC.");
  }
} catch (err) {
  bad(`Couldn't reach ${config.searchUrl}: ${(err as Error).message}`, "Check your connection and SEARCH_URL.");
}

// 4. Model API key (agent only)
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("- No ANTHROPIC_API_KEY set. That's fine for `search` and `curl-demo`; `agent` needs one.");
} else {
  try {
    await new Anthropic().models.list({ limit: 1 });
    ok("Anthropic API key works");
  } catch (err) {
    bad(`Anthropic API key rejected: ${(err as Error).message}`, "Check ANTHROPIC_API_KEY in .env.");
  }
}

console.log(
  problems
    ? `\n${problems} thing${problems === 1 ? "" : "s"} to fix before running the examples.`
    : `\nReady. Try: npm run search -- "latest on solid-state batteries"`,
);
process.exit(problems ? 1 : 0);
