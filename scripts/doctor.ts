// Pre-flight check with YOUR real keys: Gemini (text, structured, vision) + PayPal sandbox. Run: npm run doctor
import { readFileSync, existsSync } from "node:fs";
for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const results: [string, boolean, string][] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  const t = Date.now();
  try {
    const d = await fn();
    results.push([name, true, `${d} (${((Date.now() - t) / 1000).toFixed(1)}s)`]);
  } catch (e) {
    results.push([name, false, (e as Error).message.slice(0, 220)]);
  }
  const [n, ok, d] = results.at(-1)!;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}: ${d}`);
};

async function main() {
  const { generateObject } = await import("ai");
  const { z } = await import("zod");
  const judge = await import("../lib/judge");
  const pp = await import("../lib/paypal");

  console.log(`Provider: ${judge.PROVIDER}, judge model: ${judge.JUDGE_MODEL}\n`);

  await check("AI structured output + fallback", async () => {
    const { value, modelId } = await judge.withModels(judge.JUDGE_MODEL, (model, _i, signal) =>
      generateObject({ model, schema: z.object({ ok: z.boolean(), word: z.string() }), prompt: "Return ok=true and word='court'.", abortSignal: signal })
    );
    return `answered by ${modelId}: ${JSON.stringify(value.object)}`;
  });

  await check("AI vision (reads an image)", async () => {
    // 1x1 red PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const { value } = await judge.withModels(judge.JUDGE_MODEL, (model, _i, signal) =>
      generateObject({
        model,
        schema: z.object({ sawImage: z.boolean() }),
        messages: [{ role: "user", content: [{ type: "text", text: "Is an image attached? sawImage=true if yes." }, { type: "image", image: png, mimeType: "image/png" }] }],
        abortSignal: signal,
      })
    );
    return JSON.stringify(value.object);
  });

  if (pp.isMock()) {
    console.log("\nPAYPAL_CLIENT_ID/SECRET not set -> PayPal runs in MOCK mode (fine for a quick demo, but judges want the real sandbox).");
  } else {
    await check("PayPal sandbox: create AUTHORIZE order", async () => {
      const h = await pp.createHold(`doctor${Date.now()}`, "Doctor check", 1);
      (globalThis as any).__order = h.orderId;
      return `order ${h.orderId}, approve link ok`;
    });
    await check("PayPal Agent Toolkit: get_order reads it back", async () => {
      const tk = await import("../lib/paypal-toolkit");
      const r = await tk.checkOrder((globalThis as any).__order, 1);
      if (!r || r.ok !== true) throw new Error(r?.detail ?? "no result");
      return r.detail;
    });
  }
  if (!process.env.APP_URL) console.log("\nNote: APP_URL not set (defaults to http://localhost:3000). Set it to your public URL when deployed.");
  const failed = results.filter((r) => !r[1]).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}
main();
