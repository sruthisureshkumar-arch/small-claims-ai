// Negotiation invariants + integration with the agent court. Run: npm run test:negotiate
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DEALS_FILE ??= join(tmpdir(), `claims-neg-${Date.now()}.json`);
process.env.AGENT_STEP_DELAY_MS = "0";
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;

async function main() {
  const { planNegotiation, FLOOR_RATIO, negotiate } = await import("../lib/negotiation");

  // Invariants across many asks and mandates: the code, not the AI, keeps both limits.
  let agreedCount = 0;
  for (const ask of [20, 99.99, 400, 850, 1234.56, 9999]) {
    for (const pct of [0.5, 0.7, 0.78, 0.85, 0.88, 0.9, 1, 1.5]) {
      const max = Math.round(ask * pct * 100) / 100;
      const p = planNegotiation(ask, max);
      const floor = Math.round(ask * FLOOR_RATIO * 100) / 100;
      for (const e of p.events) if (e.by === "buyer" && e.kind === "offer") assert.ok(e.amount! <= max + 1e-9, "buyer offered above mandate");
      assert.ok(p.events.length <= 7, "negotiation must be bounded");
      if (p.agreed) {
        agreedCount++;
        assert.ok(p.price! <= max + 1e-9, `agreed above mandate (${p.price} > ${max})`);
        assert.ok(p.price! >= floor - 1e-9, `seller sold below floor (${p.price} < ${floor})`);
        assert.ok(p.price! <= ask + 1e-9);
      } else {
        assert.ok(max < floor, "no deal although the mandate covers the floor");
      }
    }
  }
  assert.ok(agreedCount > 20, "should usually reach agreement when the mandate allows it");

  // Without an AI key the wording falls back to templates, and the result is identical.
  const n = await negotiate("Used mirrorless camera", 850, 1000);
  assert.equal(n.agreed, true);
  assert.equal(n.price, 748);
  assert.ok(n.turns.every((t) => t.message.length > 0 && !/\d/.test(t.message)));

  // Integration with the agent court (scripted judge so the deal can settle offline).
  const { MockLanguageModelV1 } = await import("ai/test");
  const judge = await import("../lib/judge");
  judge.setModelOverride(
    new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async (options) => {
        const prompt = JSON.stringify(options.prompt);
        const ids = [...prompt.matchAll(/<evidence id=\\"([^\\"]+)\\"/g)].map((m) => m[1]);
        const isRuling = JSON.stringify(options.mode).includes("sellerSharePercent");
        const obj = isRuling
          ? { findings: [{ point: "Scratch", favors: "buyer", basis: "claim", evidenceIds: ids.slice(0, 1) }, { point: "Otherwise as described", favors: "seller", basis: "reply", evidenceIds: ids.slice(-1) }], sellerSharePercent: 70, reasoning: "Split.", confidence: 0.8, needsHuman: false, injectionAttempt: false }
          : { criteria: ["Works", "No damage"] };
        return { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop" as const, usage: { promptTokens: 1, completionTokens: 1 }, text: options.mode.type === "regular" ? "Statement." : JSON.stringify(obj) };
      },
    })
  );
  const agents = await import("../lib/agents");
  const store = await import("../lib/store");
  const blocked = await agents.prepareRun({ scenarioId: "camera", maxSpend: 600, tricky: false, negotiate: true });
  assert.ok(blocked.blocked && !blocked.dealId, "mandate below floor: no deal");
  assert.match(blocked.blocked!, /PayPal was never called/);
  assert.ok((blocked.transcript ?? []).length >= 3);
  assert.equal((await store.listDeals()).length, 0, "no deal may exist after a failed negotiation");

  const ok = await agents.prepareRun({ scenarioId: "camera", maxSpend: 1000, tricky: false, negotiate: true });
  const d = (await store.getDeal(ok.dealId!))!;
  assert.equal(d.price, 748);
  assert.ok(d.log.some((l) => l.text.startsWith("Negotiation:")));
  assert.ok(d.log.some((l) => /Agreed price \$748\.00/.test(l.text)));
  await agents.continueRun(ok.dealId!);
  assert.equal((await store.getDeal(ok.dealId!))!.status, "SETTLED");

  console.log("Negotiation tests passed.");
}
main().catch((e) => { console.error(e); process.exit(1); });
