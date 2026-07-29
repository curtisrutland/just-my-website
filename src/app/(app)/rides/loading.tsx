import { AppShell } from "@/components/shell/AppShell";
import { Skeleton } from "@/components/shell/Skeleton";

/** Route-transition skeleton mirroring the log layout (strip + header + a few ride cards). */
export default function RidesLoading() {
  return (
    <AppShell
      routeSegment="rides"
      activeModule="rides"
      loading
      navFooter={<Skeleton width={28} height={28} radius={9999} />}
      headerRight={<Skeleton width={120} height={18} />}
    >
      <div style={{ display: "grid", gap: 16 }}>
        <Skeleton height={34} />
        <Skeleton height={58} />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={92} />
        ))}
      </div>
    </AppShell>
  );
}
