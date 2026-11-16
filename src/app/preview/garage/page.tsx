import { notFound } from "next/navigation";
import { mdShort, rideStatLine, rideTitle } from "@/components/rides/format";
import { mockRides } from "@/components/rides/mock";
import { SectionLabel } from "@/components/settings/PairPhone";
import { AppShell } from "@/components/shell/AppShell";
import type { BikeView } from "@/lib/garage/types";
import { PreviewBikeList, PreviewPicker } from "./PreviewGarage";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";
const at = "2026-11-16T12:00:00.000Z";
const bike = (id: string, name: string, brand: string, model: string, profiles: string[], rides: number, hours: number, miles: number, last: string | null, retiredOn: string | null = null): BikeView => ({
  id,
  name,
  brand,
  model,
  modelYear: 2026,
  note: null,
  retiredOn,
  profiles,
  rides,
  movingSeconds: hours * 3600,
  distanceMeters: miles * 1609.344,
  lastRiddenOn: last,
  createdAt: at,
  updatedAt: at,
});

const BIKES: BikeView[] = [
  bike("00000000-0000-4000-8000-000000000001", "Neuron 6", "Canyon", "Neuron 6", [], 24, 31.4, 214.8, "2026-09-22"),
  bike("00000000-0000-4000-8000-000000000002", "Roscoe 8", "Trek", "Roscoe 8", [], 2, 3.9, 22.8, "2026-10-13"),
  bike("00000000-0000-4000-8000-000000000003", "Model C", "Sunday", "Model C", ["BMX"], 2, 3.9, 14.4, "2026-11-14"),
  bike("00000000-0000-4000-8000-000000000004", "Checkpoint ALR4", "Trek", "Checkpoint ALR4", ["Bike", "GRAVEL"], 22, 17.6, 171.3, "2026-11-07"),
  bike("00000000-0000-4000-8000-000000000005", "Old Hardtail", "Giant", "Talon", [], 9, 8.1, 60.2, "2026-08-02", "2026-08-10"),
];

/** Dev-only preview of /garage against mock data (writes are local no-ops). */
export default function PreviewGaragePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const pickable = BIKES.filter((b) => !b.retiredOn).map(({ id, name }) => ({ id, name }));
  const untagged = mockRides.filter((r) => r.sport === "cycling");

  return (
    <AppShell routeSegment="garage" activeModule="garage">
      <PreviewBikeList bikes={BIKES} />
      <section>
        <SectionLabel>UNTAGGED RIDES · {untagged.length}</SectionLabel>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--color-surface)" }}>
          {untagged.map((r, i) => (
            <div key={r.id} className="garage-untagged-row" style={{ borderBottom: i < untagged.length - 1 ? "1px solid var(--color-border)" : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 240px" }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 14.5, fontWeight: 600 }}>{rideTitle(r)}</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)" }}>
                  {mdShort(r.localDate)} · {r.sportProfileName ?? r.sport} · {rideStatLine(r)}
                </span>
              </div>
              <PreviewPicker bikes={pickable} value={null} />
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
