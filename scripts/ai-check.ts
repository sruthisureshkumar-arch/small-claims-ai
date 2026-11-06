// Standalone diagnostic: tests the AI provider separately from the app.
// Run: npx tsx --env-file=.env.local scripts/ai-check.ts
import { google } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import { z } from "zod";

const modelId = process.env.JUDGE_MODEL ?? "gemini-3.1-flash-lite";
const show = (e: unknown) => {
  const x = e as { message?: string; statusCode?: number; responseBody?: string; cause?: unknown };
  console.log("  message:", x.message);
  if (x.statusCode) console.log("  status:", x.statusCode);
  if (x.responseBody) console.log("  response:", String(x.responseBody).slice(0, 600));
  if (x.cause) console.log("  cause:", String((x.cause as Error).message ?? x.cause).slice(0, 300));
};

async function main() {
  console.log("Key present:", !!process.env.GOOGLE_GENERATIVE_AI_API_KEY, "| model:", modelId);
  console.log("ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY, "| AI_PROVIDER:", process.env.AI_PROVIDER ?? "(unset)");

  console.log("\n1) Plain text call…");
  try {
    const r = await generateText({ model: google(modelId), prompt: "Reply with the single word: ok" });
    console.log("  OK ->", r.text.trim());
  } catch (e) {
    console.log("  FAILED");
    show(e);
    return;
  }

  console.log("\n2) Structured output call (what the app uses)…");
  try {
    const r = await generateObject({
      model: google(modelId),
      schema: z.object({ criteria: z.array(z.string()).min(2).max(6) }),
      prompt: "Give acceptance criteria for selling a used camera in mint condition.",
    });
    console.log("  OK ->", JSON.stringify(r.object));
  } catch (e) {
    console.log("  FAILED");
    show(e);
  }
}
main();
