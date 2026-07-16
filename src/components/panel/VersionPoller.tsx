"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type Versions = { health: number; shopping: number; recipe: number };

function sectionOf(path: string): keyof Versions {
  if (path.includes("/shopping")) return "shopping";
  if (path.includes("/recipe")) return "recipe";
  return "health";
}

/**
 * The version poll (impl §6). Every 60s (only while the display is awake — Page Visibility, which is
 * both a Neon-hours saving and correct behavior) it reads `/api/panel/version`. When the CURRENTLY
 * VISIBLE section's version has moved, it triggers `router.refresh()` — which re-runs only the active
 * screen's server component, so exactly one section's DOM refetches, never all three. Renders nothing.
 */
export function VersionPoller() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const seen = useRef<Versions | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (timer) clearTimeout(timer); // collapse to a single pending timer (visibility can re-enter)
      if (!document.hidden) {
        try {
          const res = await fetch("/api/panel/version", { cache: "no-store" });
          if (res.ok) {
            const v = (await res.json()) as Versions;
            if (seen.current === null) {
              seen.current = v; // baseline — the initial server render is already current
            } else {
              const section = sectionOf(pathRef.current);
              const moved = (v[section] ?? 0) > (seen.current[section] ?? 0);
              seen.current = v;
              if (moved) router.refresh();
            }
          }
        } catch {
          // offline / transient — just wait for the next tick
        }
      }
      if (!stopped) timer = setTimeout(poll, 60_000);
    }

    poll();
    const onVisible = () => {
      if (!document.hidden) poll(); // waking up → check immediately
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
