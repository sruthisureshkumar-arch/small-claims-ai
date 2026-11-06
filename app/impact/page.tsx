import Link from "next/link";
import { listDeals } from "@/lib/store";
import { computeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

function Tile({ big, label, note }: { big: string; label: string; note?: string }) {
  return (
    <div className="tile">
      <div className="big">{big}</div>
      <div className="lbl">{label}</div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

export default async function Impact() {
  const s = computeStats(await listDeals());
  return (
    <main className="wrap">
      <p className="eyebrow"><Link href="/">Small Claims</Link> · Impact</p>
      <h1 className="small">What the court has done</h1>
      <p className="muted">Every number is computed live from real deals in this instance. Nothing is estimated or assumed.</p>

      <h2 className="sect">Money</h2>
      <div className="tiles">
        <Tile big={usd(s.heldNow)} label="Held by PayPal right now" note="authorized, not charged" />
        <Tile big={usd(s.settledVolume)} label="Settled volume" note={`${s.settledCount} deals`} />
        <Tile big={usd(s.buyerProtected)} label="Returned to buyers" note="released or voided holds" />
        <Tile big={usd(s.sellerPaid)} label="Paid to sellers" />
      </div>

      <h2 className="sect">Disputes</h2>
      <div className="tiles">
        <Tile big={pct(s.disputedCount, s.deals)} label="Deals that became disputes" note={`${s.disputedCount} of ${s.deals}`} />
        <Tile big={s.avgRulingSeconds === null ? "–" : `${s.avgRulingSeconds.toFixed(1)}s`} label="Average time to a ruling" note="measured, per ruling" />
        <Tile big={s.avgTokens === null ? "–" : Math.round(s.avgTokens).toLocaleString()} label="Average tokens per ruling" note="as reported by the model provider" />
        <Tile big={pct(s.binding, s.rulings)} label="Rulings binding without human review" note={`${s.binding} of ${s.rulings}`} />
      </div>

      <h2 className="sect">Safety</h2>
      <div className="tiles">
        <Tile big={String(s.injectionsCaught)} label="Manipulation attempts caught" />
        <Tile big={String(s.integrityCatches)} label="Rulings the code could not reconcile" note="sent to two-party sign-off" />
        <Tile big={String(s.flagged)} label="Rulings flagged for human review" />
        <Tile big={String(s.appeals)} label="Appeals heard" />
      </div>
      {s.deals === 0 && <p className="muted">No deals yet. <Link href="/">Open one</Link> and run it through the court.</p>}
    </main>
  );
}
