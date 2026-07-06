import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The shell chrome (UI-CONTRACT §2 / DESIGN-HANDOFF §2): a 210px nav rail, a fixed terminal header
 * with the shell-path breadcrumb, and a single content slot. The page fills the module-specific
 * `headerRight` (day-kind control) and `navFooter` (e.g. Clerk UserButton) slots. Only the content
 * slot scrolls — the chrome is a fixed frame.
 */
export function AppShell({
  routeSegment,
  activeModule,
  headerRight,
  navFooter,
  children,
}: {
  routeSegment: string;
  activeModule?: "macros" | "weight";
  headerRight?: ReactNode;
  navFooter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside
        style={{
          width: 210,
          flex: "none",
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 0",
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "0 20px 16px", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
          justmy<span style={{ color: "var(--color-accent)" }}>.website</span>
        </div>
        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, padding: "8px 12px" }}>
          <NavItem label="macros" href="/macros" active={activeModule === "macros"} />
          <NavItem label="weight" href="/weight" active={activeModule === "weight"} />
          <RecipesNavLink />
          <NavItem label="shopping" soon />
        </nav>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 12 }}>
          {navFooter}
          <ThemeToggle />
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <header
          style={{
            background: "var(--color-bg)",
            borderBottom: "1px solid var(--color-border)",
            padding: "13px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flex: "none",
          }}
        >
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: "var(--color-success)" }}>curtis@justmy</span>
            <span style={{ color: "var(--color-text-muted)" }}> ~/{routeSegment}</span>
            <span style={{ color: "var(--color-accent)" }}> $</span>
            <span className="caret-blink" style={{ color: "var(--color-accent)", marginLeft: 4 }}>
              ▋
            </span>
          </div>
          {headerRight}
        </header>

        <main style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ maxWidth: 940, margin: "0 auto", padding: "32px 24px 80px" }}>{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ label, href, active, soon }: { label: string; href?: string; active?: boolean; soon?: boolean }) {
  const style: React.CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    borderRadius: "var(--radius)",
    background: active ? "var(--color-surface-raised)" : "transparent",
    border: active ? "1px solid var(--color-border)" : "1px solid transparent",
    color: active ? "var(--color-text)" : "var(--color-text-muted)",
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    textDecoration: "none",
  };
  const inner = (
    <>
      {active && (
        <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 2, background: "var(--color-accent)", borderRadius: 2 }} />
      )}
      <span style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)", width: 10 }}>{active ? "▸" : "▹"}</span>
      <span>{label}</span>
      {soon && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 8.5,
            letterSpacing: "0.1em",
            border: "1px solid var(--color-border)",
            borderRadius: 3,
            padding: "1px 4px",
          }}
        >
          SOON
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} style={style}>
      {inner}
    </Link>
  ) : (
    <div style={style}>{inner}</div>
  );
}

const RECIPES = "#c9804f"; // justmy.recipes brand color (terracotta)

/** A subtle cross-link out to the sibling site, in the recipes brand color. */
function RecipesNavLink() {
  return (
    <a
      href="https://justmy.recipes"
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: "var(--radius)", color: "var(--color-text-muted)", border: "1px solid transparent" }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, display: "flex", justifyContent: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: RECIPES }} />
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>recipes</span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, letterSpacing: "0.08em", border: `1px solid ${RECIPES}`, borderRadius: 3, padding: "2px 5px", color: RECIPES }}>SITE ↗</span>
    </a>
  );
}
