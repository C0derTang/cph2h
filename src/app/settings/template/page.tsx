import { FileCode2 } from "lucide-react";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { DEFAULT_CPP_TEMPLATE } from "@/lib/types";
import { TemplateEditor } from "./template-editor";

export default async function TemplateSettingsPage() {
  const { userId: clerkId } = await auth();

  let initialTemplate = DEFAULT_CPP_TEMPLATE;
  // Scope the local draft to the signed-in account (falls back to the Clerk id
  // if the DB row can't be resolved) so a shared browser never leaks one
  // user's in-progress template edits into another's editor.
  let draftScopeId = clerkId ?? "anon";
  if (clerkId) {
    const [user] = await db
      .select({ id: users.id, cppTemplate: users.cppTemplate })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    if (user) {
      initialTemplate = user.cppTemplate;
      draftScopeId = user.id;
    }
  }

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-player-self">$</span> cd ~/cph2h/settings/template
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-player-self/40 bg-player-self/10 text-player-self">
          <FileCode2 className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
            Code template
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Set the boilerplate that&apos;s preloaded into the editor at the
            start of every race.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <TemplateEditor initialTemplate={initialTemplate} userId={draftScopeId} />
      </div>
    </main>
  );
}
