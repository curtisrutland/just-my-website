"use client";

import { useState, useTransition } from "react";

const mono = "var(--font-mono)";

export type PickerBike = { id: string; name: string };

/**
 * Which bike a ride was on: a select of the active bikes plus "untagged". Choosing one tags the
 * ride by hand (a manual tag, which rules never override); "untagged" removes the tag.
 */
export function BikePicker({
  bikes,
  value,
  tag,
  label = "Bike",
}: {
  bikes: PickerBike[];
  value: string | null;
  tag: (bikeId: string) => Promise<{ error?: string }>;
  label?: string;
}) {
  const [current, setCurrent] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choose = (bikeId: string) => {
    const previous = current;
    setCurrent(bikeId);
    setError(null);
    start(async () => {
      const result = await tag(bikeId);
      if (result.error) {
        setCurrent(previous);
        setError(result.error);
      }
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <select
        aria-label={label}
        value={current}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
        style={{
          fontFamily: mono,
          fontSize: 11.5,
          color: current ? "var(--color-text)" : "var(--color-text-muted)",
          background: "var(--color-surface-raised)",
          border: `1px solid ${current ? "var(--color-border)" : "var(--color-accent)"}`,
          borderRadius: "var(--radius)",
          padding: "4px 6px",
          cursor: "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        <option value="">untagged</option>
        {bikes.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {error && <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-over)" }}>{error}</span>}
    </span>
  );
}

/** How a tag was made, in a few words: "rule: GRAVEL", "you", "backfill: named in the ride". */
export function tagProvenance(tag: { assignedBy: string; reason: string | null }): string {
  if (tag.assignedBy === "manual") return "you";
  return tag.reason ? `${tag.assignedBy}: ${tag.reason}` : tag.assignedBy;
}
