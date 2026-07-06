import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { buildMockShoppingList } from "@/components/shopping/mock";
import { ShoppingBoard } from "@/components/shopping/ShoppingBoard";

export const dynamic = "force-dynamic";

/** Dev-only preview of the shopping module against mock data. No server actions — the board runs
 *  local-only (optimistic updates work; nothing persists), so the full interaction can be driven. */
export default function PreviewShopping() {
  if (process.env.NODE_ENV === "production") notFound();
  const list = buildMockShoppingList();

  return (
    <AppShell
      routeSegment="shopping"
      activeModule="shopping"
      headerRight={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.1em" }}>ON THE LIST</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" }}>{list.activeCount}</span>
        </div>
      }
    >
      <ShoppingBoard initial={list} />
    </AppShell>
  );
}
