import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { ShoppingBoard } from "@/components/shopping/ShoppingBoard";
import { getList } from "@/lib/shopping/repo";
import { addItemAction, deleteItemAction, patchItemAction } from "./actions";

export const dynamic = "force-dynamic";

/** The Clerk-gated shopping module — a single grouped list, web-primary full editor. The header's
 *  ON THE LIST count is server-rendered and settles via revalidation after each mutation. */
export default async function ShoppingPage() {
  const list = await getList();

  return (
    <AppShell
      routeSegment="shopping"
      activeModule="shopping"
      navFooter={<UserButton />}
      headerRight={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.1em" }}>ON THE LIST</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" }}>
            {list.activeCount}
          </span>
        </div>
      }
    >
      <ShoppingBoard initial={list} addAction={addItemAction} patchAction={patchItemAction} deleteAction={deleteItemAction} />
    </AppShell>
  );
}
