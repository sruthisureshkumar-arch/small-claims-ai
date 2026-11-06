import { NextResponse } from "next/server";
import { startAgentRun } from "@/lib/agents";

export async function POST(req: Request) {
  const b = await req.json();
  try {
    return NextResponse.json(
      await startAgentRun({ scenarioId: String(b.scenarioId), maxSpend: Number(b.maxSpend), tricky: !!b.tricky, negotiate: !!b.negotiate })
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
