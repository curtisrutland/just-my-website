"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ExerciseView, SessionDetail, SetView } from "@/lib/lifting/types";
import { dateLine, fmtDuration, fmtVolume, fmtWeight, type Unit } from "./format";

const mono = "var(--font-mono)";

type Props = {
  session: SessionDetail;
  /** templateId → e1RM series (kg, oldest → newest), for the per-exercise progression sparkline. */
  progression: Record<string, number[]>;
  /** Optional so the /preview harness can render read-only (matches the module convention). */
  saveNotes?: (notes: string) => Promise<void>;
  setQuality?: (quality: number | null) => Promise<void>;
};

export function LiftingDetail({ session, progression, saveNotes, setQuality }: Props) {
  const [unit, setUnit] = useState<Unit>("lb");
  const a = session.annotation;

  const stats = [
    { value: fmtVolume(session.derived.tonnageKg, unit), label: `${unit} tonnage` },
    { value: fmtWeight(session.derived.topE1rmKg, unit) ?? "—", label: "top e1RM" },
    { value: String(session.derived.workingSets), label: "working sets" },
    { value: String(session.derived.durationMin ?? "—"), label: "minutes" },
  ];

  return (
    <div>
      {/* ---- session header ---- */}
      <div style={{ marginBottom: 18 }}>
        <Link href="/lifting" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 11, letterSpacing: "0.04em", paddingBottom: 12 }}>
          ‹ journal
        </Link>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{session.title ?? "Untitled session"}</h1>
              <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 3, border: "1px solid var(--color-border)", color: "var(--color-text-muted)", fontStyle: a.focus ? "normal" : "italic", opacity: a.focus ? 1 : 0.6 }}>
                {a.focus ?? "unfiled"}
              </span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", marginTop: 9, letterSpacing: "0.03em" }}>{dateLine(session.startedAt)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
              {stats.map((s) => (
                <div key={s.label} style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{s.value}</span>
                  <span style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* unit toggle */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", color: "var(--color-text-muted)" }}>UNITS</span>
            <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              {(["lb", "kg"] as Unit[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    padding: "5px 13px",
                    border: "none",
                    cursor: "pointer",
                    letterSpacing: "0.02em",
                    ...(unit === u
                      ? { background: "var(--color-accent)", color: "var(--color-bg)", fontWeight: 600 }
                      : { background: "var(--color-surface)", color: "var(--color-text-muted)" }),
                  }}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---- the juxtaposition ---- */}
      <div className="lift-detail-grid" style={{ border: "1px solid var(--color-border)", borderRadius: "calc(var(--radius) * 1.5)", overflow: "hidden" }}>
        {/* LEFT: the facts */}
        <div style={{ background: "var(--color-surface)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>THE FACTS <span style={{ opacity: 0.55 }}>· HEVY</span></span>
            <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.06em", color: "var(--color-text-muted)" }}>weight {unit} · reps</span>
          </div>
          {session.exercises.map((ex) => (
            <ExerciseBlock key={ex.index} ex={ex} unit={unit} series={ex.exerciseTemplateId ? progression[ex.exerciseTemplateId] : undefined} />
          ))}
        </div>

        {/* RIGHT: the meaning */}
        <div className="lift-meaning" style={{ borderLeft: "1px solid var(--color-border)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>THE MEANING <span style={{ opacity: 0.55 }}>· YOURS</span></span>
          </div>
          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 26 }}>
            <NotesEditor initial={a.sessionNotes} save={saveNotes} />
            <QualitySelector initial={a.quality} setQuality={setQuality} />
            {/* Claude's read — read-only */}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 22 }}>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--color-text-muted)", marginBottom: 11 }}>THE READ <span style={{ opacity: 0.55 }}>· CLAUDE</span></div>
              {a.interpretation ? (
                <div style={{ borderLeft: "2px solid var(--color-accent)", padding: "2px 0 2px 16px" }}>
                  <p style={{ fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.68, color: "var(--color-text)", margin: 0, textWrap: "pretty" }}>{a.interpretation}</p>
                  <div style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", marginTop: 14, letterSpacing: "0.03em" }}>read-only here · Claude writes it via the skill</div>
                </div>
              ) : (
                <div style={{ borderLeft: "2px solid var(--color-border)", padding: "6px 0 6px 16px" }}>
                  <p style={{ fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.6, color: "var(--color-text-muted)", margin: 0, fontStyle: "italic" }}>no interpretation yet</p>
                  <div style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", marginTop: 10, lineHeight: 1.5 }}>this session is in the un-interpreted queue — Claude reads it, then writes the focus tag and the interpretation.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 14, paddingLeft: 2, lineHeight: 1.5 }}>
        Left is Hevy&apos;s truth — sets, reps, weight, read-only. Right is the annotation layer this module owns: notes and quality are yours (saved on the spot); focus and the read are Claude&apos;s, written via the skill.
      </div>
    </div>
  );
}

// ---- Facts: one exercise ----------------------------------------------------

function ExerciseBlock({ ex, unit, series }: { ex: ExerciseView; unit: Unit; series?: number[] }) {
  const [open, setOpen] = useState(false);
  const hasProg = !!series && series.length >= 2;
  const e1rm = fmtWeight(ex.e1rmKg, unit);

  return (
    <div style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px 8px" }}>
        <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", letterSpacing: "-0.01em", minWidth: 0 }}>{ex.title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
          {e1rm != null && (
            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: "0.1em", color: "var(--color-text-muted)" }}>e1RM</span>
              <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: ex.e1rmUnreliable ? "var(--color-text-muted)" : "var(--color-text)" }}>
                {ex.e1rmUnreliable ? `(${e1rm})` : e1rm}
              </span>
            </span>
          )}
          {hasProg && (
            <button
              onClick={() => setOpen((o) => !o)}
              style={{ background: "none", border: "1px solid " + (open ? "var(--color-accent)" : "var(--color-border)"), borderRadius: 3, cursor: "pointer", color: open ? "var(--color-accent)" : "var(--color-text-muted)", fontFamily: mono, fontSize: 9, letterSpacing: "0.04em", padding: "3px 7px" }}
            >
              {open ? "hide" : "e1RM ↗"}
            </button>
          )}
        </div>
      </div>
      {ex.e1rmUnreliable && (
        <div style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", padding: "0 20px 4px", fontStyle: "italic" }}>e1RM parenthesized — best set is high-rep, estimate degrades</div>
      )}

      <div style={{ padding: "2px 20px 12px" }}>
        {ex.sets.map((set, i) => (
          <SetRow key={i} set={set} n={i + 1} unit={unit} />
        ))}
      </div>

      {open && hasProg && <ProgressionChart series={series!} unit={unit} />}
    </div>
  );
}

