import { pathToFileURL } from "node:url";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PrivateKeyAccount } from "viem/accounts";
import { Budget, BudgetExceededError, findBudgetError } from "./budget.js";
import { config, fail, formatUSDC, loadAccount } from "./config.js";

export interface SearchResult {
  title?: string;
  url?: string;
  [key: string]: unknown;
}

export interface Receipt {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
}

export interface PaidSearchResult {
  results: SearchResult[];
  paid: bigint | null; // null if no payment settled
  receipt: Receipt | null;
}

/**
 * Creates a search function that pays for each search with x402.
 *
 * The official x402 client handles the whole 402 → sign → retry flow. We wrap
 * the wallet's signer so the budget is checked before every signature: a
 * payment above the caps is refused, never signed.
 */
export function createPaidSearch(account: PrivateKeyAccount, budget: Budget, url = config.searchUrl) {
  let pending: bigint | null = null;

  const guardedSigner = {
    address: account.address,
    async signTypedData(args: Parameters<PrivateKeyAccount["signTypedData"]>[0]) {
      const amount = amountFromMessage(args.message);
      if (amount === null) {
        throw new BudgetExceededError("Refusing to sign: couldn't find the payment amount in the request.");
      }
      budget.reserve(amount);
      pending = amount;
      return account.signTypedData(args);
    },
  };

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: guardedSigner as any });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  return async function search(query: string): Promise<PaidSearchResult> {
    pending = null;
    let res: Response;
    try {
      res = await fetchWithPayment(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
    } catch (err) {
      if (pending !== null) budget.release(pending);
      throw findBudgetError(err) ?? err;
    }

    const receipt = decodeReceipt(res.headers.get("PAYMENT-RESPONSE"));
    const settled = res.ok && receipt?.success === true;
    const paid = pending;
    if (paid !== null) {
      // The Gateway doesn't settle failed responses, so only a settled payment counts.
      if (settled) budget.commit(paid);
      else budget.release(paid);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Search failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    const body: any = await res.json();
    const results: SearchResult[] = body?.result?.results ?? body?.results ?? [];
    return { results, paid: settled ? paid : null, receipt };
  };
}

/** The payment amount in the typed data the x402 client asks us to sign. */
function amountFromMessage(message: any): bigint | null {
  const raw = message?.value ?? message?.permitted?.amount ?? message?.amount;
  if (raw === undefined || raw === null) return null;
  try {
    return BigInt(String(raw));
  } catch {
    return null;
  }
}

export function decodeReceipt(header: string | null): Receipt | null {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function txLink(receipt: Receipt | null): string {
  return receipt?.transaction ? `https://basescan.org/tx/${receipt.transaction}` : "settled in a batch, no transaction hash yet";
}

// ---------- CLI: npm run search -- "your query" ----------

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) fail('Usage: npm run search -- "your search query"');

  const account = loadAccount();
  const budget = new Budget(config.maxPerSearch, config.maxPerRun);
  const search = createPaidSearch(account, budget);

  try {
    const { results, paid, receipt } = await search(query);
    console.log(paid !== null ? `Paid ${formatUSDC(paid)} USDC: ${txLink(receipt)}\n` : "No payment was needed.\n");
    results.slice(0, 10).forEach((r, i) => {
      console.log(`${i + 1}. ${r.title ?? "(untitled)"}`);
      if (r.url) console.log(`   ${r.url}`);
    });
    if (!results.length) console.log("No results.");
  } catch (err) {
    const budgetErr = findBudgetError(err);
    fail(budgetErr ? `Stopped before paying: ${budgetErr.message}` : (err as Error).message);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
