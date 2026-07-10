"use client";

import { useLinkStatus } from "next/link";

/**
 * The nav-rail's click affordance. Rendered inside each module `<Link>`, it reads that link's
 * `useLinkStatus().pending` and fades in a dot while the click is in flight — the "your click
 * registered" signal for the brief window before the destination's `loading.tsx` skeleton takes
 * over. Prefetched/instant transitions skip the pending phase, so on those it never flashes.
 *
 * Must be a descendant of a `<Link>` (that's how `useLinkStatus` scopes to it). Fixed-size and
 * opacity-toggled via `.rail-hint`, so it reserves its space and never shifts the label.
 */
export function NavPendingDot() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`rail-hint${pending ? " is-pending" : ""}`} />;
}
