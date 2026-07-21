import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { LiftingDetail } from "@/components/lifting/LiftingDetail";
import { getLiftProgression, getSession } from "@/lib/lifting/repo";
import { saveNotesAction, setQualityAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LiftingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  // Progression series for lifts that have an e1RM (skip bodyweight/cardio). e1RM per session, kg.
  const templateIds = Array.from(
    new Set(session.exercises.filter((e) => e.e1rmKg != null && e.exerciseTemplateId).map((e) => e.exerciseTemplateId!))
  );
  const series = await Promise.all(templateIds.map((t) => getLiftProgression(t)));
  const progression: Record<string, number[]> = {};
  for (const s of series) {
    progression[s.templateId] = s.points.map((p) => p.e1rmKg).filter((v): v is number => v != null);
  }

  return (
    <AppShell routeSegment={`lifting/${session.startedAt.slice(0, 10)}`} activeModule="lifting" navFooter={<UserButton />}>
      <LiftingDetail
        session={session}
        progression={progression}
        saveNotes={saveNotesAction.bind(null, id)}
        setQuality={setQualityAction.bind(null, id)}
      />
    </AppShell>
  );
}
