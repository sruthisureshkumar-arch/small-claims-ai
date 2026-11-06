import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/paypal";
import { applyEvent } from "@/lib/webhooks";

// Set PAYPAL_WEBHOOK_ID to enable. Unsigned or unverifiable events are never trusted.
export async function POST(req: Request) {
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    return NextResponse.json({ error: "Webhook not configured (PAYPAL_WEBHOOK_ID)" }, { status: 503 });
  }
  const event = await req.json();
  let ok = false;
  try {
    ok = await verifyWebhook(req.headers, event);
  } catch {
    ok = false;
  }
  if (!ok) return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  return NextResponse.json({ result: await applyEvent(event) });
}
