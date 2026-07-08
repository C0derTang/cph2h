import { SignIn } from "@clerk/nextjs";
import { HeroWord } from "@/components/hud/hero-word";

// The Clerk card is themed from layout.tsx (matte plate, yellow top rule) —
// this page just supplies the hero word + spotlight (docs/design.md).
export default function Page() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden py-16">
      <div
        aria-hidden
        className="spotlight pointer-events-none absolute inset-0 -z-10"
      />
      <HeroWord
        word="again"
        tone="muted"
        className="pointer-events-none absolute top-8 left-1/2 -z-10 -translate-x-1/2 whitespace-nowrap"
      />
      <SignIn />
    </div>
  );
}
