import { NextResponse } from "next/server";
import { createDeal, DealError } from "@/lib/deals";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await createDeal(await req.json()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof DealError ? 400 : 500 });
  }
}
