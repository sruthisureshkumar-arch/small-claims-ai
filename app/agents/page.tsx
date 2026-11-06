"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SCENARIOS } from "@/lib/scenarios";
import { verification } from "@/lib/verify";
import type { Deal } from "@/lib/types";

type Item =
  | { at: string; kind: "log"; text: string }
  | { at: string; kind: "say"; by: "buyer" | "seller"; name: string; text: string };

function transcript(d: Deal): Item[] {
  const items: Item[] = [
    ...d.log.map((l) => ({ at: l.at, kind: "log" as const, text: l.text })),
    ...d.evidence.map((e) => ({
      at: e.at,
      kind: "say" as const,
      by: e.by,
      name: e.by === "buyer" ? d.buyerName : d.sellerName,
      text: e.text,
    })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

function AgentCourt() {
  const q = useSearchParams();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [maxSpend, setMaxSpend] = useState("1000");
  const [tricky, setTricky] = useState(false);
  const [haggle, setHaggle] = useState(true);
  const [haggleLog, setHaggleLog] = useState<string[]>([]);
  const [dealId, setDealId] = useState<string | null>(q.get("deal"));
  const [deal, setDeal] = useState<Deal | null>(null);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dealId) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/deals/${dealId}`, { cache: "no-store" });
      if (r.ok && !stop) setDeal(await r.json());
    };
    tick();
    const t = setInterval(tick, 1200);
    return () => { stop = true; clearInterval(t); };
  }, [dealId]);

  async function start() {
    setBusy(true); setBlocked(""); setHaggleLog([]); setDeal(null); setApproveUrl(null); setDealId(null);
    try {
      const r = await fetch("/api/agents/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId, maxSpend: Number(maxSpend), tricky, negotiate: haggle }) });
      const d = await r.json();
      if (d.blocked) { setBlocked(d.blocked); setHaggleLog(d.transcript ?? []); }
      else if (d.error) setBlocked(d.error);
      else { setDealId(d.dealId); setApproveUrl(d.approveUrl ?? null); }
    } finally { setBusy(false); }
  }

  const ruling = deal?.rulings.at(-1);
  const link = approveUrl ?? deal?.approveUrl ?? null;
  const waiting = deal?.status === "DRAFT" && !!link;
  const running = !!deal && deal.status !== "SETTLED" && !(deal.status === "RULED" && ruling?.needsHuman);

  return (
    <main className="wrap">
      <p className="eyebrow"><a href="/">← Small Claims AI</a> · <a href="/impact">Impact</a> · Agent court</p>
      <h1 className="small">Watch two AI agents litigate</h1>
      <p className="muted">
        A buyer&apos;s agent and a seller&apos;s agent run a real PayPal-held deal and dispute with no one clicking. The human sets
        a spending mandate. Agents can&apos;t approve payments, and they can&apos;t settle a flagged ruling.
      </p>

      <section className="card">
        <h2>Set up the case</h2>
        <div className="scen">
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className={scenarioId === s.id ? "tab on" : "tab"} onClick={() => setScenarioId(s.id)}>{s.label}</button>
          ))}
        </div>
        <label>Buyer agent mandate: max spend (USD). Try $600 on the $850 camera and watch the agents fail to agree.
          <input type="number" min="0" value={maxSpend} onChange={(e) => setMaxSpend(e.target.value)} />
        </label>
        <label className="row"><input style={{ width: "auto", margin: 0 }} type="checkbox" checked={haggle} onChange={(e) => setHaggle(e.target.checked)} /> Agents negotiate the price first (the seller agent has a private floor; the buyer agent can never exceed its mandate)</label>
        <label className="row"><input style={{ width: "auto", margin: 0 }} type="checkbox" checked={tricky} onChange={(e) => setTricky(e.target.checked)} /> Seller agent tries to trick the judge (prompt injection)</label>
        <button className="primary" disabled={busy || (!!deal && running)} onClick={start}>{busy ? "Starting…" : "Start the agents"}</button>
        {blocked && <p className="error">{blocked}</p>}
        {haggleLog.map((l, i) => <p key={i} className="sysline">{l}</p>)}
      </section>

      {waiting && (
        <section className="card">
          <h2>Your approval needed</h2>
          <p>Your buyer agent can&apos;t pay on its own. Approve the PayPal hold of ${deal!.price.toFixed(2)} to let it continue. You are not charged until the deal settles.</p>
          <a className="paypal" style={{ display: "inline-block", textDecoration: "none" }} href={link!}>Approve hold on PayPal</a>
        </section>
      )}

      {deal && (
        <div className="cols">
          <section className="card">
            <h2>Live transcript <span className="chip">{deal.status}</span></h2>
            {transcript(deal).map((it, i) =>
              it.kind === "log" ? (
                <p key={i} className="sysline">{it.text}</p>
              ) : (
                <div key={i} className={`bubble ${it.by}`}><b>{it.name}</b><p>{it.text}</p></div>
              )
            )}
            {waiting ? <p className="warn">Paused: waiting for you to approve the hold. Use the “Approve hold on PayPal” button above. Agents can’t pay for you.</p> : running && <p className="muted small">Agents are working…</p>}
          </section>

          <aside>
            {ruling && (
              <section className="ruling">
                <h3>The court rules</h3>
                <div className="split">
                  <div className="seg seller" style={{ width: `${ruling.sellerSharePercent}%` }}>{ruling.sellerSharePercent > 10 && `${ruling.sellerSharePercent}% seller`}</div>
                  <div className="seg buyer" style={{ width: `${100 - ruling.sellerSharePercent}%` }}>{ruling.sellerSharePercent < 90 && `${100 - ruling.sellerSharePercent}% buyer`}</div>
                </div>
                <p className="reason">{ruling.reasoning}</p>
                {ruling.injectionAttempt && <p className="warn">Manipulation attempt detected. Agents will not settle this. Humans must.</p>}
                <ul className="checks">
                  {verification(deal).map((c, i) => (
                    <li key={i}><span className={c.ok ? "ok" : "bad"}>{c.ok ? "✓" : "⚠"}</span><span><b>{c.label}.</b> <span className="muted">{c.detail}</span></span></li>
                  ))}
                </ul>
              </section>
            )}
            <p><a className="linkbtn" href={`/deal/${deal.id}?as=buyer`}>Open the full case →</a></p>
          </aside>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={<main className="wrap"><p className="muted">Loading…</p></main>}><AgentCourt /></Suspense>;
}
