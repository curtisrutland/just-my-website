import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { ApplyRules } from "@/components/garage/ApplyRules";
import { BikeList } from "@/components/garage/BikeList";
import { BikePicker } from "@/components/garage/BikePicker";
import { mdShort, rideStatLine, rideTitle } from "@/components/rides/format";
import { SectionLabel } from "@/components/settings/PairPhone";
import { AppShell } from "@/components/shell/AppShell";
import { listBikes, tagsForActivities } from "@/lib/garage/repo";
import { listRides } from "@/lib/rides/repo";
import { applyRulesAction, saveBikeAction, setRetiredAction, tagRideAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";

/**
 * The garage (docs/garage-model.md v1): the bikes, and the cycling rides no rule or person has put
 * on a bike yet. Untagged rides are listed, never guessed — tagging one here makes a manual tag.
 * A surface: it reads rides (to find the untagged ones) and garage, each through its own repo.
 */
export default async function GaragePage() {
  const bikes = await listBikes({ includeRetired: true });
  const { items } = await listRides({ limit: 200, offset: 0 });
  const cycling = items.filter((r) => r.sport === "cycling");
  const tags = await tagsForActivities(cycling.map((r) => r.id));
  const untagged = cycling.filter((r) => !tags.has(r.id));
  const pickable = bikes.filter((b) => !b.retiredOn).map(({ id, name }) => ({ id, name }));
  const activeCount = pickable.length;

  return (
    <AppShell
      routeSegment="garage"
      activeModule="garage"
      navFooter={<UserButton />}
      headerRight={
        <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)" }}>
          {activeCount} bike{activeCount === 1 ? "" : "s"} · {cycling.length - untagged.length}/{cycling.length} rides tagged
        </span>
      }
    >
      <BikeList bikes={bikes} save={saveBikeAction} setRetired={setRetiredAction} />

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <SectionLabel>UNTAGGED RIDES · {untagged.length}</SectionLabel>
          <ApplyRules apply={applyRulesAction} />
        </div>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--color-surface)" }}>
          {untagged.length === 0 ? (
            <div style={{ padding: "26px 16px", textAlign: "center", fontFamily: mono, fontSize: 12.5, color: "var(--color-text-muted)" }}>
              every ride is on a bike
            </div>
          ) : (
            untagged.map((r, i) => (
              <div key={r.id} className="garage-untagged-row" style={{ borderBottom: i < untagged.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                <Link href={`/rides/${r.id}`} style={{ display: "flex", flexDirection: "column", gap: 4, textDecoration: "none", minWidth: 0, flex: "1 1 240px" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 14.5, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {rideTitle(r)}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {mdShort(r.localDate)} · {r.sportProfileName ?? r.sport} · {rideStatLine(r)}
                  </span>
                </Link>
                <BikePicker bikes={pickable} value={null} tag={tagRideAction.bind(null, r.id)} label={`Bike for ${rideTitle(r)}`} />
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
