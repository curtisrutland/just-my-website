import { AppShell } from "@/components/shell/AppShell";
import { Skeleton } from "@/components/shell/Skeleton";

/** Route-transition skeleton mirroring the journal layout (header + a few session cards). */
export default function LiftingLoading() {
  return (
    <AppShell
      routeSegment="lifting"
      activeModule="lifting"
      loading
      navFooter={<Skeleton width={28} height={28} radius={9999} />}
      headerRight={<Skeleton width={150} height={18} />}
    >
      <div style={{ display: "grid", gap: 16 }}>
        <Skeleton height={62} />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={132} />
        ))}
      </div>
    </AppShell>
  );
}
