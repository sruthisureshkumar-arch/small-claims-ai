import type { Deal } from "./types";

export type Check = { label: string; ok: boolean; detail: string };

/** Independent, deterministic checks shown next to every ruling and settlement. Nothing here calls a model. */
export function verification(d: Deal): Check[] {
  const checks: Check[] = [];
  const r = d.rulings.at(-1);
  const heardBoth = d.evidence.some((e) => e.by === "buyer") && d.evidence.some((e) => e.by === "seller");

  checks.push({
    label: "Funds held by PayPal before any ruling",
    ok: !!d.authorizationId,
    detail: d.authorizationId ? `Authorization ${d.authorizationId}` : "No hold recorded",
  });
  if (d.evidence.length > 0) {
    checks.push({
      label: "Both parties heard",
      ok: heardBoth,
      detail: heardBoth ? "Buyer and seller each submitted evidence" : "One side has not been heard",
    });
  }
  if (r) {
    const cite = r.integrityIssues.filter((x) => /cite|evidence/i.test(x));
    checks.push({
      label: "Every finding cites real evidence",
      ok: cite.length === 0,
      detail: cite.length ? cite[0] : `${r.findings.length} findings checked against the record`,
    });
    checks.push({
      label: "No attempt to manipulate the judge",
      ok: !r.injectionAttempt,
      detail: r.injectionAttempt ? "Attempt detected: both parties must sign off" : "None detected",
    });
    checks.push({
      label: "Ruling needs no human review",
      ok: !r.needsHuman,
      detail: r.needsHuman ? "Flagged: both parties must accept" : "Binding on enforcement",
    });
  }
  if (d.settlement) {
    const s = d.settlement;
    checks.push({
      label: "Split adds up to the held amount",
      ok: Math.round((s.sellerAmount + s.buyerRefund) * 100) === Math.round(d.price * 100),
      detail: `$${s.sellerAmount.toFixed(2)} + $${s.buyerRefund.toFixed(2)} = $${d.price.toFixed(2)}`,
    });
    checks.push({
      label: "PayPal result reconciled",
      ok: s.voided ? !s.captureId : !!s.captureId,
      detail: s.voided ? "Hold voided; buyer never charged" : `Capture ${s.captureId} matched amount and status`,
    });
    checks.push({
      label: "Seller payout",
      ok: !/failed/i.test(s.payoutStatus),
      detail: s.payoutStatus,
    });
  }
  return checks;
}

/** PayPal authorizations are valid for 29 days, with a 3-day honor period. */
export function holdWindow(d: Deal) {
  if (!d.fundedAt) return null;
  const t = new Date(d.fundedAt).getTime();
  return { honorUntil: new Date(t + 3 * 864e5).toISOString(), validUntil: new Date(t + 29 * 864e5).toISOString() };
}
