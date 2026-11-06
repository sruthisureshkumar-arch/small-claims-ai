export type Party = "buyer" | "seller";
export type Status = "DRAFT" | "FUNDED" | "DELIVERED" | "DISPUTED" | "RULED" | "SETTLED";

export type Evidence = {
  id: string;
  by: Party;
  kind: "claim" | "response" | "appeal";
  text: string;
  images: string[]; // data URLs, downscaled client-side
  at: string;
};

export type Finding = { point: string; favors: Party | "neither"; basis: string; evidenceIds: string[] };

export type Ruling = {
  findings: Finding[];
  sellerSharePercent: number; // 0-100, integer
  reasoning: string;
  confidence: number; // 0-1
  needsHuman: boolean;
  injectionAttempt: boolean;
  /** Problems found when the code checked the ruling against the record. Any entry forces two-party sign-off. */
  integrityIssues: string[];
  /** Exactly what the judge was shown, kept for audit. Photos are counted, not stored twice. */
  audit: { context: string; imageCount: number };
  model: string;
  appeal: boolean;
  /** Measured wall-clock time for the ruling and the tokens the provider reported. */
  latencyMs: number;
  tokens?: number;
  at: string;
};

export type Settlement = {
  how: "released" | "ruling";
  sellerAmount: number;
  buyerRefund: number;
  captureId?: string;
  voided: boolean;
  payoutStatus: string;
  at: string;
};

export type Deal = {
  id: string;
  title: string;
  description: string;
  criteria: string[];
  termsDraftedBy: "claude" | "fallback";
  price: number;
  currency: "USD";
  buyerName: string;
  sellerName: string;
  sellerEmail: string;
  status: Status;
  orderId?: string;
  approveUrl?: string; // PayPal approval link while the hold is pending (agent court shows it)
  authorizationId?: string;
  fundedAt?: string;
  /** Set when the deal is run by the agent court. */
  agentRun?: { scenarioId: string; tricky: boolean; maxSpend: number };
  mock: boolean;
  evidence: Evidence[];
  rulings: Ruling[];
  acceptedBy: Party[];
  settlement?: Settlement;
  log: { at: string; text: string }[];
  createdAt: string;
};
