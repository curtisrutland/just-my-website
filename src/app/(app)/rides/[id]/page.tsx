import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { localStartTime } from "@/components/rides/localTime";
import { RideDetail } from "@/components/rides/RideDetail";
import { BikePicker, tagProvenance } from "@/components/garage/BikePicker";
import { listBikes, tagsForActivities } from "@/lib/garage/repo";
import { getRide } from "@/lib/rides/repo";
import { tagRideAction } from "../../garage/actions";
import { deleteRideAction, saveNameAction, saveNoteAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function RideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ride = await getRide(id, { includeStream: true });
  if (!ride) notFound();
  // Which bike it was on (garage), read as a surface; the picker writes a manual tag.
  const [tags, bikes] = await Promise.all([tagsForActivities([id]), listBikes({ includeRetired: true })]);
  const tag = tags.get(id) ?? null;
  const pickable = bikes.filter((b) => !b.retiredOn || b.id === tag?.bikeId).map(({ id, name }) => ({ id, name }));

  return (
    <AppShell routeSegment={`rides/${ride.localDate}`} activeModule="rides" navFooter={<UserButton />}>
      <RideDetail
        ride={ride}
        localStart={localStartTime(ride.startedAt)}
        saveName={saveNameAction.bind(null, id)}
        saveNote={saveNoteAction.bind(null, id)}
        deleteRide={deleteRideAction.bind(null, id)}
        bikeSlot={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>BIKE</span>
            <BikePicker key={tag?.bikeId ?? "none"} bikes={pickable} value={tag?.bikeId ?? null} tag={tagRideAction.bind(null, id)} />
            {tag && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)" }}>{tagProvenance(tag)}</span>}
          </span>
        }
      />
    </AppShell>
  );
}
