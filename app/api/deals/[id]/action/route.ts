import { NextResponse } from "next/server";
import * as deals from "@/lib/deals";
import type { Party } from "@/lib/types";

export const maxDuration = 120; // the court may take a while with photos

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = await req.json();
  const id = params.id;
  const by: Party = b.by === "seller" ? "seller" : "buyer";
  try {
    switch (b.type) {
      case "fund":
        return NextResponse.json({ approveUrl: await deals.startFunding(id) });
      case "deliver":
        return NextResponse.json(await deals.markDelivered(id));
      case "release":
        return NextResponse.json(await deals.release(id));
      case "claim":
        return NextResponse.json(await deals.fileClaim(id, b.text ?? "", b.images ?? []));
      case "respond":
        return NextResponse.json(await deals.respondToClaim(id, b.text ?? "", b.images ?? []));
      case "convene":
        return NextResponse.json(await deals.convene(id));
      case "appeal":
        return NextResponse.json(await deals.appeal(id, by, b.text ?? ""));
      case "enforce":
        return NextResponse.json(await deals.enforce(id, by));
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    const status = e instanceof deals.DealError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
