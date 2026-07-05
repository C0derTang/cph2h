"use client";

/**
 * Monaco-based C++ editor (issue #12).
 *
 * Controlled component: the caller owns `value` and receives updates via
 * `onChange`. Monaco is browser-only, so it's loaded with `next/dynamic`
 * (`ssr: false`) — this component itself is also `"use client"` so it can
 * never end up in a server bundle.
 *
 * Draft persistence: when `draftKey` is supplied (e.g. `"race:{id}"`), the
 * current value is debounce-saved to localStorage and restored once on
 * mount (via `onChange`, since the component is controlled). Callers that
 * need an explicit "reset to template" action can grab a ref and call
 * `reset(toTemplate)`, which updates the value and clears any saved draft.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import dynamic from "next/dynamic";
import { buildDraftKey, clearDraft, DRAFT_SAVE_DEBOUNCE_MS, readDraft, writeDraft } from "@/lib/editor/draft";
import { cn } from "@/lib/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

export interface CppEditorHandle {
  /** Set the editor's value to `toTemplate` and discard any saved draft. */
  reset: (toTemplate: string) => void;
}

export interface CppEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** CSS height, e.g. `420` or `"60vh"`. Defaults to filling the parent. */
  height?: number | string;
  /** Draft scope, e.g. `"race:{id}"`. Omit to disable draft persistence. */
  draftKey?: string;
  readOnly?: boolean;
  className?: string;
}

export const CppEditor = forwardRef<CppEditorHandle, CppEditorProps>(
  function CppEditor(
    { value, onChange, height = "100%", draftKey, readOnly = false, className },
    ref,
  ) {
    const storageKey = draftKey ? buildDraftKey(draftKey) : null;
    const restoredKeyRef = useRef<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Keep the latest onChange without re-running the restore effect on every render.
    const onChangeRef = useRef(onChange);
    useEffect(() => {
      onChangeRef.current = onChange;
    });

    // Restore a saved draft once per storage key.
    useEffect(() => {
      if (!storageKey || restoredKeyRef.current === storageKey) return;
      restoredKeyRef.current = storageKey;
      const draft = readDraft(storageKey);
      if (draft != null) onChangeRef.current(draft);
    }, [storageKey]);

    // Debounce-persist edits to localStorage.
    useEffect(() => {
      if (!storageKey) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        writeDraft(storageKey, value);
      }, DRAFT_SAVE_DEBOUNCE_MS);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, [storageKey, value]);

    useImperativeHandle(
      ref,
      () => ({
        reset(toTemplate: string) {
          onChangeRef.current(toTemplate);
          if (storageKey) clearDraft(storageKey);
        },
      }),
      [storageKey],
    );

    return (
      <div className={cn("bg-[#1e1e1e]", className)} style={{ height }}>
        <MonacoEditor
          height="100%"
          language="cpp"
          theme="vs-dark"
          value={value}
          onChange={(next) => onChange(next ?? "")}
          options={{
            readOnly,
            tabSize: 4,
            insertSpaces: true,
            minimap: { enabled: false },
            fontSize: 13,
            fontLigatures: true,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "off",
            renderWhitespace: "selection",
          }}
          loading={<EditorSkeleton />}
        />
      </div>
    );
  },
);

function EditorSkeleton() {
  return (
    <div className="flex h-full min-h-24 items-center justify-center bg-[#1e1e1e] font-mono text-xs text-neutral-400">
      Loading editor…
    </div>
  );
}
