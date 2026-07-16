"use client";

import { useState } from "react";

/**
 * A shopping row (design brief §6). The WHOLE row is the target (≥76px, full width). Optimistic: the
 * check lands instantly — the Pi is slow and the round-trip is real, so waiting feels broken — then
 * POSTs; on failure it reverts quietly. No router.refresh() on toggle: re-grouping mid-tap would make
 * the row jump under a greasy finger. The 60s poll reconciles grouping later (staleness is accepted).
 */
export function ShoppingRow({ id, name, initialChecked }: { id: string; name: string; initialChecked: boolean }) {
  const [checked, setChecked] = useState(initialChecked);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !checked;
    setChecked(next);
    setPending(true);
    try {
      const res = await fetch(`/api/panel/shopping/${id}/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setChecked(!next); // revert
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="p-row" data-checked={checked ? "1" : "0"} onClick={toggle}>
      <span className="p-check">
        <span className="p-check-tick">✓</span>
      </span>
      <span className="p-row-name">{name}</span>
    </div>
  );
}
