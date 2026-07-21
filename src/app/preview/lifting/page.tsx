import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { JournalCard } from "@/components/lifting/JournalCard";
import { LiftingDetail } from "@/components/lifting/LiftingDetail";
import { mockDetail, mockProgression, mockSummaries } from "@/components/lifting/mock";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";

/** Dev-only preview of the lifting module against mock data (read-only — no server actions). */
export default function PreviewLifting() {
  if (process.env.NODE_ENV === "production") notFound();
  const needsRead = mockSummaries.filter((s) => !s.annotation.interpreted).length;

  return (
    <AppShell
      routeSegment="lifting"
      activeModule="lifting"
      headerRight={
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-muted)", opacity: 0.7 }} />
          {needsRead} needs read
        </span>
      }
    >
      {/* journal */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 25, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>Training journal</h1>
        <div style={{ fontFamily: mono, fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 7 }}>The numbers are Hevy&apos;s; the meaning is ours. {mockSummaries.length} sessions ingested · {needsRead} awaiting a read</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {mockSummaries.map((s) => (
          <JournalCard key={s.id} s={s} />
        ))}
      </div>

      {/* detail */}
      <div style={{ margin: "40px 0 16px", fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)", borderTop: "1px dashed var(--color-border)", paddingTop: 24 }}>
        ↓ SESSION DETAIL
      </div>
      <LiftingDetail session={mockDetail} progression={mockProgression} />
    </AppShell>
  );
}
