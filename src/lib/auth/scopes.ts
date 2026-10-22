/**
 * Device-token scopes (CONVENTIONS §2). Every DB-backed device token (`device_tokens`) carries a
 * subset; a route only accepts one if its handler asks for a scope the token holds.
 *
 * Panel scopes (panel-contract §3) — guard `/api/panel/**`, where a Clerk session (the owner in a
 * browser — the no-hardware dev/debug path) is treated as holding all of them:
 *  - panel:read           — the three section GETs + the version poll
 *  - panel:write:shopping — check/uncheck a shopping item from the panel
 *  - panel:write:recipe   — send-to-panel (the justmy-recipes *service* token only)
 *
 * Module scopes (`docs/ios-app.md` §3.3) — `{module}:{access}`, checked by `requireScope` on exactly
 * the routes allowlisted in `docs/ios-app.md` §3.4. No scope ever grants hard DELETE.
 */
export const PANEL_SCOPES = [
  "panel:read",
  "panel:write:shopping",
  "panel:write:recipe",
] as const;

export type PanelScope = (typeof PANEL_SCOPES)[number];

export const MODULE_SCOPES = [
  "macros:read",
  "weight:read",
  "lifting:read",
  "rides:read",
  "vitals:read",
  "shopping:read",
  "weight:write",
  "shopping:write",
] as const;

export type ModuleScope = (typeof MODULE_SCOPES)[number];

export const DEVICE_SCOPES = [...PANEL_SCOPES, ...MODULE_SCOPES] as const;

export type DeviceScope = PanelScope | ModuleScope;

/** The kitchen panel device: read everything, write the one thing it's genuinely better at. */
export const KITCHEN_PANEL_SCOPES: PanelScope[] = ["panel:read", "panel:write:shopping"];

/** The justmy.recipes server-to-server sender: send-to-panel only, nothing else. */
export const RECIPES_SERVICE_SCOPES: PanelScope[] = ["panel:write:recipe"];

/** The iOS app (v1, `docs/ios-app.md` §6): read every module, log weight, add/check shopping items. */
export const PHONE_SCOPES: ModuleScope[] = [
  "macros:read",
  "weight:read",
  "lifting:read",
  "rides:read",
  "vitals:read",
  "shopping:read",
  "weight:write",
  "shopping:write",
];

export function isPanelScope(value: string): value is PanelScope {
  return (PANEL_SCOPES as readonly string[]).includes(value);
}

export function isDeviceScope(value: string): value is DeviceScope {
  return (DEVICE_SCOPES as readonly string[]).includes(value);
}
