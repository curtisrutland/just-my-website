import { AppShell } from "@/components/shell/AppShell";
import { Skeleton } from "@/components/shell/Skeleton";

/**
 * Route-transition fallback for the shopping module — shell chrome around a grouped-list skeleton
 * (a couple of category headers, each over a run of item rows).
 */
export default function ShoppingLoading() {
  return (
    <AppShell
      routeSegment="shopping"
      activeModule="shopping"
      loading
      navFooter={<Skeleton width={28} height={28} radius={9999} />}
      headerRight={<Skeleton width={110} height={18} />}
    >
      <div style={{ display: "grid", gap: 22 }}>
        {[5, 4].map((rows, g) => (
          <div key={g} style={{ display: "grid", gap: 10 }}>
            <Skeleton width={90} height={11} />
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Skeleton width={22} height={22} radius={"var(--radius)"} />
                <Skeleton width={`${45 + ((i * 13) % 40)}%`} height={14} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
