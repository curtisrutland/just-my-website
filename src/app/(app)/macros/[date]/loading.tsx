import { AppShell } from "@/components/shell/AppShell";
import { Skeleton } from "@/components/shell/Skeleton";

/**
 * Route-transition fallback for a macros day view — covers both cross-module navigation into
 * /macros and day-to-day navigation within the module (each date is a fresh server fetch). Mirrors
 * the page: day-nav row, the week strip, the rollup card with its 3-up macro grid, and the entry
 * list. `.rollup-card` / `.macro-grid` are reused so the real card swaps in shift-free.
 */
export default function MacrosDayLoading() {
  return (
    <AppShell
      routeSegment="macros"
      activeModule="macros"
      loading
      navFooter={<Skeleton width={28} height={28} radius={9999} />}
      headerRight={<Skeleton width={150} height={26} />}
    >
      <div style={{ display: "grid", gap: 22 }}>
        <div className="day-nav" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <Skeleton width={140} height={30} />
          <Skeleton width={90} height={30} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} width={44} height={52} />
          ))}
        </div>
        <div className="rollup-card" style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
          <Skeleton width={120} height={30} style={{ marginBottom: 20 }} />
          <div className="macro-grid" style={{ display: "grid" }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={64} />
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <Skeleton width={100} height={11} />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={32} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
