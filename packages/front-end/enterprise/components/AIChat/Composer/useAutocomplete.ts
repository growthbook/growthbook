import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";

const DEBOUNCE_MS = 400;
const MIN_CHARS = 3;
// ponytail: flat back-off after any failure; per-status handling if 429s get common.
const RETRY_AFTER_ERROR_MS = 60_000;

export interface Suggestion {
  /** The draft the completion was generated for. */
  base: string;
  completion: string;
}

/** What's left to show once the user has typed part of the suggestion themselves. */
export function remainingCompletion(
  text: string,
  s: Suggestion | null,
): string {
  if (!s || !s.completion || !text.startsWith(s.base)) return "";
  const full = s.base + s.completion;
  return full.startsWith(text) ? full.slice(text.length) : "";
}

/** Debounced one-shot completion of the draft; `ghost` is the text to append. */
export function useAutocomplete({
  text,
  enabled,
  conversationId,
}: {
  text: string;
  enabled: boolean;
  conversationId?: string;
}): { ghost: string; dismiss: () => void } {
  const { apiCall } = useAuth();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const pausedUntil = useRef(0);
  const ghost = remainingCompletion(text, suggestion);

  useEffect(() => {
    if (
      !enabled ||
      ghost ||
      text === suggestion?.base ||
      text.trim().length < MIN_CHARS ||
      Date.now() < pausedUntil.current
    ) {
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await apiCall<{ completion?: string }>(
          "/agent/autocomplete",
          {
            method: "POST",
            body: JSON.stringify({ text, conversationId }),
            signal: ctrl.signal,
          },
        );
        if (!ctrl.signal.aborted) {
          setSuggestion({ base: text, completion: res?.completion ?? "" });
        }
      } catch {
        if (!ctrl.signal.aborted) {
          pausedUntil.current = Date.now() + RETRY_AFTER_ERROR_MS;
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, enabled, conversationId, ghost, suggestion?.base, apiCall]);

  return {
    ghost,
    // Remember the draft as answered so the same text doesn't refetch.
    dismiss: () => setSuggestion({ base: text, completion: "" }),
  };
}
