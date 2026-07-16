"use client";

import { useState } from "react";
import type { PanelRecipe } from "@/lib/panel/types";
import { SectionHeader } from "./SectionHeader";

/** ISO 8601 duration → human ("PT1H20M" → "1 hr 20 min"). The viewer formats time, not the store. */
function fmtDuration(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  const h = m[1] ? +m[1] : 0;
  const min = m[2] ? +m[2] : 0;
  return [h ? `${h} hr` : null, min ? `${min} min` : null].filter(Boolean).join(" ") || null;
}

function Ingredients({ items, size }: { items: string[]; size: string }) {
  return (
    <>
      {items.map((ing, i) => (
        <div key={i} style={{ display: "flex", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--p-border)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--p-accent)", flex: "none", marginTop: 12 }} />
          <span style={{ fontFamily: "var(--p-font-body)", fontSize: size, color: "var(--p-text)", lineHeight: 1.4 }}>{ing}</span>
        </div>
      ))}
    </>
  );
}

/**
 * The two-phase cooking problem (design brief §7), solved as Overview ↔ Step-through. Overview is
 * mise-en-place (ingredients, time, notes, an overview of the steps); step-through is execution —
 * the current step huge, a forgiving "next" target, ingredients a tap away in a bottom drawer. Step
 * progress is LOCAL state only (contract §10): it doesn't survive a reload and doesn't need to.
 */
