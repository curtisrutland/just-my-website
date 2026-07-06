"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { distinctCategories, groupByCategory } from "@/lib/shopping/group";
import type { ShoppingItemView, ShoppingList } from "@/lib/shopping/types";

/** How long a checked row lingers in place (with an undo + draining bar) before it slides into the
 *  Recently bought section. Purely visual — the check is persisted immediately. */
const LINGER_SECONDS = 4;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Patch = { category?: string; text?: string; status?: "needed" | "bought" };

/** "today" / "yesterday" / "N days ago" from an ISO instant, by the viewer's local calendar day. */
function relWhen(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const d0 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const d1 = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const diff = Math.round((d0 - d1) / 86_400_000);
  return diff <= 0 ? "today" : diff === 1 ? "yesterday" : `${diff} days ago`;
}

/**
 * The shopping board (web-primary full editor). Seeds once from the server's `getList`, then owns
 * the view as optimistic client state; every mutation also fires a server action to persist. The
 * check-off grace timer (linger + drain bar) lives here — the module's one piece of client state.
 */
export function ShoppingBoard({
  initial,
  addAction,
  patchAction,
  deleteAction,
}: {
  initial: ShoppingList;
  // Optional so the dev `/preview` harness can render read-only (local-only, no persistence).
  addAction?: (input: { category: string; text: string }) => Promise<{ id: string }>;
  patchAction?: (id: string, patch: Patch) => Promise<void>;
  deleteAction?: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState<ShoppingItemView[]>(() => [
    ...initial.active.flatMap((g) => g.items),
    ...initial.recentlyBought,
  ]);
  const [lingering, setLingering] = useState<Record<string, boolean>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editCat, setEditCat] = useState("");
  const [editText, setEditText] = useState("");
  const [addCat, setAddCat] = useState("");
  const [addText, setAddText] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const tmp = useRef(0);
  const [, startTransition] = useTransition();

  // -- derived view ----------------------------------------------------------
  const { groups, recent, catOptions, activeCount } = useMemo(() => {
    const active = items.filter((it) => it.status === "needed" || lingering[it.id]);
    const groups = groupByCategory(active);

    const now = Date.now();
    const recent = items
      .filter((it) => it.status === "bought" && !lingering[it.id] && it.checkedAt != null && now - Date.parse(it.checkedAt) <= WINDOW_MS)
      .sort((a, b) => Date.parse(b.checkedAt as string) - Date.parse(a.checkedAt as string));

    // Suggestions come from ALL items (not just active) so a category isn't lost once its items
    // are all checked off.
    const catOptions = distinctCategories(items);
    return { groups, recent, catOptions, activeCount: active.length };
  }, [items, lingering]);

  // -- mutations (optimistic local state + persist via server action) --------
  const patch = (id: string, p: Patch) => {
    if (patchAction) startTransition(() => void patchAction(id, p));
  };

  function addItem() {
    const text = addText.trim();
    if (!text) return;
    const category = addCat.trim() || "Uncategorized";
    const tempId = `tmp-${++tmp.current}`;
    setItems((prev) => [...prev, { id: tempId, category, text, status: "needed", checkedAt: null }]);
    setAddText("");
    setAddCat("");
    if (addAction) {
      startTransition(async () => {
        const { id } = await addAction({ category, text });
        setItems((prev) => prev.map((it) => (it.id === tempId ? { ...it, id } : it)));
      });
    }
  }

  function check(id: string) {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "bought", checkedAt: stamp } : it)));
    setLingering((l) => ({ ...l, [id]: true }));
    setHoverId(null);
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      setLingering((l) => {
        const next = { ...l };
        delete next[id];
        return next;
      });
    }, LINGER_SECONDS * 1000);
    patch(id, { status: "bought" });
  }

  function toNeeded(id: string) {
    clearTimeout(timers.current[id]);
    setLingering((l) => {
      const next = { ...l };
      delete next[id];
      return next;
    });
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "needed", checkedAt: null } : it)));
    patch(id, { status: "needed" });
  }

  function remove(id: string) {
    clearTimeout(timers.current[id]);
    setLingering((l) => {
      const next = { ...l };
      delete next[id];
      return next;
    });
    setItems((prev) => prev.filter((it) => it.id !== id));
    setHoverId(null);
    if (deleteAction) startTransition(() => void deleteAction(id));
  }

  function startEdit(it: ShoppingItemView) {
    setEditId(it.id);
    setEditCat(it.category);
    setEditText(it.text);
    setHoverId(null);
  }
  function cancelEdit() {
    setEditId(null);
    setEditCat("");
    setEditText("");
  }
  function saveEdit() {
    if (editId == null) return;
    const text = editText.trim();
    if (!text) return cancelEdit();
    const category = editCat.trim();
    setItems((prev) => prev.map((it) => (it.id === editId ? { ...it, text, category: category || it.category } : it)));
    patch(editId, { text, category: category || undefined });
    cancelEdit();
  }

  // -- render ----------------------------------------------------------------
  const mono = "var(--font-mono)";
  const isEmpty = activeCount === 0;

  return (
    <div>
      <datalist id="shop-cats">
        {catOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* AddItemRow */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "12px 14px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: 14, color: "var(--color-accent)", flex: "none" }}>add ›</span>
          <input
            value={addCat}
            onChange={(e) => setAddCat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            list="shop-cats"
            placeholder="category"
            style={{ width: 130, background: "none", border: "none", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 12, letterSpacing: "0.02em", caretColor: "var(--color-accent)", outline: "none" }}
          />
          <span style={{ color: "var(--color-border)", fontFamily: mono, fontSize: 13 }}>/</span>
          <input
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="a big thing of spinach…"
            style={{ flex: 1, minWidth: 130, background: "none", border: "none", color: "var(--color-text)", fontFamily: mono, fontSize: 13, caretColor: "var(--color-accent)", outline: "none" }}
          />
          <button
            type="button"
            onClick={addItem}
            style={{
              flex: "none",
              borderRadius: "var(--radius)",
              fontFamily: mono,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              padding: "6px 13px",
              cursor: "pointer",
              border: `1px solid ${addText.trim() ? "var(--color-accent)" : "var(--color-border)"}`,
              background: addText.trim() ? "var(--color-accent)" : "var(--color-surface)",
              color: addText.trim() ? "var(--color-bg)" : "var(--color-text-muted)",
            }}
          >
            add
          </button>
        </div>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 9, paddingLeft: 2 }}>
          One category level, alphabetical. No aisles, no steppers — the quantity lives in the words.
        </div>
      </section>

      {/* ShoppingList */}
      <section>
        {isEmpty ? (
          <div style={{ padding: "44px 4px", textAlign: "center", fontFamily: mono, fontSize: 12.5, color: "var(--color-text-muted)" }}>
            nothing on the list
            <span className="caret-blink" style={{ display: "inline-block", width: 7, height: 14, background: "var(--color-accent)", marginLeft: 7, verticalAlign: "middle" }} />
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.category}>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-text-muted)", padding: "0 4px 7px", borderBottom: "1px solid var(--color-border)", margin: "22px 0 0" }}>
                {g.category}
              </div>
              {g.items.map((it) => {
                const lin = !!lingering[it.id];
                if (editId === it.id) {
                  return (
                    <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", borderBottom: "1px solid var(--color-border)" }}>
                      <span style={{ width: 20, height: 20, flex: "none", border: "1px dashed var(--color-border)", borderRadius: "var(--radius)" }} />
                      <input
                        value={editCat}
                        onChange={(e) => setEditCat(e.target.value)}
                        onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" ? cancelEdit() : null)}
                        list="shop-cats"
                        placeholder="category"
                        style={{ width: 140, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", color: "var(--color-text)", fontFamily: mono, fontSize: 12, padding: "6px 8px", caretColor: "var(--color-accent)", outline: "none" }}
                      />
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" ? cancelEdit() : null)}
                        placeholder="item"
                        autoFocus
                        style={{ flex: 1, minWidth: 0, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", color: "var(--color-text)", fontFamily: mono, fontSize: 13, padding: "6px 8px", caretColor: "var(--color-accent)", outline: "none" }}
                      />
                      <button type="button" onClick={saveEdit} style={{ background: "var(--color-accent)", border: "1px solid var(--color-accent)", borderRadius: "var(--radius)", color: "var(--color-bg)", fontFamily: mono, fontSize: 11, fontWeight: 600, padding: "5px 11px", cursor: "pointer" }}>
                        save
                      </button>
                      <button type="button" onClick={cancelEdit} style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 11, padding: "5px 10px", cursor: "pointer" }}>
                        cancel
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={it.id} style={{ position: "relative", overflow: "hidden" }} onMouseEnter={() => setHoverId(it.id)} onMouseLeave={() => setHoverId((h) => (h === it.id ? null : h))}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 4px", borderBottom: "1px solid var(--color-border)" }}>
                      <button
                        type="button"
                        className="shop-check"
                        data-checked={lin ? "true" : "false"}
                        onClick={() => (lin ? toNeeded(it.id) : check(it.id))}
                        aria-label={lin ? "Undo" : "Check off"}
                        style={{ width: 20, height: 20, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius)", cursor: "pointer", padding: 0 }}
                      >
                        <span style={{ color: lin ? "var(--color-bg)" : "transparent", fontFamily: mono, fontSize: 13, fontWeight: 600, lineHeight: 1, animation: lin ? "shopping-checkpop 0.2s ease-out" : undefined }}>✓</span>
                      </button>
                      <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-body)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: lin ? "var(--color-text-muted)" : "var(--color-text)" }}>{it.text}</span>
                      {lin ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                          <span style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>checked off</span>
                          <button type="button" onClick={() => toNeeded(it.id)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 11, color: "var(--color-accent)", padding: "2px 4px" }}>
                            undo
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", gap: 14, flex: "none", opacity: hoverId === it.id ? 1 : 0, transition: "opacity 0.12s" }}>
                          <button type="button" className="shop-edit" onClick={() => startEdit(it)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.04em", color: "var(--color-text-muted)", padding: "2px 3px" }}>
                            edit
                          </button>
                          <button type="button" className="shop-del" onClick={() => remove(it.id)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.04em", color: "var(--color-text-muted)", padding: "2px 3px" }}>
                            delete
                          </button>
                        </span>
                      )}
                    </div>
                    {lin && <span style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: "100%", background: "var(--color-accent)", transformOrigin: "left", animation: `shopping-drain ${LINGER_SECONDS}s linear forwards` }} />}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </section>

      {/* RecentlyBought */}
      <section style={{ marginTop: 32 }}>
        <button type="button" onClick={() => setRecentOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "8px 4px", width: "100%" }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)", width: 10 }}>{recentOpen ? "▾" : "▸"}</span>
          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.06em", color: "var(--color-text-muted)" }}>recently bought · {recent.length}</span>
          <span style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
        </button>
        {recentOpen && (
          <div style={{ marginTop: 2 }}>
            {recent.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", borderBottom: "1px solid var(--color-border)" }}>
                <button type="button" className="shop-uncheck" onClick={() => toNeeded(r.id)} title="put back on the list" style={{ width: 20, height: 20, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius)", cursor: "pointer", padding: 0 }}>
                  <span style={{ color: "var(--color-text-muted)", fontFamily: mono, fontSize: 12, lineHeight: 1 }}>✓</span>
                </button>
                <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-body)", fontSize: 13.5, color: "var(--color-text-muted)", textDecoration: "line-through", textDecorationColor: "var(--color-border)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.text}</span>
                <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-muted)", opacity: 0.7, flex: "none" }}>{r.category}</span>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", width: 84, textAlign: "right", flex: "none", fontVariantNumeric: "tabular-nums" }}>{r.checkedAt ? relWhen(r.checkedAt) : ""}</span>
              </div>
            ))}
            <div style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)", padding: "11px 4px 0", opacity: 0.7 }}>Kept 7 days · un-check to pull an item back onto the list.</div>
          </div>
        )}
      </section>
    </div>
  );
}
