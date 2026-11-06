import { listDeals, saveDeal } from "./store";

type PayPalEvent = {
  id: string;
  event_type: string;
  resource?: { id?: string; status?: string; supplementary_data?: { related_ids?: { authorization_id?: string } } };
};

/** Record a verified PayPal event in the matching deal's ledger. Idempotent per event id. */
export async function applyEvent(ev: PayPalEvent): Promise<"recorded" | "duplicate" | "no-match" | "ignored"> {
  const tracked = /^PAYMENT\.(AUTHORIZATION|CAPTURE)\./.test(ev.event_type);
  if (!tracked) return "ignored";
  const authId = ev.resource?.supplementary_data?.related_ids?.authorization_id ?? ev.resource?.id;
  if (!authId) return "no-match";
  const deal = (await listDeals()).find((d) => d.authorizationId === authId);
  if (!deal) return "no-match";
  if (deal.log.some((l) => l.text.includes(ev.id))) return "duplicate";
  deal.log.push({
    at: new Date().toISOString(),
    text: `PayPal webhook ${ev.event_type} (${ev.resource?.status ?? "n/a"}) [${ev.id}]`,
  });
  await saveDeal(deal);
  return "recorded";
}
