import type { PanelShopping } from "@/lib/panel/types";
import { CheckedSection } from "./CheckedSection";
import { SectionHeader } from "./SectionHeader";
import { ShoppingRow } from "./ShoppingRow";

/** Shopping (design brief §6): needed items grouped by category (the store's mental model, kept
 *  scannable), recently-checked collapsed into GOT IT. Grouping is derived here from the flat list. */
export function ShoppingScreen({ data, renderedAt }: { data: PanelShopping; renderedAt: number }) {
  const needed = data.items.filter((i) => !i.checked);
  const checked = data.items.filter((i) => i.checked);
  const cats = [...new Set(needed.map((i) => i.category))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <SectionHeader
        label={
          <>
            SHOPPING <span style={{ color: "var(--p-faint)" }}>· {data.counts.unchecked} left</span>
          </>
        }
        renderedAt={renderedAt}
      />

      {data.items.length === 0 ? (
        <div className="p-empty">
          <span className="p-mono" style={{ fontSize: "var(--p-title)", color: "var(--p-faint)" }}>list is clear</span>
          <span className="p-mono" style={{ fontSize: "var(--p-body-sm)", color: "var(--p-muted)" }}>add items from the app or the skill</span>
        </div>
      ) : (
        <div className="p-scroll" style={{ paddingBottom: 20 }}>
          {cats.map((cat) => (
            <div key={cat}>
              <div className="p-cat">{cat}</div>
              {needed
                .filter((i) => i.category === cat)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((i) => (
                  <ShoppingRow key={i.id} id={i.id} name={i.name} initialChecked={false} />
                ))}
            </div>
          ))}
          {checked.length > 0 && <CheckedSection items={checked.map((i) => ({ id: i.id, name: i.name }))} />}
        </div>
      )}
    </div>
  );
}
