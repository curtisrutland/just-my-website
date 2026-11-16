import plexSans from "../../../src/app/fonts/IBMPlexSans-latin.woff2";
import jetBrainsMono from "../../../src/app/fonts/JetBrainsMono-latin.woff2";
import spaceGrotesk from "../../../src/app/fonts/SpaceGrotesk-latin.woff2";

/**
 * The site's three typefaces, loaded from src/app/fonts/ rather than copied
 * (docs/infographics.md §6). Each file is a variable font; the weight ranges are the ones
 * src/app/layout.tsx declares.
 */
export const FONT = {
  display: "Space Grotesk",
  body: "IBM Plex Sans",
  mono: "JetBrains Mono",
} as const;

const faces: [family: string, url: string, weight: string][] = [
  [FONT.display, spaceGrotesk, "500 700"],
  [FONT.body, plexSans, "400 600"],
  [FONT.mono, jetBrainsMono, "400 700"],
];

let ready: Promise<void> | null = null;

/** Resolves once all three fonts are usable. Stage waits on it, so no frame renders in a fallback face. */
export function fontsReady(): Promise<void> {
  ready ??= Promise.all(
    faces.map(async ([family, url, weight]) => {
      const face = new FontFace(family, `url("${url}") format("woff2")`, { weight });
      document.fonts.add(await face.load());
    })
  ).then(() => undefined);
  return ready;
}
