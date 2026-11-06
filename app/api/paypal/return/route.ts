import { NextResponse } from "next/server";
import { completeFunding } from "@/lib/deals";

// PayPal sends the buyer back here after they approve (?token=ORDER_ID&deal=ID).
// We place the HOLD (authorize). No money is captured until a deal is settled.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const dealId = url.searchParams.get("deal");
  const base = process.env.APP_URL ?? url.origin;
  if (!token || !dealId) return NextResponse.redirect(`${base}/?error=missing_params`);
  try {
    const d = await completeFunding(dealId, token);
    if (d.agentRun) return NextResponse.redirect(`${base}/agents?deal=${dealId}`);
    return NextResponse.redirect(`${base}/deal/${dealId}?as=buyer&funded=1`);
  } catch (e) {
    return NextResponse.redirect(`${base}/deal/${dealId}?as=buyer&error=${encodeURIComponent((e as Error).message)}`);
  }
}
