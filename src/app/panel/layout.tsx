import type { Metadata, Viewport } from "next";
import { PanelTabBar } from "@/components/panel/PanelTabBar";
import { VersionPoller } from "@/components/panel/VersionPoller";
import "./panel.css";

/**
 * The kitchen wall panel shell (panel-contract §1–2). A distinct surface from the app: 720×1280,
 * dark-only (the `[data-panel]` scope pins the palette regardless of the app theme), fixed bottom
 * tab bar, no other chrome. Server-rendered; the only client JS is the version poll, tab nav, and
 * the two write handlers. Auth is via the Clerk session in the browser (dev/debug) or the device
 * token on the Pi (the token-cookie delivery is wired at build step 8).
 */
export const metadata: Metadata = { title: "Kitchen Panel" };
export const viewport: Viewport = { width: 720, height: 1280, initialScale: 1, themeColor: "#0a0d0f" };

export default function PanelLayout({ children }: { children: React.ReactNode }) {
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
