import { auth as clerkAuth } from "@clerk/nextjs/server";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PanelTabBar } from "@/components/panel/PanelTabBar";
import { VersionPoller } from "@/components/panel/VersionPoller";
import { findLiveTokenByRawCached } from "@/lib/panel/tokens";
import "./panel.css";

/**
 * The kitchen wall panel shell (panel-contract §1–2). A distinct surface from the app: 720×1280,
 * dark-only (the `[data-panel]` scope pins the palette regardless of the app theme), fixed bottom
 * tab bar, no other chrome. Server-rendered; the only client JS is the version poll, tab nav, and
 * the two write handlers.
 *
 * `/panel` is excluded from the Clerk force-gate (see `src/proxy.ts`) so it can self-authenticate two
 * ways: the Pi's `panel_token` cookie (set once via `GET /api/panel/session`) OR the owner's Clerk
 * session in a browser (dev/debug). Neither → redirect to sign-in. The cookie check uses the cached
 * lookup so page renders/refreshes stay off Neon in steady state.
 */
export const metadata: Metadata = { title: "Kitchen Panel" };
export const viewport: Viewport = { width: 720, height: 1280, initialScale: 1, themeColor: "#0a0d0f" };

async function requirePanelAccess() {
  const token = (await cookies()).get("panel_token")?.value;
  if (token) {
    const identity = await findLiveTokenByRawCached(token);
    if (identity?.scopes.includes("panel:read")) return; // the Pi, via its device-token cookie
  }
  const { userId } = await clerkAuth();
  if (userId) return; // the owner, in a browser
  redirect("/sign-in?redirect_url=/panel/health");
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  await requirePanelAccess();
  return (
    <div data-panel>
      <div className="p-frame">
        <div className="p-content">{children}</div>
        <PanelTabBar />
      </div>
      <VersionPoller />
    </div>
  );
}
