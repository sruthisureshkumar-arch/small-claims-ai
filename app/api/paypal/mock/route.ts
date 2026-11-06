import { NextResponse } from "next/server";

// Stands in for PayPal's approval page when no sandbox credentials are configured.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const deal = url.searchParams.get("deal") ?? "";
  return NextResponse.redirect(
    `${url.origin}/api/paypal/return?token=${encodeURIComponent(token)}&deal=${encodeURIComponent(deal)}`
  );
}
