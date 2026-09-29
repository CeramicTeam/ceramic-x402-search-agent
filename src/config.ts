import "dotenv/config";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/** USDC on Base mainnet (6 decimals). */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6;
export const BASE_NETWORK = "eip155:8453";

export const config = {
  searchUrl: process.env.SEARCH_URL || "https://api.ceramic.ai/search",
  model: process.env.MODEL || "claude-sonnet-5",
  baseRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  maxPerSearch: toAtomic(process.env.MAX_USDC_PER_SEARCH || "0.01"),
  maxPerRun: toAtomic(process.env.MAX_USDC_PER_RUN || "0.05"),
};

/** The demo wallet from PRIVATE_KEY, or a clear error telling the reader how to create one. */
export function loadAccount(): PrivateKeyAccount {
  const key = process.env.PRIVATE_KEY?.trim();
  if (!key) {
    fail("No PRIVATE_KEY in .env. Create a demo wallet with: npm run wallet:new");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    fail("PRIVATE_KEY in .env isn't a 0x-prefixed 32-byte hex key.");
  }
  return privateKeyToAccount(key as `0x${string}`);
}

/** "0.01" USDC → 10000n atomic units. */
export function toAtomic(usdc: string): bigint {
  const [whole, frac = ""] = usdc.trim().split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || (whole === "" && frac === "")) {
    fail(`"${usdc}" is not a USDC amount.`);
  }
  const fraction = (frac + "000000").slice(0, USDC_DECIMALS);
  return BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction);
}

/** 10000n → "0.01". */
export function formatUSDC(atomic: bigint): string {
  const base = 10n ** BigInt(USDC_DECIMALS);
  const frac = (atomic % base).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${atomic / base}.${frac}` : `${atomic / base}`;
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
