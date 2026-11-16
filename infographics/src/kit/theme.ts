/**
 * The site's colour roles, copied from src/app/globals.css (docs/infographics.md §6). Dark is the
 * default; light is for print. If a role changes on the site, change it here too.
 */
export type Theme = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  success: string;
  warning: string;
  over: string;
};

export const dark: Theme = {
  bg: "#0a0d0f",
  surface: "#12171a",
  surfaceRaised: "#1a2127",
  border: "#242d33",
  text: "#e7eef1",
  textMuted: "#68777e",
  accent: "#3ad0d6",
  success: "#4ec97a",
  warning: "#e0a63a",
  over: "#e5533f",
};

export const light: Theme = {
  bg: "#eceff1",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  border: "#d5dde1",
  text: "#111819",
  textMuted: "#5a696f",
  accent: "#0e9aa0",
  success: "#2f9e57",
  warning: "#b07d1c",
  over: "#cc3d2a",
};
