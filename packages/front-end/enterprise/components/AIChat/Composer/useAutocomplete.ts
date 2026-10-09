import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { completePrefix } from "shared/ai-chat";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefaultDataSourceId } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const DEBOUNCE_MS = 300;
// "I want" says little; three words is about where a continuation stops being a guess.
const MIN_WORDS = 3;
const RETRY_AFTER_ERROR_MS = 60_000;
// Nothing about the request will change by retrying: feature off, no access, bad input.
const FATAL_STATUSES = new Set([400, 401, 403, 404]);

export type SuggestionSource =
  | "model"
  | "assistant-options"
  | "starter-prompts";

export interface Suggestion {
  /** The draft the completion was generated for. */
  base: string;
  completion: string;
  source?: SuggestionSource;
  /** Conversation, page and datasource it was generated for; any change makes it stale. */
  scope?: string;
}

// Options nobody would send as a reply.
const GENERIC_OPTION = /^(something|anything|none|other|not sure|no\b)/i;
// The agent is asked to tag its pick in plain-text lists.
const RECOMMENDED = /\s*\(recommended\)\s*/i;

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;

/**
 * When the assistant asks the user to choose from a list, the likeliest reply
 * is one of the items, word for word — no model call needed. A list only
 * counts as choices when the agent tagged one "(recommended)" or the line
 * introducing it asks a question; bulleted results and summaries don't.
 * The tag wins; otherwise the first option, since the agent orders by likelihood.
 */
export function suggestedReplyFromOptions(
  assistantText: string,
): string | undefined {
  const lines = assistantText.split("\n");
  const firstItem = lines.findIndex((l) => LIST_ITEM.test(l));
  if (firstItem < 0) return undefined;
  const options = lines
    .map((l) => l.match(LIST_ITEM)?.[1])
    .filter(
      (o): o is string =>
        !!o && !GENERIC_OPTION.test(o.replace(RECOMMENDED, "").trim()),
    );
  if (!options.length) return undefined;
  const marked = options.find((o) => RECOMMENDED.test(o));
  if (marked)
    return marked.replace(RECOMMENDED, " ").replace(/\?+$/, "").trim();
  // Untagged: the list is only a choice if it was introduced with a question.
  const intro = lines
    .slice(0, firstItem)
    .reverse()
    .find((l) => l.trim());
  if (!intro?.includes("?")) return undefined;
  // A reply answers the question, so it doesn't end in one.
  return options[0].replace(/\?+$/, "").trim();
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
  suggestedReply,
  quickSuggestions,
}: {
  text: string;
  enabled: boolean;
  conversationId?: string;
  /** Canned prompts to complete against before asking the model (empty chat). */
  quickSuggestions?: readonly string[];
  /**
   * A whole reply to offer in an empty draft, taken from the assistant's last
   * message (see `suggestedReplyFromOptions`); `key` is that message's id.
   */
  suggestedReply?: { key: string; text: string };
}): { ghost: string; accept: () => void; dismiss: () => void } {
  const { apiCall } = useAuth();
  // The same hints the chat request sends: the page, so "this experiment"
  // resolves to the one on screen, and the active PA datasource to scope metrics.
  const currentPage = useRouter().asPath.slice(0, 2048);
  // The explorer's data source is a real selection only on PA pages; elsewhere
  // it falls back to the org's first data source and would hide other metrics.
  const explorerDatasourceId = useDefaultDataSourceId();
  const datasourceId = currentPage.startsWith("/product-analytics")
    ? explorerDatasourceId
    : undefined;
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const pausedUntil = useRef(0);
  const stopped = useRef(false);
  const scope = [
    conversationId,
    currentPage,
    datasourceId,
    suggestedReply?.key,
  ].join("|");
  const current = suggestion?.scope === scope ? suggestion : null;
  const ghost = remainingCompletion(text, current);

  useEffect(() => {
    if (!enabled || stopped.current || ghost || text === current?.base) {
      return;
    }
    const suggest = (s: Omit<Suggestion, "scope">) => {
      setSuggestion({ ...s, scope });
      if (s.completion) {
        track("AI Autocomplete Suggested", {
          source: s.source,
          draftLength: s.base.length,
          completionLength: s.completion.length,
        });
      }
    };
    if (!text.trim()) {
      // Nothing typed: offer the assistant's likeliest option, no model call.
      if (suggestedReply?.text) {
        suggest({
          base: "",
          completion: suggestedReply.text,
          source: "assistant-options",
        });
      }
      return;
    }
    // A fresh chat: finish one of the starter prompts for free before asking the model.
    const typed = text.trimStart();
    const quick =
      typed.length >= 2 && quickSuggestions
        ? completePrefix(typed, quickSuggestions)
        : undefined;
    if (quick) {
      suggest({ base: text, completion: quick, source: "starter-prompts" });
      return;
    }
    if (text.trim().split(/\s+/).length < MIN_WORDS) return;
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
        suggest({
          base: text,
          completion: res?.completion ?? "",
          source: "model",
        });
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
    suggestedReply,
    quickSuggestions,
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
        source: current?.source ?? "model",
        draftLength: text.length,
        completionLength: ghost.length,
      });
      setSuggestion({ base: text + ghost, completion: "", scope });
    },
    dismiss: () => setSuggestion({ base: text, completion: "", scope }),
  };
}
