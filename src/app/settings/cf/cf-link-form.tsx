import { CheckCircle2 } from "lucide-react";
import { SlabButton } from "@/components/menu/slab-button";
import type { OAuthErrorCode } from "@/lib/cf/oauth";

interface CfLinkFormProps {
  linkedHandle: string | null;
  linkedRating: number | null;
  linkedAt: string | null;
  /** `?error=` code from the OAuth callback redirect, if any. */
  error: string | null;
}

/** The OAuth link flow starts with a plain GET navigation to this route. */
const START_HREF = "/api/cf/oauth/start";

/** Friendly copy for each error the callback can redirect back with. */
const ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  oauth_misconfigured:
    "Codeforces linking isn’t configured on this server. Contact the site admin.",
  oauth_denied: "You cancelled the Codeforces authorization. No changes were made.",
  oauth_state: "The link request expired or didn’t match. Please try again.",
  oauth_no_code: "Codeforces didn’t return an authorization code. Please try again.",
  oauth_exchange: "Couldn’t reach Codeforces to complete the link. Try again shortly.",
  oauth_invalid_token: "Couldn’t verify the Codeforces response. Please try again.",
  handle_taken: "That Codeforces handle is already linked to another account.",
  oauth_failed: "Linking failed. Please try again.",
};

function errorMessage(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code as OAuthErrorCode] ?? ERROR_MESSAGES.oauth_failed;
}

export function CfLinkForm({
  linkedHandle,
  linkedRating,
  linkedAt,
  error,
}: CfLinkFormProps) {
  const isLinked = Boolean(linkedHandle);
  const message = errorMessage(error);

  return (
    <div className="flex flex-col gap-6">
      {isLinked && (
        <div className="panel p-5">
          {/* Link state is a permission state, not a judge outcome — neutral
              ink, never verdict tokens (docs/design.md codified rule). */}
          <p className="flex items-center gap-2 font-display text-lg tracking-tight uppercase">
            <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />
            Linked to {linkedHandle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {linkedRating != null ? (
              <>
                Rating{" "}
                <span className="font-mono tabular-nums">{linkedRating}</span>
              </>
            ) : (
              "Rating unavailable"
            )}
            {linkedAt ? (
              <>
                {" · linked "}
                <span className="font-mono">
                  {new Date(linkedAt).toLocaleDateString()}
                </span>
              </>
            ) : null}
          </p>
        </div>
      )}

      <div className="panel bracket-frame flex flex-col gap-4 p-5">
        <p className="text-sm leading-6 text-muted-foreground">
          {isLinked
            ? "Re-link to switch handles or refresh your rating. You’ll approve the connection on Codeforces — no password is ever shared with us."
            : "Sign in with Codeforces to prove you own your handle. You’ll approve the connection on Codeforces and come right back — no password is ever shared with us."}
        </p>

        {message && (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive"
          >
            <span className="warning-glyph mt-0.5" aria-hidden>
              !
            </span>
            {message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SlabButton
            tone="self"
            nativeButton={false}
            render={<a href={START_HREF} />}
            data-testid="cf-oauth-link-btn"
          >
            {isLinked ? "Re-link with Codeforces" : "Link with Codeforces"}
          </SlabButton>
        </div>
      </div>
    </div>
  );
}
