import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next 16 renames `middleware` to `proxy` (runs on the nodejs runtime). The web UI is Clerk-gated
 * in full; the token API (`/api/**`) is token-only and must NEVER sit behind a Clerk session, so
 * it is excluded from the matcher entirely and authenticates itself in each route handler
 * (CONVENTIONS §1/§2).
 */
// `/preview` is the dev-only unauthenticated component preview (the page itself 404s in prod).
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/preview(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on all UI routes; skip the token API, Next internals, and static files.
    "/((?!api|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
