import { generateObject } from "ai";
import { z } from "zod";
import { JUDGE_MODEL, withModels } from "./judge";

/**
 * Agent-to-agent price negotiation that runs BEFORE any escrow exists.
 * Code decides every number and enforces both limits; the AI only writes the wording.
 *   - the buyer agent never offers more than its mandate (maxSpend);
 *   - the seller agent never sells below its private floor (88% of the asking price);
 *   - nothing is created and PayPal is never called unless both sides agree.
 */
export const FLOOR_RATIO = 0.88;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const usd = (n: number) => `$${n.toFixed(2)}`;

export type Turn = { by: "buyer" | "seller"; kind: "offer" | "counter" | "accept" | "walk"; amount?: number; message: string };
export type Negotiation = { agreed: boolean; price?: number; turns: Turn[]; wording: "AI" | "templates" };

type Event = Omit<Turn, "message">;

/** The deterministic negotiation: who says what at which price. */
export function planNegotiation(ask: number, maxSpend: number): { agreed: boolean; price?: number; events: Event[] } {
  const floor = r2(ask * FLOOR_RATIO);
  const events: Event[] = [];
  let offer = r2(Math.min(maxSpend, ask * 0.78));
  let counter = ask;
  for (let round = 1; round <= 3; round++) {
    events.push({ by: "buyer", kind: "offer", amount: offer });
    if (offer >= floor) {
      events.push({ by: "seller", kind: "accept", amount: offer });
      return { agreed: true, price: offer, events };
    }
    counter = r2(Math.max(floor, counter - 0.5 * (counter - offer)));
    events.push({ by: "seller", kind: "counter", amount: counter });
    if (counter <= maxSpend && round === 3) {
      events.push({ by: "buyer", kind: "accept", amount: counter });
      return { agreed: true, price: counter, events };
    }
    offer = r2(Math.min(maxSpend, offer + 0.5 * (counter - offer)));
  }
  events.push({ by: "buyer", kind: "walk" });
  return { agreed: false, events };
}

const TEMPLATE: Record<Event["kind"], (e: Event) => string> = {
  offer: () => "Given the listing and comparable prices, this is a fair offer.",
  counter: () => "I can come down a little, but not that far.",
  accept: () => "That works for us. Let's open the escrow.",
  walk: () => "That is above what my principal authorised me to spend, so I have to walk away.",
};

async function wording(item: string, ask: number, events: Event[]): Promise<{ lines: string[]; source: "AI" | "templates" }> {
  const fallback = events.map((e) => TEMPLATE[e.kind](e));
  try {
    const script = events
      .map((e, i) => `${i + 1}. ${e.by} agent ${e.kind}${e.amount !== undefined ? ` at ${usd(e.amount)}` : ""}`)
      .join("\n");
    const {
      value: { object },
    } = await withModels(
      JUDGE_MODEL,
      (model, _id, signal) =>
        generateObject({
          model,
          schema: z.object({ lines: z.array(z.string()) }),
          system:
            "You write the one-sentence lines two AI shopping agents say while haggling over a sale. " +
            "Return exactly one line per event, in order, under 25 words, polite and concrete. " +
            "Do NOT include any dollar amounts or digits, and never reveal a private limit or floor.",
          prompt: `Item: ${item} (asking ${usd(ask)})\nEvents:\n${script}`,
          abortSignal: signal,
          maxRetries: 0,
        }),
      { timeoutMs: 12_000, fallbacks: false }
    );
    const lines = object.lines.map((l, i) => (l && !/[$\d]/.test(l) ? l.trim() : fallback[i]));
    if (lines.length !== events.length) return { lines: fallback, source: "templates" };
    return { lines, source: "AI" };
  } catch {
    return { lines: fallback, source: "templates" };
  }
}

export async function negotiate(item: string, ask: number, maxSpend: number): Promise<Negotiation> {
  const plan = planNegotiation(ask, maxSpend);
  const { lines, source } = await wording(item, ask, plan.events);
  return {
    agreed: plan.agreed,
    price: plan.price,
    wording: source,
    turns: plan.events.map((e, i) => ({ ...e, message: lines[i] })),
  };
}

export function describeTurn(t: Turn): string {
  const who = t.by === "buyer" ? "Buyer agent" : "Seller agent";
  const verb = { offer: "offers", counter: "counters at", accept: "accepts", walk: "walks away" }[t.kind];
  return `Negotiation: ${who} ${verb}${t.amount !== undefined ? ` ${usd(t.amount)}` : ""}. "${t.message}"`;
}
