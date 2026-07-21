"use client";

import { useTransition } from "react";
import { catchUpAction } from "@/app/(app)/lifting/actions";

/** Header affordance: pull recent Hevy workouts (recovers a missed webhook). Understated. */
export function CatchUpButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => catchUpAction())}
      disabled={pending}
      style={{
        background: "none",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        cursor: pending ? "default" : "pointer",
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.04em",
        padding: "5px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {pending ? "pulling…" : "catch up from Hevy ⟳"}
    </button>
  );
}
