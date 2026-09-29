// npm run wallet:new: create a fresh demo wallet and save its key to .env.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const force = process.argv.includes("--force");
const envPath = ".env";

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(".env.example", "utf8");
const existing = env.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
if (existing && !force) {
  const address = privateKeyToAccount(existing[1] as `0x${string}`).address;
  console.log(`.env already has a wallet: ${address}`);
  console.log("Keeping it. To replace it (and lose access to any funds in it), run: npm run wallet:new -- --force");
  process.exit(0);
}

const key = generatePrivateKey();
const address = privateKeyToAccount(key).address;
env = /^PRIVATE_KEY=.*$/m.test(env) ? env.replace(/^PRIVATE_KEY=.*$/m, `PRIVATE_KEY=${key}`) : `PRIVATE_KEY=${key}\n${env}`;
writeFileSync(envPath, env, { mode: 0o600 });

console.log(`Created a new demo wallet: ${address}`);
console.log("Saved the private key to .env (gitignored; never commit it).\n");
console.log("Next: send about $1 of USDC on Base (mainnet) to that address, then run: npm run doctor");
