import { NextResponse } from "next/server";
import { getDeal } from "@/lib/store";
import { holdWindow, verification } from "@/lib/verify";

export const dynamic = "force-dynamic";

// A complete, auditable case file: terms, evidence, rulings (with the exact prompt shown to the judge),
// PayPal identifiers and the deterministic verification checks. Photos are listed by count, not inlined.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const d = await getDeal(params.id);
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = {
    caseFile: { version: 1, generatedAt: new Date().toISOString() },
    deal: { ...d, evidence: d.evidence.map((e) => ({ ...e, images: undefined, imageCount: e.images.length })) },
    holdWindow: holdWindow(d),
    verification: verification(d),
  };
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="case-${d.id}.json"`,
    },
  });
}
