import { checkOrder } from "./paypal-toolkit";
import { randomUUID } from "crypto";
import { draftTerms, rule } from "./judge";
import * as pp from "./paypal";
import { getDeal, saveDeal } from "./store";
import type { Deal, Evidence, Party, Settlement } from "./types";

export class DealError extends Error {}

const now = () => new Date().toISOString();
const cents = (n: number) => Math.round(n * 100) / 100;
const note = (d: Deal, text: string) => d.log.push({ at: now(), text });

async function load(id: string) {
  const d = await getDeal(id);
  if (!d) throw new DealError("Deal not found");
  return d;
}
function expect(d: Deal, ...allowed: Deal["status"][]) {
  if (!allowed.includes(d.status)) throw new DealError(`Not allowed while the deal is ${d.status}`);
}

export async function createDeal(input: {
  title: string;
  description: string;
  price: number;
  buyerName: string;
  sellerName: string;
  sellerEmail: string;
}) {
  const price = cents(Number(input.price));
  if (!(price >= 1 && price <= 10000)) throw new DealError("Price must be between $1 and $10,000");
  if (!input.title.trim() || !input.description.trim()) throw new DealError("Title and description are required");
  const terms = await draftTerms(input.title, input.description);
  const deal: Deal = {
    id: randomUUID().slice(0, 8),
    title: input.title.trim().slice(0, 120),
    description: input.description.trim().slice(0, 2000),
    criteria: terms.criteria,
    termsDraftedBy: terms.by,
    price,
    currency: "USD",
    buyerName: input.buyerName.trim() || "Buyer",
    sellerName: input.sellerName.trim() || "Seller",
    sellerEmail: input.sellerEmail.trim(),
    status: "DRAFT",
    mock: pp.isMock(),
    evidence: [],
    rulings: [],
    acceptedBy: [],
    log: [],
    createdAt: now(),
  };
  note(deal, `Deal opened for $${price.toFixed(2)}. Terms drafted by ${terms.by === "claude" ? "AI" : "fallback"}.${terms.error ? ` AI error: ${terms.error}` : ""}`);
  return saveDeal(deal);
}

/** Append a line to a deal's ledger (used by the agent court). */
export async function logNote(id: string, text: string) {
  const d = await load(id);
  note(d, text);
  return saveDeal(d);
}

export async function startFunding(id: string) {
  const d = await load(id);
  expect(d, "DRAFT");
  const hold = await pp.createHold(d.id, d.title, d.price);
  d.orderId = hold.orderId;
  await saveDeal(d);
  return hold.approveUrl;
}

export async function completeFunding(id: string, orderId: string) {
  const d = await load(id);
  if (d.status !== "DRAFT") return d; // idempotent: return trip after a refresh
  if (d.orderId && d.orderId !== orderId) throw new DealError("Order does not match this deal");
  const hold = await pp.authorizeHold(orderId, d.price);
  // Verify PayPal's answer instead of trusting it: right amount, right currency, hold actually in place.
  if (hold.status !== "CREATED") throw new DealError(`PayPal hold is ${hold.status}, expected CREATED`);
  if (cents(hold.amount) !== d.price || hold.currency !== d.currency) {
    throw new DealError(`PayPal held ${hold.amount} ${hold.currency}, expected ${d.price} ${d.currency}`);
  }
  d.authorizationId = hold.id;
  d.fundedAt = now();
  d.status = "FUNDED";
  note(d, `Buyer approved on PayPal. $${d.price.toFixed(2)} is on hold (authorization ${d.authorizationId}). No money has moved yet.`);
  const check = await checkOrder(orderId, d.price); // second opinion via PayPal's Agent Toolkit; never blocks
  if (check) note(d, check.detail);
  return saveDeal(d);
}

export async function markDelivered(id: string) {
  const d = await load(id);
  expect(d, "FUNDED");
  d.status = "DELIVERED";
  note(d, `${d.sellerName} marked the deal delivered.`);
  return saveDeal(d);
}

function addEvidence(d: Deal, by: Party, kind: Evidence["kind"], text: string, images: string[] = []) {
  if (!text.trim()) throw new DealError("Please describe what happened");
  if (images.length > 4) throw new DealError("At most 4 photos per submission");
  if (images.some((i) => !i.startsWith("data:image/") || i.length > 1_500_000)) {
    throw new DealError("Photos must be images under about 1MB each");
  }
  d.evidence.push({ id: randomUUID().slice(0, 6), by, kind, text: text.trim().slice(0, 3000), images, at: now() });
}

export async function fileClaim(id: string, text: string, images: string[]) {
  const d = await load(id);
  expect(d, "FUNDED", "DELIVERED");
  addEvidence(d, "buyer", "claim", text, images);
  d.status = "DISPUTED";
  note(d, `${d.buyerName} filed a claim. Funds stay on hold.`);
  return saveDeal(d);
}

export async function respondToClaim(id: string, text: string, images: string[]) {
  const d = await load(id);
  expect(d, "DISPUTED");
  addEvidence(d, "seller", "response", text, images);
  note(d, `${d.sellerName} responded.`);
  return saveDeal(d);
}

