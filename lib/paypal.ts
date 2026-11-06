// PayPal client for escrow-style deals (sandbox by default):
//   Orders v2 (intent=AUTHORIZE) -> hold funds
//   Payments v2 capture (partial, final_capture) / void -> settle a ruling
//   Payouts v1 -> pay the seller their share
// With no PAYPAL_CLIENT_ID/SECRET set, everything is mocked so the app runs end to end.
const BASE =
  process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export const isMock = () => !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET;
export const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

async function accessToken(): Promise<string> {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function pp(path: string, body?: unknown, requestId?: string, opts: { method?: string; representation?: boolean } = {}) {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}), // idempotency
      // By default PayPal answers a capture with just {id, status, links}; ask for the full resource.
      ...(opts.representation ? { Prefer: "return=representation" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Create an order that only AUTHORIZES (holds) the buyer's funds. */
export async function createHold(dealId: string, title: string, amount: number) {
  if (isMock()) {
    const orderId = `MOCK-ORDER-${dealId}`;
    return { orderId, approveUrl: `${appUrl()}/api/paypal/mock?token=${orderId}&deal=${dealId}` };
  }
  const order = await pp(
    "/v2/checkout/orders",
    {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: dealId,
          description: `Small Claims AI escrow: ${title}`.slice(0, 127),
          amount: { currency_code: "USD", value: money(amount) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: "PAY_NOW",
            return_url: `${appUrl()}/api/paypal/return?deal=${dealId}`,
            cancel_url: `${appUrl()}/deal/${dealId}?as=buyer&cancelled=1`,
          },
        },
      },
    },
    `hold-${dealId}`
  );
  const link = (order.links as { rel: string; href: string }[]).find(
    (l) => l.rel === "payer-action" || l.rel === "approve"
  );
  if (!link) throw new Error("PayPal response had no approval link");
  return { orderId: order.id as string, approveUrl: link.href };
}

/** After the buyer approves, place the hold. Returns the authorization id. */
export type HoldResult = { id: string; status: string; amount: number; currency: string };

export async function authorizeHold(orderId: string, expectedAmount: number): Promise<HoldResult> {
  if (isMock() || orderId.startsWith("MOCK-")) {
    return { id: `MOCK-AUTH-${orderId}`, status: "CREATED", amount: expectedAmount, currency: "USD" };
  }
  const r = await pp(`/v2/checkout/orders/${orderId}/authorize`, undefined, `auth-${orderId}`);
  const a = r.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!a?.id) throw new Error("PayPal did not return an authorization id");
  return { id: a.id, status: a.status, amount: Number(a.amount?.value), currency: a.amount?.currency_code };
}

/** Capture part (or all) of the held funds. final_capture releases the remainder back to the buyer. */
export type CaptureResult = { id: string; status: string; amount: number; currency: string; final: boolean };

export async function captureHold(authId: string, amount: number): Promise<CaptureResult> {
  if (isMock() || authId.startsWith("MOCK-")) {
    return { id: `MOCK-CAP-${authId}`, status: "COMPLETED", amount: Number(money(amount)), currency: "USD", final: true };
  }
  let r = await pp(
    `/v2/payments/authorizations/${authId}/capture`,
    { amount: { currency_code: "USD", value: money(amount) }, final_capture: true },
    `cap-${authId}`,
    { representation: true }
  );
  // Even with the Prefer header, a minimal reply is possible (e.g. an idempotent replay). Read the capture back
  // so the amount we reconcile against comes from PayPal, never from a guess.
  if (r.amount?.value === undefined && r.id) r = await pp(`/v2/payments/captures/${r.id}`, undefined, undefined, { method: "GET" });
  return {
    id: r.id as string,
    status: r.status as string,
    amount: Number(r.amount?.value),
    currency: r.amount?.currency_code,
    final: !!r.final_capture,
  };
}

/** Release the entire hold; the buyer is never charged. */
export async function voidHold(authId: string): Promise<void> {
  if (isMock() || authId.startsWith("MOCK-")) return;
  await pp(`/v2/payments/authorizations/${authId}/void`, undefined, `void-${authId}`);
}

/** Ask PayPal to verify a webhook's signature. Returns true only on an explicit SUCCESS. */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (isMock() || !webhookId) return false;
  const r = await pp("/v1/notifications/verify-webhook-signature", {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return r.verification_status === "SUCCESS";
}

/** Pay the seller. Failure is reported, not thrown, so a settled hold is never rolled back by a payout hiccup. */
export async function payoutSeller(dealId: string, email: string, amount: number): Promise<string> {
  if (amount <= 0) return "none (nothing owed)";
  if (isMock()) return `mock payout of $${money(amount)} to ${email}`;
  try {
    const r = await pp(
      "/v1/payments/payouts",
      {
        sender_batch_header: { sender_batch_id: `claims-${dealId}`, email_subject: "You were paid via Small Claims AI" },
        items: [
          {
            recipient_type: "EMAIL",
            receiver: email,
            amount: { currency: "USD", value: money(amount) },
            note: "Small Claims AI settlement",
            sender_item_id: dealId,
          },
        ],
      },
      `payout-${dealId}`
    );
    return `payout ${r.batch_header?.payout_batch_id ?? ""} ${r.batch_header?.batch_status ?? "sent"}`.trim();
  } catch (e) {
    return `payout failed: ${(e as Error).message.slice(0, 160)}`;
  }
}
