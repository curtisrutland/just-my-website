import { type ReactNode, useEffect, useState } from "react";
import { AbsoluteFill, useDelayRender } from "remotion";
import { FONT, fontsReady } from "./fonts";
import { type Frozen, loadSnapshot } from "./snapshot";
import { dark, type Theme } from "./theme";

/**
 * The root of every composition. It holds the render until the fonts and the piece's snapshot are
 * loaded, then hands the snapshot to the piece, so a piece never renders a frame without its data
 * or in a fallback typeface. It also paints the background and sets the base text style.
 */
export function Stage<T>({
  piece,
  theme = dark,
  children,
}: {
  /** The piece's folder name, e.g. "2026-11-sample-ride". */
  piece: string;
  theme?: Theme;
  children: (data: T, frozen: Frozen<T>) => ReactNode;
}) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender(`Loading fonts and the ${piece} snapshot`));
  const [frozen, setFrozen] = useState<Frozen<T> | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([loadSnapshot<T>(piece), fontsReady()])
      .then(([snapshot]) => {
        if (!current) return;
        setFrozen(snapshot);
        continueRender(handle);
      })
      .catch((cause) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause));
        if (current) setError(failure); // shown in Studio, where a delayed render does not apply
        cancelRender(failure);
      });
    return () => {
      current = false;
    };
  }, [piece, handle, continueRender, cancelRender]);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, color: theme.text, fontFamily: FONT.body }}>
      {error ? <div style={{ padding: 48, fontSize: 28, color: theme.over }}>{error.message}</div> : null}
      {frozen ? children(frozen.data, frozen) : null}
    </AbsoluteFill>
  );
}
