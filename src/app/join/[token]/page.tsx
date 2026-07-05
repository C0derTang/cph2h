import { redirect } from "next/navigation";

/**
 * Compatibility redirect (issue #16). The canonical join route is
 * `/challenge/[token]` — it's what `joinUrl` in `POST /api/races`'s response
 * actually points to (`src/app/api/races/route.ts`, issue #7), and it lives
 * next to `/challenge/new` as the natural pair. This route exists so a
 * `/join/{token}` link also resolves, without duplicating the join flow.
 */
export default async function JoinTokenRedirectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/challenge/${token}`);
}
