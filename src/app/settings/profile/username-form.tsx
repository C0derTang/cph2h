"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  isUsernameValid,
} from "@/lib/username";

interface UsernameFormProps {
  currentUsername: string;
}

const HELP_TEXT = `${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters. Letters, numbers, spaces, and . _ - in between — no leading/trailing separator, no @.`;

export function UsernameForm({ currentUsername }: UsernameFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState(currentUsername);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmed = username.trim();
  const clientValid = isUsernameValid(trimmed);
  const dirty = trimmed !== currentUsername;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientValid) {
      setError(HELP_TEXT);
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/settings/username", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = (await response.json()) as {
        username?: string;
        error?: string;
      };
      if (!response.ok) {
        const message = data.error ?? "Could not save your display name. Try again.";
        setError(message);
        toast.error(message);
        return;
      }
      setUsername(data.username ?? trimmed);
      setSaved(true);
      toast.success("Display name updated.");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="username"
          className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
        >
          Display name
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="off"
          required
          minLength={MIN_USERNAME_LENGTH}
          maxLength={MAX_USERNAME_LENGTH}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError(null);
            setSaved(false);
          }}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">{HELP_TEXT}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {saved && !error && (
        <p className="flex items-center gap-1.5 text-sm text-verdict-ok">
          <CheckCircle2 className="size-4" aria-hidden />
          Saved.
        </p>
      )}

      <div>
        <Button
          type="submit"
          size="sm"
          disabled={saving || !dirty || !clientValid}
          data-testid="save-username-btn"
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