export function RecipeScreen({ data, renderedAt }: { data: PanelRecipe; renderedAt: number }) {
  const r = data.recipe;
  const [cooking, setCooking] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!r) {
    return (
      <div className="p-empty">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="var(--p-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z" />
          <path d="M2 9h20" />
          <path d="M20 11h2v3h-2M4 11H2v3h2" />
          <path d="M9 5c0-1 1-1.5 1-2.5M13 5c0-1 1-1.5 1-2.5" />
        </svg>
        <span className="p-mono" style={{ fontSize: "var(--p-title)", color: "var(--p-muted)" }}>nothing on the burner</span>
        <span style={{ fontFamily: "var(--p-font-body)", fontSize: "var(--p-body-sm)", color: "var(--p-faint)", maxWidth: 420, lineHeight: 1.5 }}>
          Send a recipe from justmy.recipes and it&rsquo;ll be waiting here.
        </span>
      </div>
    );
  }

  const total = r.steps.length;
  const idx = Math.min(stepIdx, Math.max(0, total - 1));
  const step = r.steps[idx];

  const meta: { label: string; value: string }[] = [];
  const time = fmtDuration(r.totalTime);
  if (time) meta.push({ label: "TIME", value: time });
  if (r.recipeYield) meta.push({ label: "YIELD", value: r.recipeYield });
  if (r.nutrition?.calories != null) meta.push({ label: "PER SERVING", value: `${Math.round(r.nutrition.calories)} kcal${r.nutrition.proteinContent != null ? ` · ${Math.round(r.nutrition.proteinContent)}g P` : ""}` });

  if (!cooking) {
    return (
      <div className="p-scroll">
        <SectionHeader label="ACTIVE RECIPE" renderedAt={renderedAt} />
        <div style={{ padding: "14px 36px 28px", borderBottom: "1px solid var(--p-border)" }}>
          <div className="p-display" style={{ fontWeight: 600, fontSize: 44, lineHeight: 1.05, letterSpacing: "-0.02em" }}>{r.name}</div>
          {r.description && (
            <div style={{ fontFamily: "var(--p-font-body)", fontSize: "var(--p-body-sm)", color: "var(--p-muted)", lineHeight: 1.5, marginTop: 16 }}>{r.description}</div>
          )}
          {meta.length > 0 && (
            <div style={{ display: "flex", gap: 26, marginTop: 22 }}>
              {meta.map((mt) => (
                <div key={mt.label}>
                  <div className="p-mono" style={{ fontSize: "var(--p-micro)", letterSpacing: "0.12em", color: "var(--p-faint)" }}>{mt.label}</div>
                  <div className="p-mono" style={{ fontSize: "var(--p-body-sm)", color: "var(--p-text)", marginTop: 5 }}>{mt.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {r.ingredients.length > 0 && (
          <div style={{ padding: "28px 36px 0" }}>
            <div className="p-mono" style={{ fontSize: "var(--p-micro)", letterSpacing: "0.16em", color: "var(--p-muted)", marginBottom: 16 }}>
              INGREDIENTS <span style={{ color: "var(--p-faint)" }}>· {r.ingredients.length}</span>
            </div>
            <Ingredients items={r.ingredients} size="var(--p-body-sm)" />
          </div>
        )}

        {r.notes && (
          <div style={{ margin: "28px 36px 0", padding: "22px 24px", borderLeft: "2px solid var(--p-accent)", background: "var(--p-surf)" }}>
            <div className="p-mono" style={{ fontSize: "var(--p-micro)", letterSpacing: "0.16em", color: "var(--p-muted)", marginBottom: 12 }}>NOTES</div>
            <div style={{ fontFamily: "var(--p-font-body)", fontSize: "var(--p-body-sm)", color: "var(--p-text)", lineHeight: 1.55 }}>{r.notes}</div>
          </div>
        )}

        {total > 0 && (
          <div style={{ padding: "32px 36px 40px" }}>
            <button className="p-cta" onClick={() => { setStepIdx(0); setCooking(true); }}>
              start cooking · {total} steps →
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── step-through ──
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 36px 0", flex: "none" }}>
        <button onClick={() => setCooking(false)} style={{ background: "none", border: "none", color: "var(--p-muted)", fontFamily: "var(--p-font-mono)", fontSize: "var(--p-body-sm)", cursor: "pointer", padding: "8px 0" }}>
          ‹ overview
        </button>
        <span className="p-mono" style={{ fontSize: "var(--p-body-sm)", color: "var(--p-muted)" }}>STEP {idx + 1} / {total}</span>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "20px 36px 0", flex: "none" }}>
        {r.steps.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i <= idx ? "var(--p-accent)" : "var(--p-border)" }} />
        ))}
      </div>

      <div className="p-scroll" style={{ padding: "34px 36px 24px" }}>
        {step.heading && <div className="p-display" style={{ fontWeight: 600, fontSize: 38, lineHeight: 1.08, letterSpacing: "-0.02em", marginBottom: 22 }}>{step.heading}</div>}
        <div style={{ fontFamily: "var(--p-font-body)", fontSize: 30, lineHeight: 1.45, color: "var(--p-text)", textWrap: "pretty" }}>{step.text}</div>
      </div>

      <div style={{ flex: "none", borderTop: "1px solid var(--p-border)", padding: "20px 36px 24px" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ width: "100%", minHeight: 64, border: "1px solid var(--p-border)", borderRadius: 8, background: "var(--p-surf)", color: "var(--p-muted)", fontFamily: "var(--p-font-mono)", fontSize: "var(--p-body-sm)", cursor: "pointer", marginBottom: 16 }}>
          ☰ ingredients
        </button>
        <div style={{ display: "flex", gap: 14 }}>
          <button
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            style={{ width: 150, minHeight: 92, border: "1px solid var(--p-border)", borderRadius: 10, background: "var(--p-surf)", color: idx === 0 ? "var(--p-faint)" : "var(--p-muted)", fontFamily: "var(--p-font-mono)", fontSize: "var(--p-body-sm)", cursor: "pointer" }}
          >
            ‹ back
          </button>
          <button
            className="p-cta"
            style={{ flex: 1 }}
            onClick={() => (idx === total - 1 ? setCooking(false) : setStepIdx((i) => i + 1))}
          >
            {idx === total - 1 ? "finish ✓" : "next step →"}
          </button>
        </div>
      </div>

      <div className="p-scrim" style={{ opacity: drawerOpen ? 1 : 0, pointerEvents: drawerOpen ? "auto" : "none" }} onClick={() => setDrawerOpen(false)} />
      <div className="p-drawer" style={{ transform: drawerOpen ? "translateY(0)" : "translateY(110%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 32px 18px", borderBottom: "1px solid var(--p-border)" }}>
          <span className="p-mono" style={{ fontSize: "var(--p-label)", letterSpacing: "0.16em", color: "var(--p-muted)" }}>INGREDIENTS</span>
          <button onClick={() => setDrawerOpen(false)} style={{ background: "none", border: "none", color: "var(--p-muted)", fontSize: 34, lineHeight: 1, cursor: "pointer", padding: "0 4px" }}>
            ×
          </button>
        </div>
        <div className="p-scroll" style={{ maxHeight: 620, padding: "8px 32px 40px" }}>
          <Ingredients items={r.ingredients} size="var(--p-body)" />
        </div>
      </div>
    </div>
  );
}
