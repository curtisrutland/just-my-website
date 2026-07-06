import Link from "next/link";
import { todayISO } from "@/lib/date";

type Module = {
  glyph: string;
  name: string;
  badge: string;
  desc: string;
  href: string | null;
  active: boolean;
  external?: boolean;
  color?: string; // brand color for a cross-link (overrides the accent/muted scheme)
  muted?: boolean; // neutral off-site link (e.g. the repo) — quieter than a branded cross-link
};

const RECIPES = "#c9804f";
const GITHUB_URL = "https://github.com/curtisrutland/just-my-website";

const MODULES: Module[] = [
  {
    glyph: "▸",
    name: "macros",
    badge: "LIVE",
    href: "/macros",
    active: true,
    desc: "Log food in plain words; Claude estimates the macros. Dual-target days stay honest about the rest–training range.",
  },
  {
    glyph: "▸",
    name: "weight",
    badge: "LIVE",
    href: "/weight",
    active: true,
    desc: "Weigh in daily; the 7-day rolling average leads and the raw dots stay subordinate. The trend is the truth, not any single morning.",
  },
  {
    glyph: "▸",
    name: "shopping",
    badge: "LIVE",
    href: "/shopping",
    active: true,
    desc: "A running list, one grouping level deep — no quantities, no aisles, the detail lives in the words. Claude stocks it; you clear it in the store.",
  },
  {
    glyph: "◆",
    name: "recipes",
    badge: "SITE ↗",
    href: "https://justmy.recipes",
    active: true,
    external: true,
    color: RECIPES,
    desc: "Curtis’s recipe box — protein-forward, freezer-friendly, and mercifully free of life stories. A separate site.",
  },
  {
    glyph: "◇",
    name: "github",
    badge: "REPO ↗",
    href: GITHUB_URL,
    active: true,
    external: true,
    muted: true,
    desc: "The source — Next.js, Neon, Drizzle; one human user and one machine user. Built in the open.",
  },
];

/** The root landing (Index.dc.html): brand, a terminal `ls modules` line, the module list, footer. */
export function Landing() {
  // Link macros straight to today's dated view — /macros is a force-dynamic redirect stub, so
  // linking it forces a hard navigation (redirect hop, no prefetch). The dated URL is a real page.
  const today = todayISO();
  const modules = MODULES.map((m) => (m.name === "macros" ? { ...m, href: `/macros/${today}` } : m));
  const mods = modules.filter((m) => !m.external);
  const live = mods.filter((m) => m.active).length;
  const sites = modules.length - mods.length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px" }}>
      <div style={{ width: "100%", maxWidth: 640, padding: "88px 0 60px" }}>
        {/* brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" width={38} height={38} alt="" style={{ borderRadius: 9, flex: "none" }} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>
            justmy<span style={{ color: "var(--color-text-muted)" }}>.website</span>
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.06em", color: "var(--color-text-muted)", marginBottom: 44, paddingLeft: 52 }}>
          Curtis&apos;s private data platform. One user. No accounts to add, nothing to sell.
        </div>

        {/* terminal line */}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ color: "var(--color-success)" }}>curtis@justmy</span>
          <span style={{ color: "var(--color-text-muted)" }}>~</span>
          <span style={{ color: "var(--color-accent)" }}>$</span>
          <span style={{ color: "var(--color-text-muted)" }}>ls modules</span>
          <span className="caret-blink" style={{ display: "inline-block", width: 8, height: 15, background: "var(--color-accent)" }} />
        </div>

        {/* module list */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "calc(var(--radius) * 1.5)", overflow: "hidden", background: "var(--color-surface)" }}>
          {modules.map((m, i) => (
            <ModuleRow key={m.name} m={m} first={i === 0} />
          ))}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)" }}>
          <span>
            {mods.length} modules · {live} live{sites ? ` · ${sites} off-site` : ""}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-success)" }} />
            private · encrypted · single-user
          </span>
        </div>
      </div>
    </div>
  );
}

function ModuleRow({ m, first }: { m: Module; first: boolean }) {
  const arrow = m.external ? "↗" : m.active ? "›" : "";
  // Three schemes: branded cross-link (hex `color`, alpha-blended marker), neutral off-site
  // (`muted`, theme-aware tokens), or the default accent/soon scheme.
  const accent = m.color ?? (m.muted ? "var(--color-text-muted)" : m.active ? "var(--color-accent)" : "var(--color-text-muted)");
  const markerBorder = m.color ? `${m.color}66` : "var(--color-border)";
  const markerBg = m.color ? `${m.color}1f` : "var(--color-surface-raised)";
  const badgeBorder = m.color ?? (m.muted ? "var(--color-border)" : m.active ? "var(--color-accent)" : "var(--color-border)");
  const arrowColor = m.color ?? (m.muted ? "var(--color-text-muted)" : m.active ? "var(--color-accent)" : "var(--color-border)");
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    padding: "20px 22px",
    textDecoration: "none",
    borderTop: first ? "none" : "1px solid var(--color-border)",
    color: "inherit",
  };
  const content = (
    <>
      <span
        style={{
          width: 34,
          height: 34,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius)",
          fontFamily: "var(--font-mono)",
          fontSize: m.external ? 14 : 15,
          lineHeight: 1,
          border: `1px solid ${markerBorder}`,
          background: markerBg,
          color: accent,
        }}
      >
        {m.glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: m.active ? "var(--color-text)" : "var(--color-text-muted)" }}>{m.name}</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 8.5,
              letterSpacing: "0.1em",
              padding: "2px 6px",
              borderRadius: 3,
              border: `1px solid ${badgeBorder}`,
              color: accent,
            }}
          >
            {m.badge}
          </span>
        </span>
        <span style={{ display: "block", fontSize: 13, color: "var(--color-text-muted)", marginTop: 5, lineHeight: 1.5 }}>{m.desc}</span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, alignSelf: "center", color: arrowColor }}>{arrow}</span>
    </>
  );

  if (m.external && m.href) {
    return (
      <a href={m.href} target="_blank" rel="noopener noreferrer" style={row}>
        {content}
      </a>
    );
  }
  return m.href ? (
    <Link href={m.href} style={row}>
      {content}
    </Link>
  ) : (
    <div style={{ ...row, cursor: "default" }}>{content}</div>
  );
}
