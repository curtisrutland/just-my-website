import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { IBM_Plex_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { appleSplashScreens } from "./apple-splash";
import "./globals.css";

// Font tokens: each `variable` name matches the var referenced by @theme in globals.css, so
// utilities (font-mono/-body/-display) and direct var(--font-…) refs resolve to the loaded family.
const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-space-grotesk", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "justmy.website",
  description: "A private, single-user personal-data platform.",
  applicationName: "justmy.website",
  // Standalone install on iOS: capable + a home-screen title; the opaque black status bar sits
  // above the app (no notch underlap, so no safe-area work needed for the fixed shell chrome).
  // `startupImage` is the launch splash (iOS ignores the manifest for this) — the generated
  // per-device set that keeps a cold start from flashing blank. See scripts/build-icons.mjs.
  appleWebApp: { capable: true, title: "justmy", statusBarStyle: "black", startupImage: appleSplashScreens },
};

// The manifest link is injected automatically by the `manifest.ts` file convention.
export const viewport: Viewport = {
  themeColor: "#0a0d0f",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      {/* Dark-mode-first: default data-theme is dark; the theme toggle flips it to "light". */}
      <html
        lang="en"
        data-theme="dark"
        className={`${display.variable} ${body.variable} ${mono.variable}`}
        suppressHydrationWarning
      >
        <body>
          {/* Apply the persisted theme before paint so no page (incl. the landing) flashes the
              default theme or ignores the saved one. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`,
            }}
          />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
