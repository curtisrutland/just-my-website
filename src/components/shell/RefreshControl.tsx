"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshIcon } from "./RefreshIcon";

/** Terminal-header refresh: re-runs the server-component fetch in place via router.refresh()
 *  (no full reload, client state kept). The explicit affordance for the standalone PWA, where
 *  there is no browser chrome to re-pull data written out-of-band by the skills. */
export function RefreshControl() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label="Refresh data"
      title="Refresh data"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      style={{
        display: "flex",
        alignItems: "center",
        color: pending ? "var(--color-accent)" : "var(--color-text-muted)",
        background: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        padding: "7px 8px",
        cursor: pending ? "default" : "pointer",
      }}
    >
      <RefreshIcon size={14} className={pending ? "refresh-spin" : undefined} style={{ display: "block" }} />
    </button>
  );
}
