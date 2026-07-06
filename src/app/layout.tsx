import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono, Chakra_Petch } from "next/font/google";
import { Nav } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Body copy. Neutral, highly legible at small sizes.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Data / labels / code — problem IDs, ratings, verdict feed, in-copy stats.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display / scoreboard. Squared, technical letterforms with even numerals —
// used for headings, the wordmark, and every live timer or scoreboard figure.
// Consumed via `font-display` / `font-heading` (see globals.css @theme).
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "cph2h — Codeforces Head-to-Head Races",
  description:
    "Race a friend on a Codeforces problem with voice, video, and an Elo ladder.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider afterSignOutUrl="/">
      {/* `dark` is the hero theme; the light palette stays defined for a future
          toggle. Fonts: sans=body, mono=data, chakra=display/scoreboard. */}
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
