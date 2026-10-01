import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefaultDataSourceId } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const DEBOUNCE_MS = 300;
// "I want" says little; three words is about where a continuation stops being a guess.
const MIN_WORDS = 3;
const RETRY_AFTER_ERROR_MS = 60_000;
// Nothing about the request will change by retrying: feature off, no access, bad input.
const FATAL_STATUSES = new Set([400, 401, 403, 404]);

export interface Suggestion {
  /** The draft the completion was generated for. */
  base: string;
  completion: string;
  /** Conversation, page and datasource it was generated for; any change makes it stale. */
  scope?: string;
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
  replyTo,
}: {
  text: string;
  enabled: boolean;
  conversationId?: string;
  /**
   * Id of the assistant message awaiting a reply. While set, an empty draft
   * gets a whole suggested reply (the likeliest answer to what was asked).
   */
  replyTo?: string;
}): { ghost: string; accept: () => void; dismiss: () => void } {
  const { apiCall } = useAuth();
  // The same hints the chat request sends: the page, so "this experiment"
  // resolves to the one on screen, and the active PA datasource to scope metrics.
  const currentPage = useRouter().asPath.slice(0, 2048);
  const datasourceId = useDefaultDataSourceId();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const pausedUntil = useRef(0);
  const stopped = useRef(false);
  const scope = [conversationId, currentPage, datasourceId, replyTo].join("|");
  const current = suggestion?.scope === scope ? suggestion : null;
  const ghost = remainingCompletion(text, current);

  useEffect(() => {
    if (
      !enabled ||
      stopped.current ||
      ghost ||
      text === current?.base ||
      (text.trim() ? text.trim().split(/\s+/).length < MIN_WORDS : !replyTo)
    ) {
      return;
    }
    const ctrl = new AbortController();
    // After a failure, wait out the back-off and then retry the unchanged draft.
    const delay = Math.max(DEBOUNCE_MS, pausedUntil.current - Date.now());
    const timer = setTimeout(async () => {
      let handled = false;
      try {
        const res = await apiCall<{ completion?: string }>(
          "/agent/autocomplete",
          {
            method: "POST",
            body: JSON.stringify({
              text,
              conversationId,
              currentPage,
              ...(datasourceId ? { datasourceId } : {}),
            }),
            signal: ctrl.signal,
          },
          (err: { status?: number; retryAfter?: number }) => {
            handled = true;
            if (err.status && FATAL_STATUSES.has(err.status)) {
              stopped.current = true;
            } else {
              // 429 says how long; anything else gets the flat back-off.
              const waitMs =
                err.status === 429 && err.retryAfter
                  ? err.retryAfter * 1000
                  : RETRY_AFTER_ERROR_MS;
              pausedUntil.current = Date.now() + waitMs;
            }
          },
        );
        if (ctrl.signal.aborted) return;
        const completion = res?.completion ?? "";
        setSuggestion({ base: text, completion, scope });
        if (completion) {
          track("AI Autocomplete Suggested", {
            draftLength: text.length,
            completionLength: completion.length,
          });
        }
      } catch {
        // Network failure: the handler never ran.
        if (!handled && !ctrl.signal.aborted) {
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
    datasourceId,
    replyTo,
    scope,
    ghost,
    current?.base,
    apiCall,
  ]);

  // Both mark the draft as answered so it isn't refetched until the user types
  // again. After an accept that stops suggestions chaining off each other.
  return {
    ghost,
    accept: () => {
      track("AI Autocomplete Accepted", {
        draftLength: text.length,
        completionLength: ghost.length,
      });
      setSuggestion({ base: text + ghost, completion: "", scope });
    },
    dismiss: () => setSuggestion({ base: text, completion: "", scope }),
  };
}
