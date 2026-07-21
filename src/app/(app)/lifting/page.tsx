import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { CatchUpButton } from "@/components/lifting/CatchUpButton";
import { JournalCard } from "@/components/lifting/JournalCard";
import { FOCUSES } from "@/components/lifting/format";
import { listSessions } from "@/lib/lifting/repo";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";

type Search = { focus?: string; needsread?: string };

export default async function LiftingJournalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const activeFocus = FOCUSES.includes(sp.focus as (typeof FOCUSES)[number]) ? sp.focus! : null;
  const needsReadOnly = sp.needsread === "1";

  // One read of the whole (small) history; filter + counts derived in-page.
  const { items, count } = await listSessions({ limit: 100 });
  const needsReadCount = items.filter((s) => !s.annotation.interpreted).length;
  const present = new Set(items.map((s) => s.annotation.focus).filter(Boolean));

  let cards = items;
  if (activeFocus) cards = cards.filter((s) => s.annotation.focus === activeFocus);
  if (needsReadOnly) cards = cards.filter((s) => !s.annotation.interpreted);

  const href = (patch: Partial<Search>) => {
    const q = new URLSearchParams();
    const focus = "focus" in patch ? patch.focus : activeFocus ?? undefined;
    const nr = "needsread" in patch ? patch.needsread : needsReadOnly ? "1" : undefined;
    if (focus) q.set("focus", focus);
    if (nr) q.set("needsread", nr);
    const s = q.toString();
    return s ? `/lifting?${s}` : "/lifting";
  };

  return (
    <AppShell
      routeSegment="lifting"
      activeModule="lifting"
      navFooter={<UserButton />}
      headerRight={
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-muted)", opacity: 0.7 }} />
            {needsReadCount === 0 ? "all read" : `${needsReadCount} needs read`}
          </span>
          <CatchUpButton />
        </div>
      }
    >
      {/* header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 25, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>Training journal</h1>
            <div style={{ fontFamily: mono, fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 7, lineHeight: 1.5 }}>
              The numbers are Hevy&apos;s; the meaning is ours. {count} sessions ingested · {needsReadCount} awaiting a read
            </div>
          </div>
          <Link href={href({ needsread: needsReadOnly ? undefined : "1" })} style={chipStyle(needsReadOnly, true, { pad: "6px 12px", size: 10.5 })}>
            {needsReadOnly ? "✓ un-interpreted only" : "un-interpreted only"}
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--color-text-muted)", marginRight: 4 }}>FOCUS</span>
          <Link href={href({ focus: undefined })} style={chipStyle(activeFocus === null, true)}>all</Link>
          {FOCUSES.map((f) => (
            <Link key={f} href={href({ focus: f })} style={chipStyle(activeFocus === f, present.has(f))}>
              {f}
            </Link>
          ))}
        </div>
      </div>

      {/* cards */}
      {cards.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cards.map((s) => (
            <JournalCard key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <div style={{ border: "1px dashed var(--color-border)", borderRadius: "calc(var(--radius) * 1.5)", padding: "44px 24px", textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 13, color: "var(--color-text-muted)" }}>
            {activeFocus || needsReadOnly ? "no sessions match — clear the filter" : "no sessions yet — connect Hevy"}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function chipStyle(active: boolean, present: boolean, opts?: { pad?: string; size?: number }): React.CSSProperties {
  return {
    fontFamily: mono,
    fontSize: opts?.size ?? 10,
    letterSpacing: "0.04em",
    padding: opts?.pad ?? "4px 9px",
    borderRadius: 3,
    textDecoration: "none",
    whiteSpace: "nowrap",
    border: "1px solid " + (active ? "var(--color-accent)" : "var(--color-border)"),
    background: active ? "var(--band)" : "var(--color-surface)",
    color: active ? "var(--color-accent)" : present ? "var(--color-text-muted)" : "rgba(104,119,126,0.5)",
  };
}