function SetRow({ set, n, unit }: { set: SetView; n: number; unit: Unit }) {
  const w = fmtWeight(set.weightKg, unit);
  const isCardio = set.weightKg == null && set.reps == null;
  const isBodyweight = set.weightKg == null && set.reps != null;

  let value: React.ReactNode;
  if (w != null) {
    value = (
      <>
        {w}
        <span style={{ fontSize: 9.5, color: "var(--color-text-muted)", fontWeight: 400, marginLeft: 3 }}>{unit}</span>
      </>
    );
  } else if (isCardio && set.durationSeconds != null) {
    value = fmtDuration(set.durationSeconds);
  } else if (isCardio && set.distanceMeters != null) {
    value = (
      <>
        {Math.round(set.distanceMeters)}
        <span style={{ fontSize: 9.5, color: "var(--color-text-muted)", fontWeight: 400, marginLeft: 3 }}>m</span>
      </>
    );
  } else {
    value = <span style={{ color: "var(--color-text-muted)" }}>—</span>;
  }

  const tag = set.pr ? "PR" : isBodyweight ? "bw" : isCardio ? "time" : "";
  const textColor = "var(--color-text)";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "24px 16px 1fr 72px 40px", gap: 10, alignItems: "center", padding: "5px 0" }}>
      <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{n}</span>
      <span style={{ fontFamily: mono, fontSize: 11, textAlign: "center", color: set.pr ? "var(--color-accent)" : "transparent" }}>◆</span>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", color: set.pr ? "var(--color-accent)" : "var(--color-text-muted)", opacity: set.pr ? 1 : 0.75 }}>{tag}</span>
      <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right", color: textColor }}>{value}</span>
      <span style={{ fontFamily: mono, fontSize: 12.5, fontVariantNumeric: "tabular-nums", textAlign: "right", color: set.reps != null ? textColor : "var(--color-text-muted)" }}>{set.reps ?? ""}</span>
    </div>
  );
}

