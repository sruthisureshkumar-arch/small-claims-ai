import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as deals from "./deals";
import { describeTurn, negotiate } from "./negotiation";
import { getDeal } from "./store";
import type { Deal } from "./types";
import { holdWindow, verification } from "./verify";

/**
 * Small Claims AI as an MCP server: any AI agent (Claude, or a marketplace's agent) can open a PayPal-held deal,
 * dispute it, get an AI ruling, and settle. Money logic stays in deterministic code, and these tools are thin wrappers.
 */

const NEXT: Record<Deal["status"], string> = {
  DRAFT: "fund_deal: a human must approve the PayPal hold (automatic in mock mode).",
  FUNDED: "mark_delivered (seller), release_payment (buyer), or file_claim (buyer).",
  DELIVERED: "release_payment (buyer) or file_claim (buyer).",
  DISPUTED: "respond_to_claim (seller), then convene_court once both sides are heard.",
  RULED: "enforce_ruling (either party; flagged rulings need BOTH), or appeal_ruling once.",
  SETTLED: "Done. get_deal shows the settlement and the verification checks.",
};

/** A compact, agent-friendly view of a deal. Photos are counted, never inlined. */
export function summarize(d: Deal) {
  const r = d.rulings.at(-1);
  return {
    id: d.id,
    status: d.status,
    title: d.title,
    priceUSD: d.price,
    buyer: d.buyerName,
    seller: d.sellerName,
    acceptanceCriteria: d.criteria,
    mockPayPal: d.mock,
    holdWindow: holdWindow(d),
    evidence: d.evidence.map((e) => ({ id: e.id, by: e.by, kind: e.kind, text: e.text, photos: e.images.length })),
    latestRuling: r && {
      sellerSharePercent: r.sellerSharePercent,
      reasoning: r.reasoning,
      confidence: r.confidence,
      findings: r.findings,
      needsHumanReview: r.needsHuman,
      manipulationAttempt: r.injectionAttempt,
      integrityIssues: r.integrityIssues,
      acceptedBy: d.acceptedBy,
    },
    settlement: d.settlement,
    verification: verification(d),
    nextSteps: NEXT[d.status],
  };
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message }] });

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const dealId = z.string().describe("The deal id returned by open_deal");
const party = z.enum(["buyer", "seller"]);

