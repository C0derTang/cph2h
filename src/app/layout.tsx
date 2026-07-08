import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
// v7's `appearance.theme` takes a prebuilt theme object from `@clerk/ui/themes`
// (verified against the installed @clerk/react@6.11.3 types — the legacy
// `@clerk/themes` package predates the v7 Theme/Variables/Elements appearance
// shape and is NOT the right import here). `@clerk/ui` is pinned to the exact
// version @clerk/react was built against (1.24.0) so the appearance types line up.
import { dark } from "@clerk/ui/themes";
import { Geist, Geist_Mono, Chakra_Petch } from "next/font/google";
import { Nav } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Body copy. Neutral, highly legible at small sizes.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Data / labels / code — problem IDs, ratings, verdict feed — and, per the
// numeral rule in docs/design.md, every live-updating number (Bangers digits
// are not tabular, so timers/countdowns fall back to this face).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display / UI face — Chakra Petch, a squared techno-grotesque with a gaming-HUD
// cadence (the neon-glass + tetr.io energy). Powers headings, the game-menu slab
// rows, slab buttons, the wordmark, VS names, and verdict stamps via
// `font-display` / `font-heading` (see globals.css @theme). Multiple weights so
// the same face carries both quiet UI labels (500/600) and loud lockups (700).
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "cph2h — same problem, same clock, catch these bars",
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
      appearance={{
        // Dark base theme so Clerk's own contrast/state logic starts from the
        // same footing as our stage, then every surface is remapped onto the
        // app's actual design tokens (src/app/globals.css `:root.dark`) below.
        theme: dark,
        variables: {
          // Card/popover fill — the frosted glass panel color (--card).
          colorBackground: "var(--card)",
          colorForeground: "var(--card-foreground)",
          // Electric cyan CTA / focus / self-identity ink (--primary).
          colorPrimary: "var(--primary)",
          colorPrimaryForeground: "var(--primary-foreground)",
          colorDanger: "var(--destructive)",
          colorNeutral: "var(--muted-foreground)",
          colorMuted: "var(--muted)",
          colorMutedForeground: "var(--muted-foreground)",
          // Inputs — translucent cool fill (--input) with readable foreground.
          colorInput: "var(--input)",
          colorInputForeground: "var(--foreground)",
          // Hairline translucent border + cyan focus ring (--border / --ring).
          colorBorder: "var(--border)",
          colorRing: "var(--ring)",
          colorShadow: "black",
          // Body face — Geist Sans, same as the rest of the app.
          fontFamily: "var(--font-sans)",
          borderRadius: "var(--radius)",
        },
        elements: {
          // The auth card itself: the same frosted liquid-glass recipe as the
          // app's `.panel` utility (globals.css) — translucent gradient fill,
          // hairline border, specular top edge, backdrop blur, floor shadow —
          // instead of Clerk's flat default card.
          card: {
            border: "1px solid color-mix(in oklch, white 12%, transparent)",
            backgroundImage:
              "linear-gradient(180deg, color-mix(in oklch, var(--card) 78%, transparent), color-mix(in oklch, var(--card) 60%, transparent))",
            backdropFilter: "blur(10px) saturate(1.4)",
            WebkitBackdropFilter: "blur(10px) saturate(1.4)",
            boxShadow:
              "inset 0 1px 0 0 color-mix(in oklch, white 22%, transparent), 0 22px 48px -30px rgb(0 0 0 / 0.75)",
          },
          // Display/UI face — Chakra Petch — for the card heading, matching
          // every other headline in the app.
          headerTitle: { fontFamily: "var(--font-heading)" },
        },
      }}
    >
      {/* The dark "stage" is the hero theme; the light "daytime cypher" palette
          stays fully defined for a future toggle. Fonts: sans=body, mono=data +
          live numbers, Chakra Petch=display/UI. */}
      <html
        lang="en"
        className={`dark ${geistSans.variable} ${geistMono.variable} ${chakraPetch.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <Nav />
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </body>
      </html>
    </ClerkProvider>
  );
}
