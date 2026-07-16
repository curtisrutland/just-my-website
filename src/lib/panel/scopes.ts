/**
 * Panel credential scopes (panel-contract §3). A device token carries a subset; a Clerk session
 * (the owner in a browser — the no-hardware dev/debug path) is treated as holding all of them.
 *
 *  - panel:read           — the three section GETs + the version poll
 *  - panel:write:shopping — check/uncheck a shopping item from the panel
 *  - panel:write:daytype  — set today's day-type from the panel
 *  - panel:write:recipe   — send-to-panel (the justmy-recipes *service* token only)
 */
export const PANEL_SCOPES = [
  "panel:read",
  "panel:write:shopping",
  "panel:write:daytype",
  "panel:write:recipe",
] as const;

export type PanelScope = (typeof PANEL_SCOPES)[number];

/** The kitchen panel device: read everything, write the two things it's genuinely better at. */
export const KITCHEN_PANEL_SCOPES: PanelScope[] = [
  "panel:read",
  "panel:write:shopping",
  "panel:write:daytype",
];

/** The justmy.recipes server-to-server sender: send-to-panel only, nothing else. */
export const RECIPES_SERVICE_SCOPES: PanelScope[] = ["panel:write:recipe"];

export function isPanelScope(value: string): value is PanelScope {
  return (PANEL_SCOPES as readonly string[]).includes(value);
}
