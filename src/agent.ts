import Anthropic from "@anthropic-ai/sdk";
import { Budget, findBudgetError } from "./budget.js";
import { config, fail, formatUSDC, loadAccount } from "./config.js";
import { createPaidSearch, txLink, type SearchResult } from "./search.js";

const MAX_TURNS = 8;

const SYSTEM = `You are a research assistant with a web search tool.
Each search costs real money (a fraction of a cent in USDC), so search deliberately:
use a few focused queries rather than many broad ones, usually 2 to 4 in total.
Answer in a few short paragraphs, citing sources inline as [1], [2], and so on,
then list the sources with their URLs at the end.
If a search fails or the budget runs out, answer with what you have and say what's missing.`;

const tools: Anthropic.Tool[] = [
  {
    name: "search",
    description: "Search the web. Each call is paid per search with x402. Returns titles, URLs, and text from matching pages.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "A focused search query." } },
      required: ["query"],
    },
  },
];

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) fail('Usage: npm run agent -- "your research question"');
  if (!process.env.ANTHROPIC_API_KEY) fail("Set ANTHROPIC_API_KEY in .env to run the agent.");

  const account = loadAccount();
  const budget = new Budget(config.maxPerSearch, config.maxPerRun);
  const search = createPaidSearch(account, budget);
  const anthropic = new Anthropic();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  console.log("Thinking…");

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 2048,
      system: SYSTEM,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      console.log(`\n${answer}\n`);
      console.log(budget.summary());
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const query = String((block.input as { query?: string }).query ?? "");
      try {
        const { results, paid, receipt } = await search(query);
        const cost = paid !== null ? `paid ${formatUSDC(paid)} USDC  ${txLink(receipt)}` : "no payment needed";
        console.log(`→ search "${query}"  ${cost}`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: formatResults(results) });
      } catch (err) {
        const budgetErr = findBudgetError(err);
        const message = budgetErr ? `Budget exhausted: ${budgetErr.message}` : `Search failed: ${(err as Error).message}`;
        console.log(`→ search "${query}"  not run: ${message}`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: message, is_error: true });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  console.log(`\nStopped after ${MAX_TURNS} turns without a final answer.`);
  console.log(budget.summary());
}

/** Compact, numbered results for the model, trimmed to keep context small. */
function formatResults(results: SearchResult[]): string {
  if (!results.length) return "No results.";
  return results
    .slice(0, 8)
    .map((r, i) => {
      const text = String(r.snippet ?? r.description ?? r.content ?? r.text ?? "").replace(/\s+/g, " ").slice(0, 500);
      return `[${i + 1}] ${r.title ?? "(untitled)"}\n${r.url ?? ""}${text ? `\n${text}` : ""}`;
    })
    .join("\n\n");
}

await main();
