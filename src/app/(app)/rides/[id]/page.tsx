import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { localStartTime } from "@/components/rides/localTime";
import { RideDetail } from "@/components/rides/RideDetail";
import { getRide } from "@/lib/rides/repo";
import { deleteRideAction, saveNameAction, saveNoteAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function RideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ride = await getRide(id, { includeStream: true });
  if (!ride) notFound();

  return (
    <AppShell routeSegment={`rides/${ride.localDate}`} activeModule="rides" navFooter={<UserButton />}>
      <RideDetail
        ride={ride}
        localStart={localStartTime(ride.startedAt)}
        saveName={saveNameAction.bind(null, id)}
        saveNote={saveNoteAction.bind(null, id)}
        deleteRide={deleteRideAction.bind(null, id)}
      />
    </AppShell>
  );
}
