"use client";

import { useState, useTransition } from "react";
import type { Pairing } from "@/app/(app)/settings/devices/actions";

const mono = "var(--font-mono)";

/**
 * Pair a phone: name it, mint a token, and show the pairing code once — a QR for the app's scanner and
 * the raw JSON beneath it for paste. Done (or leaving the page) discards it; it can't be shown again.
 */
export function PairPhone({ pair }: { pair: (name: string) => Promise<Pairing> }) {
  const [name, setName] = useState("iPhone");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const mint = () =>
    start(async () => {
      setError(null);
      try {
        setPairing(await pair(name));
      } catch {
        setError("Couldn't mint a token. Try again.");
      }
    });

  const copy = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied: the text is selectable below.
    }
  };

  return (
    <section style={{ marginBottom: 26 }}>
      <SectionLabel>PAIR A PHONE</SectionLabel>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "14px 16px" }}>
        {pairing ? (
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div
              aria-label={`Pairing code for ${pairing.name}`}
              role="img"
              style={{ width: 220, height: 220, background: "#fff", borderRadius: 8, padding: 4, flex: "0 0 auto" }}
              // SVG generated server-side by `qrcode` from our own payload string.
              dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
            />
            <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontFamily: mono, fontSize: 13, color: "var(--color-text)" }}>
                Scan with the JustMy app → <span style={{ color: "var(--color-accent)" }}>Scan pairing code</span>.
              </div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                Shown once. Done, or leaving this page, discards it — the token is stored only as a hash and can&apos;t be shown again.
                Lost it? Revoke <b>{pairing.name}</b> below and pair again.
              </div>
              <code style={{ fontFamily: mono, fontSize: 11.5, wordBreak: "break-all", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "8px 10px", userSelect: "all" }}>
                {pairing.payload}
              </code>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={copy} style={button("var(--color-accent)")}>
                  {copied ? "copied" : "copy code"}
                </button>
                <button type="button" onClick={() => setPairing(null)} style={button("var(--color-text-muted)")}>
                  done
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mint();
            }}
            style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
          >
            <span style={{ fontFamily: mono, fontSize: 14, color: "var(--color-accent)" }}>pair ›</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              aria-label="Device name"
              placeholder="device name"
              style={{ flex: "1 1 200px", minWidth: 160, background: "none", border: "none", borderBottom: "1px solid var(--color-border)", color: "var(--color-text)", fontFamily: mono, fontSize: 13, padding: "6px 2px", caretColor: "var(--color-accent)" }}
            />
            <button type="submit" disabled={pending} style={button("var(--color-accent)")}>
              {pending ? "minting…" : "mint pairing code"}
            </button>
            <span style={{ flexBasis: "100%", fontFamily: mono, fontSize: 11, color: error ? "var(--color-over)" : "var(--color-text-muted)" }}>
              {error ?? "Mints a phone token: every module's reads, plus logging weight and the shopping list. No deletes."}
            </span>
          </form>
        )}
      </div>
    </section>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)", marginBottom: 10, padding: "0 2px" }}>
      {children}
    </div>
  );
}

function button(color: string): React.CSSProperties {
  return {
    fontFamily: mono,
    fontSize: 12,
    color,
    background: "none",
    border: `1px solid ${color}`,
    borderRadius: "var(--radius)",
    padding: "6px 12px",
    cursor: "pointer",
  };
}
