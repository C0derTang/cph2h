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
  if (clerkId) {
    const [user] = await db
      .select({ cppTemplate: users.cppTemplate })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    if (user) initialTemplate = user.cppTemplate;
  }

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-primary">$</span> cd ~/cph2h/settings/template
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-primary">
          <FileCode2 className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            Code template
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Set the boilerplate that&apos;s preloaded into the editor at the
            start of every race.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <TemplateEditor initialTemplate={initialTemplate} />
      </div>
    </main>
  );
}
