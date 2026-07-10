import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/leaderboard",
  "/api/leaderboard",
  "/tournament", // public event pitch — logged-out visitors see it, register gates itself
  "/api/cron(.*)", // authenticated via CRON_SECRET bearer token instead
  "/api/stripe/webhook", // Stripe-signature authenticated, not Clerk
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId } = await auth();
  if (!userId) {
    // Anonymous visitors get a 404 rather than a sign-in redirect: protected
    // surfaces simply don't exist for them. Rewriting to a path with no route
    // renders src/app/not-found.tsx; the explicit 404 status makes it a real
    // Not Found (and applies to API routes under the matcher too).
    return NextResponse.rewrite(new URL("/404", req.url), { status: 404 });
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
