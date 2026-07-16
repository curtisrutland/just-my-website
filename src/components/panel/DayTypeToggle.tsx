"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The day-type toggle (contract §7.2). Optimistic: the tap lands immediately, then POSTs; on failure
 * it reverts quietly. On success it refreshes so the recomputed target/remaining flow in. When unset,
 * a discreet "SET TODAY" hint (design brief §5 — discoverable, not nagging).
 */
export function DayTypeToggle({ initial }: { initial: "training" | "rest" | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);

  async function set(type: "training" | "rest") {
    if (pending || value === type) return;
    const prev = value;
    setValue(type);
    setPending(true);
    try {
      const res = await fetch("/api/panel/day-type", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setValue(prev);
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 36 }}>
      <button className={`p-btn ${value === "training" ? "p-btn-active" : ""}`} style={{ flex: 1 }} onClick={() => set("training")}>
        training
      </button>
      <button className={`p-btn ${value === "rest" ? "p-btn-active" : ""}`} style={{ flex: 1 }} onClick={() => set("rest")}>
        rest
      </button>
      {value === null && (
        <span
          className="p-mono"
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: "var(--p-micro)", letterSpacing: "0.12em", color: "var(--p-faint)" }}
        >
          SET TODAY
        </span>
      )}
    </div>
  );
}