function ProgressionChart({ series, unit }: { series: number[]; unit: Unit }) {
  const arr = series.map((kg) => (unit === "lb" ? Math.round(kg * 2.2046226) : kg));
  const lo = Math.min(...arr);
  const hi = Math.max(...arr);
  const span = Math.max(1, hi - lo);
  const W = 300, H = 88, pT = 14, pB = 14;
  const xAt = (k: number) => (arr.length <= 1 ? W / 2 : Math.round((k / (arr.length - 1)) * W * 10) / 10);
  const yAt = (v: number) => Math.round((H - pB - ((v - lo) / span) * (H - pT - pB)) * 10) / 10;
  const pts = arr.map((v, k) => `${xAt(k)},${yAt(v)}`).join(" ");
  const lastX = xAt(arr.length - 1);
  const lastY = yAt(arr[arr.length - 1]);

  return (
    <div style={{ margin: "0 20px 16px", padding: "14px 16px", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", color: "var(--color-text-muted)" }}>e1RM · LAST {arr.length} SESSIONS</span>
        <span style={{ fontFamily: mono, fontSize: 9, color: "var(--color-text-muted)", fontStyle: "italic" }}>evidence, not spectacle</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <polyline points={pts} style={{ fill: "none", stroke: "var(--color-accent)", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />
        <circle cx={lastX} cy={lastY} r={3.4} style={{ fill: "var(--color-accent)", stroke: "var(--color-bg)", strokeWidth: 2 }} />
        <text x={0} y={12} style={{ fontFamily: mono, fontSize: 10, fill: "var(--color-text-muted)" }}>{hi} {unit}</text>
        <text x={0} y={H - 4} style={{ fontFamily: mono, fontSize: 10, fill: "var(--color-text-muted)" }}>{lo} {unit}</text>
      </svg>
    </div>
  );
}

// ---- Meaning: editable notes + quality --------------------------------------

function NotesEditor({ initial, save }: { initial: string | null; save?: (notes: string) => Promise<void> }) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [pending, start] = useTransition();

  const dirty = value !== saved;
  const status = pending ? "saving…" : dirty ? "unsaved" : value ? "saved ✓" : "";

  const commit = () => {
    if (!save || !dirty || pending) return;
    start(async () => {
      await save(value);
      setSaved(value);
    });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--color-text-muted)" }}>SESSION NOTES</span>
        <span style={{ fontFamily: mono, fontSize: 9, color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>{status}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        placeholder="how did it feel?"
        rows={3}
        style={{ width: "100%", resize: "vertical", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", color: "var(--color-text)", fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.6, padding: "12px 13px", caretColor: "var(--color-accent)" }}
      />
    </div>
  );
}

function QualitySelector({ initial, setQuality }: { initial: number | null; setQuality?: (q: number | null) => Promise<void> }) {
  const [q, setQ] = useState<number | null>(initial);
  const [, start] = useTransition();

  const pick = (n: number) => {
    const next = q === n ? null : n;
    setQ(next);
    if (setQuality) start(() => setQuality(next));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--color-text-muted)" }}>QUALITY</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>{q != null ? `${q} / 5` : "not set"}</span>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = q != null && n <= q;
          const sel = q === n;
          return (
            <button
              key={n}
              onClick={() => pick(n)}
              title={String(n)}
              style={{
                flex: 1,
                cursor: "pointer",
                fontFamily: mono,
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                padding: "9px 0",
                borderRadius: "var(--radius)",
                border: "1px solid " + (on ? "var(--color-accent)" : "var(--color-border)"),
                background: on ? "var(--band)" : "var(--color-surface)",
                color: sel ? "var(--color-accent)" : on ? "var(--color-text)" : "var(--color-text-muted)",
                fontWeight: sel ? 600 : 400,
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", marginTop: 9, lineHeight: 1.5 }}>A subjective note, yours — not a score to celebrate.</div>
    </div>
  );
}
