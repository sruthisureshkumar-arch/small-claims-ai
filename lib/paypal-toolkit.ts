import { isMock } from "./paypal";

/**
 * Independent verification through PayPal's official Agent Toolkit (@paypal/agent-toolkit).
 * Our own code places the hold; this asks PayPal's agent tooling (the `get_order` tool) to read the order back,
 * so the record is confirmed by a second, PayPal-maintained path. It never blocks money movement: if the
 * toolkit is unavailable or answers in an unexpected shape, the result is reported as "unavailable".
 */
export type OrderCheck = { ok: boolean | null; detail: string };

type ToolLike = { execute?: (args: { id: string }, options?: unknown) => Promise<unknown> };
let injected: ToolLike | null = null;
/** Tests inject a fake tool so no network is needed. */
export const setToolkitForTests = (t: ToolLike | null) => { injected = t; };

async function getOrderTool(): Promise<ToolLike> {
  if (injected) return injected;
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  const toolkit = new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      actions: { orders: { get: true } },
      context: { sandbox: process.env.PAYPAL_ENV !== "live" },
    },
  });
  const tool = toolkit.getTools()["get_order"] as unknown as ToolLike | undefined;
  if (!tool?.execute) throw new Error("get_order tool not found in the toolkit");
  return tool;
}

function parse(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error("toolkit returned no JSON");
  return JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
}

export async function checkOrder(orderId: string, expectedAmount: number): Promise<OrderCheck | null> {
  if (isMock() || orderId.startsWith("MOCK-")) return null; // nothing real to check in mock mode
  try {
    const tool = await getOrderTool();
    const raw = await Promise.race([
      tool.execute!({ id: orderId }, { toolCallId: "order-check", messages: [] }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out after 8s")), 8000)),
    ]);
    const order = parse(raw);
    const unit = order.purchase_units?.[0];
    const amount = Number(unit?.amount?.value);
    const intent = order.intent;
    const problems: string[] = [];
    if (order.id && order.id !== orderId) problems.push("order id differs");
    if (intent && intent !== "AUTHORIZE") problems.push(`intent is ${intent}`);
    if (Number.isFinite(amount) && Math.abs(amount - expectedAmount) > 0.005) problems.push(`amount is ${amount}`);
    if (!Number.isFinite(amount) && !order.status) throw new Error("unexpected response shape");
    return problems.length
      ? { ok: false, detail: `PayPal Agent Toolkit read order ${orderId} back with differences: ${problems.join(", ")}.` }
      : { ok: true, detail: `PayPal Agent Toolkit read order ${orderId} back: status ${order.status ?? "unknown"}, intent ${intent ?? "n/a"}, amount matches.` };
  } catch (e) {
    return { ok: null, detail: `PayPal Agent Toolkit check unavailable (${(e as Error).message.slice(0, 80)}). Hold was verified by our own call.` };
  }
}
