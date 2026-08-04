"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { RefreshIcon } from "./RefreshIcon";

/** Pull distance (px, post-resistance) that arms the refresh on release. */
const THRESHOLD = 64;
/** Finger-travel → indicator-travel damping, so the pull feels weighted. */
const RESISTANCE = 0.45;
const MAX_PULL = 96;
/** Indicator height while the refresh transition is in flight. */
const REFRESHING_HEIGHT = 36;

/**
 * Touch pull-to-refresh for the shell's content scroller: pulling down from scrollTop 0 reveals
 * a native-style winding refresh icon; releasing past the threshold re-runs the server-component
 * fetch via router.refresh(). Desktop uses the header RefreshControl.
 *
 * Deliberately a LEAF component — it renders only the indicator strip and attaches native touch
 * listeners to its parent (`main.content`) rather than wrapping the page. Wrapping the RSC
 * `children` here would make this component's state commits interleave with the refresh's RSC
 * swap through the same subtree, which desyncs Next's dev instrumentation (React itself coped,
 * but the dev overlay's tree mirror threw on every pull).
 */
export function PullToRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  // Handler-side mirrors: the listeners are native (bound once), so they read refs, not state.
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    // The strip renders as the first child of the scroller; its parent IS the touch surface.
    const scroller = stripRef.current?.parentElement;
    if (!scroller) return;

    const setPullBoth = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };

    const onStart = (e: TouchEvent) => {
      // Only arm when already scrolled to the top — otherwise it's a normal scroll.
      if (!pendingRef.current && scroller.scrollTop <= 0) {
        startY.current = e.touches[0].clientY;
        setDragging(true);
      }
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const delta = e.touches[0].clientY - startY.current;
      setPullBoth(delta <= 0 || scroller.scrollTop > 0 ? 0 : Math.min(delta * RESISTANCE, MAX_PULL));
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      setDragging(false);
      if (pullRef.current >= THRESHOLD && !pendingRef.current) {
        startTransition(() => router.refresh());
      }
      setPullBoth(0);
    };

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: true });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", onEnd);
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onEnd);
    };
  }, [router, startTransition]);

  const height = pending ? REFRESHING_HEIGHT : pull;
  const armed = pull >= THRESHOLD;

  return (
    <div
      ref={stripRef}
      aria-hidden
      className="ptr-indicator"
      style={{
        height,
        // 1:1 finger tracking while pulling; animate only the release/settle.
        transition: dragging ? "none" : "height 160ms ease-out",
      }}
    >
      {/* Nothing is mounted at rest — the icon exists only mid-gesture or mid-refresh. */}
      {height > 0 && (
        <RefreshIcon
          size={18}
          className={pending ? "refresh-spin" : undefined}
          style={
            pending
              ? { color: "var(--color-accent)" }
              : {
                  // Wind up with the pull; fully wound + accent = armed, native-style.
                  transform: `rotate(${(pull / THRESHOLD) * 270}deg)`,
                  opacity: Math.min(0.35 + (pull / THRESHOLD) * 0.65, 1),
                  color: armed ? "var(--color-accent)" : "var(--color-text-muted)",
                }
          }
        />
      )}
    </div>
  );
}
