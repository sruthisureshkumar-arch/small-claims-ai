import { NextResponse } from "next/server";
import { getDeal } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const deal = await getDeal(params.id);
  return deal ? NextResponse.json(deal) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