export async function convene(id: string) {
  const d = await load(id);
  expect(d, "DISPUTED");
  if (!d.evidence.some((e) => e.by === "seller")) {
    throw new DealError("The seller has not responded yet. Both sides get to be heard.");
  }
  const r = await rule(d);
  d.rulings.push(r);
  d.status = "RULED";
  d.acceptedBy = [];
  note(d, `The court rules: seller earned ${r.sellerSharePercent}% (confidence ${Math.round(r.confidence * 100)}%).`);
  return saveDeal(d);
}

export async function appeal(id: string, by: Party, text: string) {
  const d = await load(id);
  expect(d, "RULED");
  if (d.rulings.some((r) => r.appeal)) throw new DealError("Only one appeal is allowed");
  addEvidence(d, by, "appeal", text);
  const r = await rule(d, { appeal: true });
  d.rulings.push(r);
  d.acceptedBy = [];
  note(d, `Appeal heard by the senior judge: seller earned ${r.sellerSharePercent}%.`);
  return saveDeal(d);
}

/**
 * Last gate before money moves. Every check here is deterministic and specific to THIS deal:
 * its own hold, its own price, its own seller, and (for rulings) its own latest ruling.
 * Returns a list of problems; settlement proceeds only if the list is empty.
 */
export function preflight(d: Deal, sellerAmount: number, how: Settlement["how"]): string[] {
  const p: string[] = [];
  if (d.settlement || d.status === "SETTLED") p.push("Deal is already settled");
  if (!d.authorizationId || !d.orderId) p.push("No PayPal hold is recorded for this deal");
  else if (d.mock && d.authorizationId !== `MOCK-AUTH-${d.orderId}`) p.push("Authorization does not belong to this deal's order");
  if (!(sellerAmount >= 0 && sellerAmount <= d.price)) p.push("Seller amount is outside 0..price");
  if (cents(sellerAmount) + cents(d.price - sellerAmount) !== d.price) p.push("Split does not add up to the price");
  if (sellerAmount > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.sellerEmail)) p.push("Seller PayPal email is invalid");
  if (how === "ruling") {
    const r = d.rulings.at(-1);
    if (!r) p.push("No ruling on record");
    else {
      if (cents((d.price * r.sellerSharePercent) / 100) !== cents(sellerAmount)) p.push("Amount does not match the ruling");
      if ((r.needsHuman || r.integrityIssues.length) && d.acceptedBy.length < 2) p.push("Flagged ruling lacks both acceptances");
    }
  }
  return p;
}

async function settle(d: Deal, sellerAmount: number, how: Settlement["how"]) {
  sellerAmount = cents(sellerAmount);
  const problems = preflight(d, sellerAmount, how);
  if (problems.length) {
    note(d, `Settlement blocked: ${problems.join("; ")}`);
    await saveDeal(d);
    throw new DealError(`Settlement blocked: ${problems.join("; ")}`);
  }
  const authId = d.authorizationId!;
  const buyerRefund = cents(d.price - sellerAmount);
  let captureId: string | undefined;
  let voided = false;
  if (sellerAmount === 0) {
    await pp.voidHold(authId); // buyer is never charged
    voided = true;
  } else {
    const cap = await pp.captureHold(authId, sellerAmount); // remainder is released
    // Reconcile PayPal's reported result with what we intended before recording anything as settled.
    if (cap.status !== "COMPLETED" || cents(cap.amount) !== sellerAmount || cap.currency !== d.currency) {
      throw new DealError(
        `PayPal capture mismatch: status ${cap.status}, amount ${cap.amount} ${cap.currency}, expected ${sellerAmount} ${d.currency}. Deal left unsettled.`
      );
    }
    captureId = cap.id;
  }
  const payoutStatus = await pp.payoutSeller(d.id, d.sellerEmail, sellerAmount);
  d.settlement = { how, sellerAmount, buyerRefund, captureId, voided, payoutStatus, at: now() };
  d.status = "SETTLED";
  note(
    d,
    voided
      ? `Hold voided. ${d.buyerName} keeps all $${d.price.toFixed(2)}.`
      : `Captured $${sellerAmount.toFixed(2)} for ${d.sellerName}; $${buyerRefund.toFixed(2)} released back to ${d.buyerName}.`
  );
  return saveDeal(d);
}

/** Buyer is happy: pay the seller in full. */
export async function release(id: string) {
  const d = await load(id);
  expect(d, "FUNDED", "DELIVERED");
  return settle(d, d.price, "released");
}

/** Enforce the latest ruling. A flagged ruling needs both parties to accept first. */
export async function enforce(id: string, by: Party) {
  const d = await load(id);
  expect(d, "RULED");
  const r = d.rulings.at(-1)!;
  if (r.needsHuman) {
    if (!d.acceptedBy.includes(by)) d.acceptedBy.push(by);
    if (d.acceptedBy.length < 2) {
      note(d, `${by === "buyer" ? d.buyerName : d.sellerName} accepted. This ruling was flagged for human review, so both parties must accept.`);
      return saveDeal(d);
    }
  }
  return settle(d, (d.price * r.sellerSharePercent) / 100, "ruling");
}
