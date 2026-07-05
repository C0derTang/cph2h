import { Link2 } from "lucide-react";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { CfLinkForm } from "./cf-link-form";

export default async function CfSettingsPage() {
  const { userId: clerkId } = await auth();

  let linkedHandle: string | null = null;
  let linkedRating: number | null = null;
  let linkedAt: string | null = null;

  if (clerkId) {
    const [user] = await db
      .select({
        cfHandle: users.cfHandle,
        cfRating: users.cfRating,
        cfLinkedAt: users.cfLinkedAt,
      })
      .from(users)
      .where(eq(users.clerkId, clerkId));
    if (user) {
      linkedHandle = user.cfHandle;
      linkedRating = user.cfRating;
      linkedAt = user.cfLinkedAt ? user.cfLinkedAt.toISOString() : null;
    }
  }

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-primary">$</span> cd ~/cph2h/settings/cf
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-primary">
          <Link2 className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            Codeforces account
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Link your Codeforces handle so we can pull verdicts automatically
            during races and submit your solutions on your behalf.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <CfLinkForm
          linkedHandle={linkedHandle}
          linkedRating={linkedRating}
          linkedAt={linkedAt}
        />
      </div>
    </main>
  );
}
