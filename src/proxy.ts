import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next 16 renames `middleware` to `proxy` (runs on the nodejs runtime). The web UI is Clerk-gated
 * in full; the token API (`/api/**`) is token-only and must NEVER sit behind a Clerk session, so
 * it is excluded from the matcher entirely and authenticates itself in each route handler
 * (CONVENTIONS §1/§2).
 */
// `/preview` is the dev-only unauthenticated component preview (the page itself 404s in prod).
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/preview(.*)"]);

/**
 * The panel API self-authenticates in each handler (device token OR Clerk session, panel-contract §3).
 * clerkMiddleware must RUN here so the handlers can *read* an optional session via `auth()` — but we
 * never `protect()` it, or a valid device-token request (which carries no Clerk cookie) would be
 * bounced by Clerk before reaching the token check. This is the ONLY part of `/api/**` the middleware
 * touches; the rest of the token API stays fully excluded (CONVENTIONS §1/§2).
 */
const isPanelApi = createRouteMatcher(["/api/panel(.*)"]);
// The panel PAGES self-authenticate too (device-token cookie OR Clerk session, panel-contract §3) —
// the layout does the check + redirect. clerkMiddleware still runs (so `auth()` can read the owner's
// session), but we never force-gate, or the Pi's cookie-only request would be Clerk-bounced.
const isPanelUi = createRouteMatcher(["/panel(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPanelApi(req) || isPanelUi(req)) return; // middleware runs (session readable); no protect()
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on all UI routes; skip the token API, Next internals, and static files.
    "/((?!api|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Panel API only: run middleware so handlers can read an optional Clerk session (never protected).
    "/api/panel/:path*",
  ],
};
