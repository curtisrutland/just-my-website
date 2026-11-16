/**
 * The fixed output sizes (docs/infographics.md §6). A piece picks from this list instead of
 * inventing a size. `scale` multiplies the composed size at render time: the poster is laid out
 * at 1080 × 1440 and rendered at 5×, which is 18 × 24 in at 300 dpi.
 */
export const FORMATS = {
  wide: { width: 1920, height: 1080, scale: 1 },
  tall: { width: 1080, height: 1920, scale: 1 },
  card: { width: 1080, height: 1350, scale: 1 },
  square: { width: 1080, height: 1080, scale: 1 },
  poster: { width: 1080, height: 1440, scale: 5 },
} as const;

export type FormatName = keyof typeof FORMATS;

/** Video is 30 frames per second unless a brief asks for 60. */
export const DEFAULT_FPS = 30;
