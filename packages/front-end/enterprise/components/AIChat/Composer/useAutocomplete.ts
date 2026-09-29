import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";

const DEBOUNCE_MS = 400;
// "I want" says little; three words is about where a continuation stops being a guess.
const MIN_WORDS = 3;
// ponytail: flat back-off after any failure; per-status handling if 429s get common.
const RETRY_AFTER_ERROR_MS = 60_000;

export interface Suggestion {
  /** The draft the completion was generated for. */
  base: string;
  completion: string;
  /** The conversation it was generated in; a suggestion from another one is stale. */
  conversationId?: string;
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
  currentPage,
}: {
  text: string;
  enabled: boolean;
  conversationId?: string;
  /** App path the user is on; lets "this experiment" resolve to a real one. */
  currentPage?: string;
}): { ghost: string; accept: () => void; dismiss: () => void } {
  const { apiCall } = useAuth();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const pausedUntil = useRef(0);
  const current =
    suggestion?.conversationId === conversationId ? suggestion : null;
  const ghost = remainingCompletion(text, current);

  useEffect(() => {
    if (
      !enabled ||
      ghost ||
      text === current?.base ||
      text.trim().split(/\s+/).length < MIN_WORDS
    ) {
      return;
    }
    const ctrl = new AbortController();
    // After a failure, wait out the back-off and then retry the unchanged draft.
    const delay = Math.max(DEBOUNCE_MS, pausedUntil.current - Date.now());
    const timer = setTimeout(async () => {
      try {
        const res = await apiCall<{ completion?: string }>(
          "/agent/autocomplete",
          {
            method: "POST",
            body: JSON.stringify({ text, conversationId, currentPage }),
            signal: ctrl.signal,
          },
        );
        if (!ctrl.signal.aborted) {
          setSuggestion({
            base: text,
            completion: res?.completion ?? "",
            conversationId,
          });
        }
      } catch {
        if (!ctrl.signal.aborted) {
          pausedUntil.current = Date.now() + RETRY_AFTER_ERROR_MS;
        }
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [
    text,
    enabled,
    conversationId,
    currentPage,
    ghost,
    current?.base,
    apiCall,
  ]);

  // Both mark the draft as answered so it isn't refetched until the user types
  // again. After an accept that stops suggestions chaining off each other.
  return {
    ghost,
    accept: () =>
      setSuggestion({ base: text + ghost, completion: "", conversationId }),
    dismiss: () =>
      setSuggestion({ base: text, completion: "", conversationId }),
  };
}
