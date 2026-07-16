"use client";

import { useState } from "react";
import { ShoppingRow } from "./ShoppingRow";

/** The collapsed "GOT IT" section (design brief §6): recently-checked items, hidden by default,
 *  expandable so a mis-tap stays undoable without cluttering the active list. */
export function CheckedSection({ items }: { items: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "24px 36px 0", padding: "20px 0 12px", borderTop: "1px solid var(--p-border)", cursor: "pointer" }}
      >
        <span className="p-mono" style={{ fontSize: "var(--p-micro)", letterSpacing: "0.16em", color: "var(--p-muted)" }}>
          GOT IT · {items.length}
        </span>
        <span className="p-mono" style={{ fontSize: "var(--p-body-sm)", color: "var(--p-faint)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && items.map((i) => <ShoppingRow key={i.id} id={i.id} name={i.name} initialChecked />)}
    </div>
  );
}
