import type { FC } from "react";
import { Composition } from "remotion";
import { DEFAULT_FPS, FORMATS, type FormatName } from "./formats";

/** What every piece component receives: which fixed format it is being drawn in. */
export type PieceProps = { format: FormatName };

/**
 * Register a piece's compositions, one per format, named `<slug>-<format>`
 * (docs/infographics.md §7). A variant with `seconds` is a video; without, a one-frame still.
 */
export function pieceCompositions({
  slug,
  component,
  variants,
}: {
  slug: string;
  component: FC<PieceProps>;
  variants: { format: FormatName; seconds?: number; fps?: number }[];
}) {
  return variants.map(({ format, seconds, fps = DEFAULT_FPS }) => (
    <Composition
      key={`${slug}-${format}`}
      id={`${slug}-${format}`}
      component={component}
      width={FORMATS[format].width}
      height={FORMATS[format].height}
      fps={fps}
      durationInFrames={seconds ? Math.round(seconds * fps) : 1}
      defaultProps={{ format }}
    />
  ));
}
