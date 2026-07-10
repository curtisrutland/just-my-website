import type { CSSProperties } from "react";

/**
 * A single shimmer block — the primitive the module `loading.tsx` files compose into
 * content skeletons. Kept in the shell kernel because the shape of a loading placeholder
 * is chrome, not module domain; the module-specific *arrangement* lives in each loading.tsx.
 *
 * Sizing is inline so a skeleton can mirror the real element it stands in for (reuse the
 * same grid class around it and the swap-in is shift-free).
 */
export function Skeleton({
  width = "100%",
  height = 12,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}
