"use client";

import { useState, useTransition } from "react";
import type { BikeForm } from "@/app/(app)/garage/actions";
import type { BikeView } from "@/lib/garage/types";
import { SectionLabel } from "@/components/settings/PairPhone";

const mono = "var(--font-mono)";
const MI = 1609.344;

const hours = (sec: number) => `${(sec / 3600).toFixed(1)} h`;
const miles = (m: number) => `${(m / MI).toFixed(1)} mi`;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH[m - 1]} ${d}`;
};

type Save = (id: string | null, form: BikeForm) => Promise<{ error?: string }>;
type SetRetired = (id: string, retired: boolean) => Promise<{ error?: string }>;

/**
 * The bikes: one card each, with its profile rules and the totals its tagged rides add up to.
 * Active bikes first; retired ones are folded below. Add and edit happen inline.
 */
export function BikeList({ bikes, save, setRetired }: { bikes: BikeView[]; save: Save; setRetired: SetRetired }) {
  const active = bikes.filter((b) => !b.retiredOn);
  const retired = bikes.filter((b) => b.retiredOn);
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  return (
    <section style={{ marginBottom: 30 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <SectionLabel>BIKES</SectionLabel>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} style={linkButton}>
            + add bike
          </button>
        )}
      </div>
      {adding && <BikeEditor save={save} onDone={() => setAdding(false)} />}
      {active.length === 0 && !adding ? (
        <div style={{ border: "1px dashed var(--color-border)", borderRadius: "var(--radius)", padding: "30px 20px", textAlign: "center", fontFamily: mono, fontSize: 12, color: "var(--color-text-muted)" }}>
          no bikes yet
        </div>
      ) : (
        <div className="garage-bikes">
          {active.map((b) => (
            <BikeCard key={b.id} bike={b} save={save} setRetired={setRetired} />
          ))}
        </div>
      )}
      {retired.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button type="button" onClick={() => setShowRetired((v) => !v)} style={linkButton}>
            {showRetired ? "hide" : "show"} {retired.length} retired
          </button>
          {showRetired && (
            <div className="garage-bikes" style={{ marginTop: 10, opacity: 0.7 }}>
              {retired.map((b) => (
                <BikeCard key={b.id} bike={b} save={save} setRetired={setRetired} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BikeCard({ bike, save, setRetired }: { bike: BikeView; save: Save; setRetired: SetRetired }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (editing) return <BikeEditor bike={bike} save={save} onDone={() => setEditing(false)} />;

  const retire = () => {
    const retiring = !bike.retiredOn;
    if (retiring && !window.confirm(`Retire ${bike.name}? Its profile rules go; its rides stay tagged.`)) return;
    start(async () => {
      const r = await setRetired(bike.id, retiring);
      setError(r.error ?? null);
    });
  };

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--color-text)" }}>{bike.name}</span>
        <span style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => setEditing(true)} style={linkButton}>
            edit
          </button>
          <button type="button" onClick={retire} style={linkButton}>
            {bike.retiredOn ? "un-retire" : "retire"}
          </button>
        </span>
      </div>
      <span style={{ fontFamily: mono, fontSize: 11.5, color: "var(--color-text-muted)" }}>
        {bike.modelYear} {bike.brand} {bike.model}
        {bike.retiredOn ? ` · retired ${md(bike.retiredOn)}` : ""}
      </span>
      <span style={{ fontFamily: mono, fontSize: 13, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
        {bike.rides === 0
          ? "no rides tagged"
          : `${bike.rides} ride${bike.rides === 1 ? "" : "s"} · ${hours(bike.movingSeconds)} · ${miles(bike.distanceMeters)}`}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {bike.profiles.length ? (
          bike.profiles.map((p) => (
            <span key={p} style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.08em", color: "var(--color-accent)", border: "1px solid var(--color-accent)", borderRadius: 3, padding: "2px 6px" }}>
              {p}
            </span>
          ))
        ) : (
          <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)" }}>no profile rules · tagged by hand</span>
        )}
        {bike.lastRiddenOn && (
          <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)" }}>last {md(bike.lastRiddenOn)}</span>
        )}
      </div>
      {bike.note && <span style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--color-text-muted)" }}>{bike.note}</span>}
      {error && <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-over)" }}>{error}</span>}
    </div>
  );
}

function BikeEditor({ bike, save, onDone }: { bike?: BikeView; save: Save; onDone: () => void }) {
  const [form, setForm] = useState<BikeForm>({
    name: bike?.name ?? "",
    brand: bike?.brand ?? "",
    model: bike?.model ?? "",
    modelYear: bike ? String(bike.modelYear) : String(new Date().getFullYear()),
    note: bike?.note ?? "",
    profiles: bike?.profiles.join(", ") ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (key: keyof BikeForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await save(bike?.id ?? null, form);
      if (r.error) setError(r.error);
      else onDone();
    });
  };

  return (
    <form onSubmit={submit} style={{ border: "1px solid var(--color-accent)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
      <div className="garage-form-grid">
        <Field label="year" value={form.modelYear} onChange={set("modelYear")} inputMode="numeric" />
        <Field label="make" value={form.brand} onChange={set("brand")} />
        <Field label="model" value={form.model} onChange={set("model")} />
        <Field label="nickname" value={form.name} onChange={set("name")} placeholder={form.model || "defaults to the model"} />
      </div>
      <Field label="profiles" value={form.profiles} onChange={set("profiles")} placeholder="e.g. GRAVEL, Bike — rides on these profiles auto-tag to this bike" />
      <Field label="note" value={form.note} onChange={set("note")} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="submit" disabled={pending} style={{ ...linkButton, border: "1px solid var(--color-accent)", borderRadius: "var(--radius)", padding: "6px 12px", color: "var(--color-accent)" }}>
          {pending ? "saving…" : bike ? "save" : "add bike"}
        </button>
        <button type="button" onClick={onDone} style={linkButton}>
          cancel
        </button>
        {error && <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-over)" }}>{error}</span>}
      </div>
    </form>
  );
}

function Field({ label, ...input }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--color-text-muted)" }}>{label.toUpperCase()}</span>
      <input
        {...input}
        style={{ background: "none", border: "none", borderBottom: "1px solid var(--color-border)", color: "var(--color-text)", fontFamily: mono, fontSize: 13, padding: "5px 2px", caretColor: "var(--color-accent)", minWidth: 0 }}
      />
    </label>
  );
}

const linkButton: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontFamily: mono,
  fontSize: 11,
  color: "var(--color-text-muted)",
  cursor: "pointer",
};