export function buildServer() {
  const s = new McpServer({ name: "small-claims-ai", version: "1.0.0" });

  s.registerTool(
    "open_deal",
    {
      title: "Open a deal",
      description:
        "Open an escrow deal. An AI drafts objective acceptance criteria from the description. Optionally pass your principal's " +
        "mandateMaxSpend: the call is refused if the price exceeds it, before anything is created.",
      inputSchema: {
        title: z.string(),
        description: z.string().describe("What is being sold or done, with checkable specifics"),
        priceUSD: z.number().min(1).max(10000),
        buyerName: z.string(),
        sellerName: z.string(),
        sellerEmail: z.string().email().describe("Seller's PayPal email, used for the payout"),
        mandateMaxSpend: z.number().optional().describe("Buyer principal's spending limit in USD"),
      },
    },
    (a) =>
      run(async () => {
        if (a.mandateMaxSpend !== undefined && a.priceUSD > a.mandateMaxSpend) {
          throw new Error(
            `Refused by mandate: price $${a.priceUSD} exceeds the allowed $${a.mandateMaxSpend}. No deal was created.`
          );
        }
        return summarize(
          await deals.createDeal({
            title: a.title,
            description: a.description,
            price: a.priceUSD,
            buyerName: a.buyerName,
            sellerName: a.sellerName,
            sellerEmail: a.sellerEmail,
          })
        );
      })
  );

  s.registerTool(
    "negotiate_price",
    {
      title: "Negotiate a price with the seller's agent",
      description:
        "Run a bounded price negotiation BEFORE opening a deal. The seller's agent has a private floor; your buyer agent can never " +
        "offer more than mandateMaxSpend. Returns the transcript and, if both agree, the agreed price to pass to open_deal. " +
        "Nothing is created and PayPal is never called.",
      inputSchema: {
        item: z.string().describe("What is being bought"),
        askingPriceUSD: z.number().min(1).max(10000),
        mandateMaxSpend: z.number().min(0).describe("Buyer principal's hard spending limit in USD"),
      },
    },
    (a) =>
      run(async () => {
        const n = await negotiate(a.item, a.askingPriceUSD, a.mandateMaxSpend);
        return {
          agreed: n.agreed,
          agreedPriceUSD: n.price ?? null,
          transcript: n.turns.map(describeTurn),
          next: n.agreed ? "Call open_deal with priceUSD = agreedPriceUSD." : "No deal. Do not open an escrow.",
        };
      })
  );

  s.registerTool(
    "fund_deal",
    {
      title: "Place the PayPal hold",
      description:
        "Start the PayPal hold (authorization; the buyer is not charged). With real PayPal the HUMAN must open approveUrl " +
        "and approve; agents cannot pay on their own. Poll get_deal until status is FUNDED. In mock mode funding completes immediately.",
      inputSchema: { dealId },
    },
    (a) =>
      run(async () => {
        const url = await deals.startFunding(a.dealId);
        const d = (await getDeal(a.dealId))!;
        if (d.mock) return summarize(await deals.completeFunding(a.dealId, d.orderId!));
        return { approveUrl: url, message: "Ask the human buyer to open approveUrl and approve the hold, then poll get_deal." };
      })
  );

  s.registerTool(
    "get_deal",
    {
      title: "Get a deal",
      description: "Read a deal: status, evidence, latest ruling, settlement, verification checks and the next valid steps.",
      inputSchema: { dealId },
      annotations: { readOnlyHint: true },
    },
    (a) =>
      run(async () => {
        const d = await getDeal(a.dealId);
        if (!d) throw new Error("Deal not found");
        return summarize(d);
      })
  );

  s.registerTool(
    "mark_delivered",
    { title: "Seller: mark delivered", description: "Seller reports delivery.", inputSchema: { dealId } },
    (a) => run(async () => summarize(await deals.markDelivered(a.dealId)))
  );

  s.registerTool(
    "release_payment",
    {
      title: "Buyer: pay the seller in full",
      description: "Buyer is satisfied: capture the full held amount for the seller. Irreversible.",
      inputSchema: { dealId },
      annotations: { destructiveHint: true },
    },
    (a) => run(async () => summarize(await deals.release(a.dealId)))
  );

  s.registerTool(
    "file_claim",
    {
      title: "Buyer: file a claim",
      description: "Dispute the deal. Funds stay on hold. Be specific and use only facts you know; do not invent evidence.",
      inputSchema: { dealId, text: z.string() },
    },
    (a) => run(async () => summarize(await deals.fileClaim(a.dealId, a.text, [])))
  );

  s.registerTool(
    "respond_to_claim",
    {
      title: "Seller: respond to the claim",
      description: "Tell the seller's side. Both parties must be heard before the court convenes.",
      inputSchema: { dealId, text: z.string() },
    },
    (a) => run(async () => summarize(await deals.respondToClaim(a.dealId, a.text, [])))
  );

  s.registerTool(
    "convene_court",
    {
      title: "Convene the AI court",
      description:
        "The AI judge rules on the seller's earned share (0-100%) with findings that must cite evidence ids. " +
        "Rulings that cite nothing real, or involve a manipulation attempt, are flagged and need both parties to accept.",
      inputSchema: { dealId },
    },
    (a) => run(async () => summarize(await deals.convene(a.dealId)))
  );

  s.registerTool(
    "appeal_ruling",
    {
      title: "Appeal the ruling (once)",
      description: "One appeal, re-examining the whole record.",
      inputSchema: { dealId, by: party, text: z.string().describe("What the court got wrong") },
    },
    (a) => run(async () => summarize(await deals.appeal(a.dealId, a.by, a.text)))
  );

  s.registerTool(
    "enforce_ruling",
    {
      title: "Enforce the ruling via PayPal",
      description:
        "Capture the seller's share and release the rest (or void the hold on a 0% ruling). A flagged ruling is only enforced after BOTH parties call this. Irreversible once settled.",
      inputSchema: { dealId, by: party },
      annotations: { destructiveHint: true },
    },
    (a) => run(async () => summarize(await deals.enforce(a.dealId, a.by)))
  );

  return s;
}
