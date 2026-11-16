"use client";

import { useState, useTransition } from "react";

const mono = "var(--font-mono)";

/** Run every ride through the profile rules (how a new rule reaches older rides). Hand tags stay. */
export function ApplyRules({ apply }: { apply: () => Promise<{ tagged: number }> }) {
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {result && <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)" }}>{result}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const { tagged } = await apply();
            setResult(tagged ? `${tagged} tagged by rule` : "nothing new");
          })
        }
        style={{ fontFamily: mono, fontSize: 11, color: "var(--color-accent)", background: "none", border: "1px solid var(--color-accent)", borderRadius: "var(--radius)", padding: "4px 10px", cursor: "pointer", opacity: pending ? 0.6 : 1 }}
      >
        {pending ? "applying…" : "apply rules"}
      </button>
    </span>
  );
}
