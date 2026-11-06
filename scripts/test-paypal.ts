// Exercises the REAL PayPal code paths against a stubbed fetch that mimics PayPal's documented responses.
// Run: npm run test:paypal
import assert from "node:assert/strict";

process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";
process.env.PAYPAL_WEBHOOK_ID = "WH-1";
process.env.APP_URL = "https://example.test";

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
let failPayout = false;
let minimalCapture = false;
let lastCaptureValue = "";

globalThis.fetch = (async (url: string, init: any = {}) => {
  const path = new URL(url).pathname;
  const body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
  calls.push({ url: path, method: init.method ?? "GET", body, headers: init.headers ?? {} });
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
  if (path === "/v1/oauth2/token") return ok({ access_token: "tok" });
  if (path === "/v2/checkout/orders")
    return ok({ id: "ORD1", links: [{ rel: "payer-action", href: "https://sandbox.paypal.com/approve?token=ORD1" }] });
  if (path === "/v2/checkout/orders/ORD1/authorize")
    return ok({ purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED", amount: { value: "100.00", currency_code: "USD" } }] } }] });
  if (path === "/v2/payments/authorizations/AUTH1/capture") {
    lastCaptureValue = body.amount.value;
    // Real PayPal answers minimally unless asked for the representation; model that, and the replay case.
    if (minimalCapture || init.headers?.Prefer !== "return=representation") return ok({ id: "CAP1", status: "COMPLETED" });
    return ok({ id: "CAP1", status: "COMPLETED", final_capture: true, amount: { value: body.amount.value, currency_code: "USD" } });
  }
  if (path === "/v2/payments/captures/CAP1" && init.method === "GET")
    return ok({ id: "CAP1", status: "COMPLETED", final_capture: true, amount: { value: lastCaptureValue, currency_code: "USD" } });
  if (path === "/v2/payments/authorizations/AUTH1/void") return new Response(null, { status: 204 });
  if (path === "/v1/payments/payouts") {
    if (failPayout) return new Response('{"name":"INSUFFICIENT_FUNDS"}', { status: 400 });
    return ok({ batch_header: { payout_batch_id: "PB1", batch_status: "PENDING" } });
  }
  if (path === "/v1/notifications/verify-webhook-signature") return ok({ verification_status: body.transmission_id === "good" ? "SUCCESS" : "FAILURE" });
  return new Response("not found", { status: 404 });
}) as any;

async function main() {
  const pp = await import("../lib/paypal");
  assert.equal(pp.isMock(), false);

  const hold = await pp.createHold("deal1", "Camera", 100);
  assert.equal(hold.orderId, "ORD1");
  const orderCall = calls.find((c) => c.url === "/v2/checkout/orders")!;
  assert.equal(orderCall.body.intent, "AUTHORIZE");
  assert.equal(orderCall.body.purchase_units[0].amount.value, "100.00");
  assert.equal(orderCall.headers["PayPal-Request-Id"], "hold-deal1");
  assert.equal(orderCall.body.payment_source.paypal.experience_context.return_url, "https://example.test/api/paypal/return?deal=deal1");

  const auth = await pp.authorizeHold("ORD1", 100);
  assert.deepEqual(auth, { id: "AUTH1", status: "CREATED", amount: 100, currency: "USD" });

  const cap = await pp.captureHold("AUTH1", 70);
  assert.equal(cap.amount, 70);
  assert.equal(cap.final, true);
  assert.equal(calls.at(-1)!.body.final_capture, true);
  assert.equal(calls.at(-1)!.body.amount.value, "70.00");

  assert.ok(calls.some((c) => c.url.endsWith("/capture") && c.headers.Prefer === "return=representation"), "capture must ask for the full representation");
  minimalCapture = true; // even a minimal reply must be reconciled by reading the capture back
  const cap2 = await pp.captureHold("AUTH1", 176);
  assert.deepEqual([cap2.amount, cap2.currency, cap2.final, cap2.status], [176, "USD", true, "COMPLETED"]);
  assert.ok(calls.some((c) => c.url === "/v2/payments/captures/CAP1" && c.method === "GET"));
  minimalCapture = false;

  await pp.voidHold("AUTH1");
  assert.ok(calls.some((c) => c.url.endsWith("/void")));

  assert.match(await pp.payoutSeller("deal1", "s@example.com", 70), /payout PB1 PENDING/);
  failPayout = true;
  assert.match(await pp.payoutSeller("deal1", "s@example.com", 70), /^payout failed/); // reported, not thrown
  failPayout = false;
  assert.match(await pp.payoutSeller("deal1", "s@example.com", 0), /nothing owed/);

  const h = (id: string) => new Headers({ "paypal-transmission-id": id });
  assert.equal(await pp.verifyWebhook(h("good"), {}), true);
  assert.equal(await pp.verifyWebhook(h("bad"), {}), false);

  // Agent Toolkit order check (fake tool; the real package is only loaded for the resilience case below).
  const tk = await import("../lib/paypal-toolkit");
  const order = (over: object = {}) => JSON.stringify({ id: "ORD1", status: "COMPLETED", intent: "AUTHORIZE", purchase_units: [{ amount: { value: "100.00", currency_code: "USD" } }], ...over });
  tk.setToolkitForTests({ execute: async () => `Order details:\n${order()}` });
  const good = await tk.checkOrder("ORD1", 100);
  assert.equal(good?.ok, true);
  tk.setToolkitForTests({ execute: async () => order({ purchase_units: [{ amount: { value: "90.00", currency_code: "USD" } }] }) });
  assert.equal((await tk.checkOrder("ORD1", 100))?.ok, false, "amount difference must be flagged");
  tk.setToolkitForTests({ execute: async () => { throw new Error("boom"); } });
  assert.equal((await tk.checkOrder("ORD1", 100))?.ok, null, "toolkit failure must not throw");
  tk.setToolkitForTests({ execute: async () => "no json here" });
  assert.equal((await tk.checkOrder("ORD1", 100))?.ok, null);
  tk.setToolkitForTests(null);
  const real = await tk.checkOrder("ORD1", 100); // real package, fake credentials, stubbed/blocked network
  assert.ok(real && (real.ok === null || real.ok === false || real.ok === true), "real toolkit path must return a result, not throw");
  assert.equal(await tk.checkOrder("MOCK-1", 100), null);

  console.log("PayPal client tests passed.");
}
main().catch((e) => { console.error(e); process.exit(1); });
