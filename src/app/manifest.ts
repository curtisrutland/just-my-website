import type { MetadataRoute } from "next";

/**
 * Web app manifest (Next metadata route → served at `/manifest.webmanifest`, which `proxy.ts`
 * already excludes from the Clerk matcher so it is reachable unauthenticated — required for the
 * install prompt). Standalone install only; no service worker, so no offline caching of private
 * data. Colors are the dark `--color-bg` (docs/UI-CONTRACT §1); icons are generated from
 * `src/app/icon.svg` by `scripts/build-icons.mjs`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "justmy.website",
    short_name: "justmy",
    description: "A private, single-user personal-data platform.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0d0f",
    theme_color: "#0a0d0f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
