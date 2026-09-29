import { formatUSDC } from "./config.js";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * Spending caps for one run. A payment is reserved when it's about to be
 * signed and only counted as spent once the Gateway reports a successful
 * settlement, so a failed search never eats into the budget.
 */
export class Budget {
  private spent = 0n;
  private reserved = 0n;
  private payments = 0;

  constructor(
    readonly maxPerSearch: bigint,
    readonly maxPerRun: bigint,
  ) {}

  /** Called before signing. Throws instead of letting an over-budget payment be signed. */
  reserve(amount: bigint): void {
    if (amount > this.maxPerSearch) {
      throw new BudgetExceededError(
        `A search costs ${formatUSDC(amount)} USDC, above MAX_USDC_PER_SEARCH (${formatUSDC(this.maxPerSearch)}).`,
      );
    }
    if (this.spent + this.reserved + amount > this.maxPerRun) {
      throw new BudgetExceededError(
        `This run's budget is used up: ${formatUSDC(this.spent)} of ${formatUSDC(this.maxPerRun)} USDC spent (MAX_USDC_PER_RUN).`,
      );
    }
    this.reserved += amount;
  }

  commit(amount: bigint): void {
    this.reserved -= amount;
    this.spent += amount;
    this.payments++;
  }

  release(amount: bigint): void {
    this.reserved -= amount;
  }

  summary(): string {
    const left = this.maxPerRun - this.spent;
    const s = this.payments === 1 ? "" : "es";
    return `${this.payments} paid search${s}, ${formatUSDC(this.spent)} USDC total, ${formatUSDC(left)} USDC left in this run's budget`;
  }
}

/** True if err, or anything in its cause chain, is a BudgetExceededError. */
export function findBudgetError(err: unknown): BudgetExceededError | null {
  for (let e: any = err; e; e = e.cause) {
    if (e instanceof BudgetExceededError || e?.name === "BudgetExceededError") return e;
  }
  return null;
}
