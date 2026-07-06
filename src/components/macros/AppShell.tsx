import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { todayISO } from "./date";

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
    <div className="shell">
      <aside className="rail">
        <div className="rail-head">
          justmy<span style={{ color: "var(--color-accent)" }}>.website</span>
        </div>
        <nav className="rail-mods">
          <IndexLink />
          {/* Link straight to today's dated view — /macros is a force-dynamic redirect stub, so
              linking it would force a hard navigation (redirect hop, no prefetch). The dated URL is
              a real, prefetchable page → soft client-side transition. */}
          <NavItem label="macros" href={`/macros/${todayISO()}`} active={activeModule === "macros"} />
          <NavItem label="weight" href="/weight" active={activeModule === "weight"} />
          <RecipesNavLink />
          <GithubNavLink />
          <NavItem label="shopping" soon />
        </nav>
        <div className="rail-foot">
          {navFooter}
          <ThemeToggle />
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
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

        <main className="content">
          <div className="content-inner">{children}</div>
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

/** Return-to-index affordance, styled as a terminal `../` (up a directory) to match the shell
 *  breadcrumb. Links back to the root module switcher. */
function IndexLink() {
  return (
    <Link
      href="/"
      className="rail-index"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 12px",
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        textDecoration: "none",
      }}
    >
      <span style={{ color: "var(--color-text-muted)", width: 10 }}>▲</span>
      <span>../</span>
    </Link>
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

const GITHUB_URL = "https://github.com/curtisrutland/just-my-website";

/** Off-site link to the source repo — the machine-facing counterpart to the module list. Muted and
 *  neutral (an outline marker + REPO badge) so it sits quieter than the recipes site link. */
function GithubNavLink() {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: "var(--radius)", color: "var(--color-text-muted)", border: "1px solid transparent" }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, display: "flex", justifyContent: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, border: "1px solid var(--color-text-muted)" }} />
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>github</span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, letterSpacing: "0.08em", border: "1px solid var(--color-border)", borderRadius: 3, padding: "2px 5px", color: "var(--color-text-muted)" }}>REPO ↗</span>
    </a>
  );
}
