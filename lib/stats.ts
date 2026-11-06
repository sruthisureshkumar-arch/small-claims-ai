import type { Deal } from "./types";

/** Aggregates computed only from real deals in the store. No benchmarks, no estimates. */
export function computeStats(deals: Deal[]) {
  const rulings = deals.flatMap((d) => d.rulings);
  const settled = deals.filter((d) => d.status === "SETTLED" && d.settlement);
  const held = deals.filter((d) => d.authorizationId && d.status !== "SETTLED");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const toks = rulings.map((r) => r.tokens).filter((t): t is number => typeof t === "number");
  const disputed = deals.filter((d) => d.evidence.some((e) => e.kind === "claim"));

  return {
    deals: deals.length,
    heldNow: held.reduce((s, d) => s + d.price, 0),
    settledCount: settled.length,
    settledVolume: settled.reduce((s, d) => s + d.price, 0),
    disputedCount: disputed.length,
    resolvedWithoutDispute: settled.filter((d) => d.settlement!.how === "released").length,
    resolvedByCourt: settled.filter((d) => d.settlement!.how === "ruling").length,
    rulings: rulings.length,
    binding: rulings.filter((r) => !r.needsHuman).length,
    flagged: rulings.filter((r) => r.needsHuman).length,
    injectionsCaught: rulings.filter((r) => r.injectionAttempt).length,
    integrityCatches: rulings.filter((r) => r.integrityIssues.length > 0).length,
    appeals: rulings.filter((r) => r.appeal).length,
    avgRulingSeconds: avg(rulings.map((r) => r.latencyMs / 1000)),
    avgTokens: avg(toks),
    sellerPaid: settled.reduce((s, d) => s + d.settlement!.sellerAmount, 0),
    buyerProtected: settled.reduce((s, d) => s + d.settlement!.buyerRefund, 0),
  };
}
export type Stats = ReturnType<typeof computeStats>;
