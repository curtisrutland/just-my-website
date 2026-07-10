import { AppShell } from "@/components/shell/AppShell";
import { Skeleton } from "@/components/shell/Skeleton";

/**
 * Route-transition fallback for the weight module. Renders the real shell chrome (so the rail +
 * terminal header stay put and the clicked nav item keeps pulsing via `loading`) around a skeleton
 * that mirrors the page: entry form, trend chart, the 4-up stat grid, and the weigh-in list. The
 * stat grid reuses `.stat-grid`, so the real tiles swap in without a layout shift.
 */
export default function WeightLoading() {
  return (
    <AppShell
      routeSegment="weight"
      activeModule="weight"
      loading
      navFooter={<Skeleton width={28} height={28} radius={9999} />}
      headerRight={<Skeleton width={96} height={18} />}
    >
      <div style={{ display: "grid", gap: 24 }}>
        <Skeleton height={68} />
        <Skeleton height={190} />
        <div className="stat-grid" style={{ display: "grid", gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={72} />
          ))}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <Skeleton width={120} height={12} />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={34} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
