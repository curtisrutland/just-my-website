import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { IBM_Plex_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Font tokens: each `variable` name matches the var referenced by @theme in globals.css, so
// utilities (font-mono/-body/-display) and direct var(--font-…) refs resolve to the loaded family.
const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-space-grotesk", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "justmy.website",
  description: "A private, single-user personal-data platform.",
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
