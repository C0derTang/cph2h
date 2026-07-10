import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
// v7's `appearance.theme` takes a prebuilt theme object from `@clerk/ui/themes`
// (verified against the installed @clerk/react@6.11.3 types — the legacy
// `@clerk/themes` package predates the v7 Theme/Variables/Elements appearance
// shape and is NOT the right import here). `@clerk/ui` is pinned to the exact
// version @clerk/react was built against (1.24.0) so the appearance types line up.
import { dark } from "@clerk/ui/themes";
import {
  Geist,
  Geist_Mono,
  Chakra_Petch,
  Sedgwick_Ave_Display,
} from "next/font/google";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { RouteBack } from "@/components/nav/route-back";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Body copy. Neutral, highly legible at small sizes.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Data / labels / code — problem IDs, ratings, verdict feed — and, per the
// numeral rule in docs/design.md, every live-updating number (Chakra Petch's
// digits are not tabular, so timers/countdowns always render in this face).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display / UI face — Chakra Petch, a squared techno-grotesque with a gaming-HUD
// cadence. Powers headings, the game-menu slab rows, slab buttons, the wordmark,
// VS names, and verdict stamps via `font-display` / `font-heading` (see
// globals.css @theme). Multiple weights so the same face carries both quiet UI
// labels (500/600) and loud lockups (700).
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Graffiti face — Sedgwick Ave Display, surfaced as `--font-graffiti` via the
// globals.css @theme map. Reserved for exactly ONE aria-hidden neon hero word
// per screen (the `HeroWord` component / `hero-word` utility) — never UI text,
// never numbers.
const sedgwickAve = Sedgwick_Ave_Display({
  variable: "--font-sedgwick-ave",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "cph2h",
  description:
    "Head-to-head Codeforces battles with voice, video, and a real Elo ladder. Shittalk your way to a higher rating.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      // In-app auth pages, not the hosted Account Portal — without these the
      // card's cross-links ("Sign up" on /sign-in and vice versa) point at
      // accounts.cph2h.com instead of our own routes.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      appearance={{
        // Dark base theme so Clerk's own contrast/state logic starts from the
        // same footing as our stage, then every surface is remapped onto the
        // app's actual design tokens (src/app/globals.css `:root.dark`) below.
        theme: dark,
        variables: {
          // Card/popover fill — the matte HUD plate color (--card).
          colorBackground: "var(--card)",
          colorForeground: "var(--card-foreground)",
          // Acid-yellow CTA / focus / self-identity ink (--primary).
          colorPrimary: "var(--primary)",
          colorPrimaryForeground: "var(--primary-foreground)",
          colorDanger: "var(--destructive)",
          colorNeutral: "var(--muted-foreground)",
          colorMuted: "var(--muted)",
          colorMutedForeground: "var(--muted-foreground)",
          // Inputs — translucent warm fill (--input) with readable foreground.
          colorInput: "var(--input)",
          colorInputForeground: "var(--foreground)",
          // Hairline border + yellow focus ring (--border / --ring).
          colorBorder: "var(--border)",
          colorRing: "var(--ring)",
          colorShadow: "black",
          // Body face — Geist Sans, same as the rest of the app.
          fontFamily: "var(--font-sans)",
          borderRadius: "var(--radius)",
        },
        elements: {
          // The auth card itself: the v4 matte HUD plate, matching the app's
          // `.panel` utility (globals.css) — near-opaque card fill, 1px
          // hairline border, a 2px self-yellow top rule, shallow floor shadow.
          // NO backdrop-filter (the v3 frosted glass is retired).
          card: {
            border: "1px solid var(--border)",
            borderTop: "2px solid var(--player-self)",
            backgroundImage: "none",
            backgroundColor:
              "color-mix(in oklch, var(--card) 98%, transparent)",
            boxShadow: "0 12px 28px -20px rgb(0 0 0 / 0.55)",
          },
          // Display/UI face — Chakra Petch — for the card heading, matching
          // every other headline in the app.
          headerTitle: { fontFamily: "var(--font-heading)" },
        },
      }}
    >
      {/* The dark "glitch ground" is the hero theme; the light "daylight HUD"
          palette stays fully defined for a future toggle. Fonts: sans=body,
          mono=data + live numbers, Chakra Petch=display/UI, Sedgwick Ave
          Display=the one graffiti hero word per screen. */}
      <html
        lang="en"
        className={`dark ${geistSans.variable} ${geistMono.variable} ${chakraPetch.variable} ${sedgwickAve.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          {/* The fixed scanline + film-grain texture behind every screen.
              z-index -1 (set by the utility) keeps all in-flow content
              painting above it without touching the page tree. */}
          <div aria-hidden className="noise-ground" />
          <Nav />
          <RouteBack />
          {children}
          <Footer />
          <Toaster position="bottom-right" richColors closeButton />
        </body>
      </html>
    </ClerkProvider>
  );
}
