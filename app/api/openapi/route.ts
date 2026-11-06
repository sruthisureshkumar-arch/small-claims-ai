import { NextResponse } from "next/server";

// Machine-readable description so AI agents (buyers, sellers, marketplaces) can use the court directly.
const action = (type: string, desc: string, extra: Record<string, unknown> = {}) => ({
  type: "object",
  description: desc,
  required: ["type"],
  properties: { type: { const: type }, by: { enum: ["buyer", "seller"] }, ...extra },
});

export async function GET(req: Request) {
  const server = process.env.APP_URL ?? new URL(req.url).origin;
  return NextResponse.json({
    openapi: "3.0.3",
    info: {
      title: "Small Claims AI",
      version: "1.0.0",
      description:
        "Escrow with an AI judge on PayPal. Agents open a deal, the buyer approves a PayPal hold, and disputes are decided by a bounded AI ruling. Money only moves through deterministic, reconciled settlement.",
    },
    servers: [{ url: server }],
    paths: {
      "/api/deals": {
        post: {
          summary: "Open a deal. The AI drafts checkable terms.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "description", "price", "buyerName", "sellerName", "sellerEmail"],
                  properties: {
                    title: { type: "string" }, description: { type: "string" }, price: { type: "number", minimum: 1, maximum: 10000 },
                    buyerName: { type: "string" }, sellerName: { type: "string" }, sellerEmail: { type: "string", format: "email" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "The deal, in DRAFT status" } },
        },
      },
      "/api/agents/start": {
        post: {
          summary: "Run the agent court: a buyer agent and a seller agent run a deal and dispute. Enforces a spending mandate; agents never approve PayPal holds and never settle flagged rulings.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["scenarioId", "maxSpend"], properties: { scenarioId: { enum: ["camera", "logo", "tickets"] }, maxSpend: { type: "number" }, tricky: { type: "boolean" } } } } } },
          responses: { "200": { description: "{ dealId } or { blocked } or { dealId, approveUrl } when a human must approve the PayPal hold" } },
        },
      },
      "/api/deals/{id}": { get: { summary: "Read a deal", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deal" } } } },
      "/api/deals/{id}/record": { get: { summary: "Download the auditable case file with verification checks", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Case file JSON" } } } },
      "/api/deals/{id}/action": {
        post: {
          summary: "Advance a deal. Valid actions depend on status (DRAFT > FUNDED > DELIVERED/DISPUTED > RULED > SETTLED).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    action("fund", "Buyer: create the PayPal hold. Returns approveUrl for the human or wallet to approve."),
                    action("deliver", "Seller: mark delivered."),
                    action("release", "Buyer: pay the seller in full."),
                    action("claim", "Buyer: dispute. Funds stay on hold.", { text: { type: "string" }, images: { type: "array", maxItems: 4, items: { type: "string", description: "image data URL under ~1MB" } } }),
                    action("respond", "Seller: answer the claim.", { text: { type: "string" }, images: { type: "array", maxItems: 4, items: { type: "string" } } }),
                    action("convene", "Either: have the AI judge rule. Requires both sides to have been heard."),
                    action("appeal", "Either: one appeal, re-examining the whole record.", { text: { type: "string" } }),
                    action("enforce", "Either: execute the ruling via PayPal capture/void. Flagged rulings need both parties to call this."),
                  ],
                },
              },
            },
          },
          responses: { "200": { description: "Updated deal (or approveUrl for fund)" }, "400": { description: "Action not allowed or check failed" } },
        },
      },
    },
  });
}
