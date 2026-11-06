"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const DEMO = {
  title: "Used mirrorless camera",
  description:
    "Mirrorless camera in silver, mint condition, under 3,000 shutter actuations, includes original box, charger and a spare battery. Ships in 2 days.",
  price: "850",
  buyerName: "Ana",
  sellerName: "Raj",
  sellerEmail: "raj-seller@example.com",
};

export default function Home() {
  const router = useRouter();
  const [f, setF] = useState({ title: "", description: "", price: "", buyerName: "", sellerName: "", sellerEmail: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, price: Number(f.price) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      router.push(`/deal/${d.id}?as=buyer`);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <section className="hero">
        <p className="eyebrow">Buyer and seller protection</p>
        <h1>
          Escrow with a <em>judge</em>.
        </h1>
        <p className="lede">
          PayPal holds the money. Claude hears the dispute, weighs the photos and the messages, and rules a fair
          split. Only the deserved share ever moves.
        </p>
        <ol className="steps">
          <li><b>1 · Hold.</b> The buyer approves on PayPal. Funds are authorized, not charged.</li>
          <li><b>2 · Dispute.</b> If it goes wrong, both sides submit evidence, photos included.</li>
          <li><b>3 · Rule.</b> Claude rules a percentage. PayPal captures that share and releases the rest.</li>
        </ol>
      </section>

      <form className="card" onSubmit={submit}>
        <div className="row between">
          <h2>Open a deal</h2>
          <button type="button" className="ghost" onClick={() => setF(DEMO)}>Load demo case</button>
        </div>
        <label>What is being sold or done?<input required value={f.title} onChange={set("title")} placeholder="Used camera, logo design, sofa…" /></label>
        <label>Describe it (the AI turns this into checkable terms)
          <textarea required rows={4} value={f.description} onChange={set("description")} placeholder="Condition, what's included, delivery…" />
        </label>
        <div className="grid3">
          <label>Price (USD)<input required type="number" min="1" max="10000" step="0.01" value={f.price} onChange={set("price")} /></label>
          <label>Buyer name<input required value={f.buyerName} onChange={set("buyerName")} /></label>
          <label>Seller name<input required value={f.sellerName} onChange={set("sellerName")} /></label>
        </div>
        <label>Seller PayPal email (paid out their share)<input required type="email" value={f.sellerEmail} onChange={set("sellerEmail")} /></label>
        {err && <p className="error">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? "Drafting terms…" : "Draft terms →"}</button>
        <p className="muted small">By opening a deal both parties agree that the AI judge's ruling is binding, with one appeal.</p>
      </form>
      <footer className="foot">
        <a href="/agents">Watch AI agents litigate</a>
        <a href="/impact">Live impact dashboard</a>
        <a href="/api/openapi">API for agents (OpenAPI)</a>
      </footer>
    </main>
  );
}
