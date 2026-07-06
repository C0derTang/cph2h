import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono, Anton } from "next/font/google";
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

// Display face — tall condensed poster. Powers hero lockups, the wordmark, VS
// names, and stamps via `font-display` / `font-heading` (see globals.css
// @theme). Single weight (400); it is already a heavy, all-caps letterform.
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: ["400"],
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
    <ClerkProvider afterSignOutUrl="/">
      {/* The dark "stage" is the hero theme; the light "daytime cypher" palette
          stays fully defined for a future toggle. Fonts: sans=body, mono=data +
          live numbers, anton=poster display. */}
      <html
        lang="en"
        className={`dark ${geistSans.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
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
