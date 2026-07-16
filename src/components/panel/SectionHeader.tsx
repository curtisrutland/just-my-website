"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Section header, and the panel's manual-refresh affordance (design brief §8): tapping the whole
 * header row refreshes — no dedicated button eating real estate. `renderedAt` is the server render
 * time; after any refresh (manual or poll-driven) the page re-renders with a new value, so the
 * "updated N min ago" line resets on its own. Quiet by design — a pulse, never a blocking spinner.
 */
export function SectionHeader({ label, renderedAt }: { label: React.ReactNode; renderedAt: number }) {
  const router = useRouter();
  const [pulse, setPulse] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 20_000); // keep "n min ago" honest
    return () => clearInterval(id);
  }, []);

  const mins = Math.max(0, Math.round((Date.now() - renderedAt) / 60_000));
  const label2 = pulse ? "REFRESHING…" : mins < 1 ? "JUST NOW" : `UPDATED ${mins} MIN AGO`;

  function refresh() {
    setPulse(true);
    router.refresh();
    setTimeout(() => setPulse(false), 700);
  }

  return (
    <div className="p-header" onClick={refresh}>
      <span className="p-header-label">{label}</span>
      <span className="p-updated" data-pulse={pulse ? "1" : "0"}>
        {label2}
      </span>
    </div>
  );
}
