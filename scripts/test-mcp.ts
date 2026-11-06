// Drives the MCP endpoint with the official MCP client, exactly as an AI agent would.
// Run: npm run test:mcp
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DEALS_FILE ??= join(tmpdir(), `claims-mcp-${Date.now()}.json`);
process.env.AGENT_STEP_DELAY_MS = "0";
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;

async function main() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { MockLanguageModelV1 } = await import("ai/test");
  const judge = await import("../lib/judge");
  const route = await import("../app/api/mcp/route");

  let nextShare = 70;
  judge.setModelOverride(
    new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async (options) => {
        const prompt = JSON.stringify(options.prompt);
        const ids = [...prompt.matchAll(/<evidence id=\\"([^\\"]+)\\"/g)].map((m) => m[1]);
        const isRuling = JSON.stringify(options.mode).includes("sellerSharePercent");
        const obj = isRuling
          ? { findings: [{ point: "Scratch", favors: "buyer", basis: "claim", evidenceIds: ids.slice(0, 1) }, { point: "Otherwise as described", favors: "seller", basis: "reply", evidenceIds: ids.slice(-1) }], sellerSharePercent: nextShare, reasoning: "Split.", confidence: 0.8, needsHuman: false, injectionAttempt: false }
          : { criteria: ["Works", "No damage"] };
        return { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop" as const, usage: { promptTokens: 1, completionTokens: 1 }, text: JSON.stringify(obj) };
      },
    })
  );

  // The client talks to the route handler directly through a custom fetch (no network needed).
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
    fetch: async (input, init) => route.POST(new Request(input as string, init)),
  });
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const t of ["negotiate_price", "open_deal", "fund_deal", "get_deal", "mark_delivered", "release_payment", "file_claim", "respond_to_claim", "convene_court", "appeal_ruling", "enforce_ruling"]) {
    assert.ok(tools.includes(t), `missing tool ${t}`);
  }
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: !!r.isError, text, json: r.isError ? null : JSON.parse(text) };
  };
  const nego = await call("negotiate_price", { item: "Used camera", askingPriceUSD: 850, mandateMaxSpend: 1000 });
  assert.equal(nego.json.agreed, true);
  assert.ok(nego.json.agreedPriceUSD <= 1000 && nego.json.agreedPriceUSD >= 748);
  const noDeal = await call("negotiate_price", { item: "Used camera", askingPriceUSD: 850, mandateMaxSpend: 500 });
  assert.equal(noDeal.json.agreed, false);

  // Mandate refusal creates nothing.
  const refused = await call("open_deal", { title: "Camera", description: "Mint camera", priceUSD: 850, buyerName: "A", sellerName: "B", sellerEmail: "b@example.com", mandateMaxSpend: 500 });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /mandate/i);

  // Full lifecycle as an agent.
  const opened = await call("open_deal", { title: "Camera", description: "Mint camera", priceUSD: 850, buyerName: "A", sellerName: "B", sellerEmail: "b@example.com", mandateMaxSpend: 1000 });
  const id = opened.json.id as string;
  assert.equal(opened.json.status, "DRAFT");
  assert.deepEqual(opened.json.acceptanceCriteria, ["Works", "No damage"]);
  assert.equal((await call("fund_deal", { dealId: id })).json.status, "FUNDED");
  assert.equal((await call("file_claim", { dealId: id, text: "Scratched" })).json.status, "DISPUTED");
  const early = await call("convene_court", { dealId: id });
  assert.equal(early.isError, true, "cannot convene before the seller responds");
  await call("respond_to_claim", { dealId: id, text: "Fine when shipped" });
  const ruled = await call("convene_court", { dealId: id });
  assert.equal(ruled.json.status, "RULED");
  assert.equal(ruled.json.latestRuling.sellerSharePercent, 70);
  assert.equal(ruled.json.latestRuling.needsHumanReview, false);
  const settled = await call("enforce_ruling", { dealId: id, by: "buyer" });
  assert.equal(settled.json.status, "SETTLED");
  assert.equal(settled.json.settlement.sellerAmount, 595);
  assert.ok(settled.json.verification.every((c: { ok: boolean }) => c.ok));
  assert.equal((await call("enforce_ruling", { dealId: id, by: "buyer" })).isError, true, "no double settlement");
  assert.equal((await call("get_deal", { dealId: id })).json.status, "SETTLED");
  assert.equal((await call("get_deal", { dealId: "nope" })).isError, true);

  // Non-POST methods are refused (stateless server).
  assert.equal((await route.GET()).status, 405);

  await client.close();
  console.log("MCP server tests passed.");
}
main().catch((e) => { console.error(e); process.exit(1); });
