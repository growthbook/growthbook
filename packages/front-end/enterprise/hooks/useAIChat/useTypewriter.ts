import {
  useState,
  useEffect,
  useRef,
  useCallback,
  MutableRefObject,
} from "react";
import type { ActiveTurnItem } from "./types";

// ---------------------------------------------------------------------------
// Typewriter constants
// ---------------------------------------------------------------------------

const TYPEWRITER_INTERVAL_MS = 30;
const TYPEWRITER_CHARS_PER_TICK = 3;
const TYPEWRITER_FAST_CHARS_PER_TICK = 15;

function findClosingLinkParenthesis(
  content: string,
  destinationStart: number,
): number | null {
  let nestedParentheses = 0;

  for (let i = destinationStart; i < content.length; i++) {
    if (content[i] === "\\") {
      i++;
      continue;
    }
    if (content[i] === "(") {
      nestedParentheses++;
      continue;
    }
    if (content[i] !== ")") continue;
    if (nestedParentheses === 0) return i;
    nestedParentheses--;
  }

  return null;
}

function getIncompleteMarkdownLinkStart(content: string): number | null {
  const linkStartPattern = /!?\[[^\]\n]*\]\(/g;

  for (const match of content.matchAll(linkStartPattern)) {
    const syntaxStart = match.index;
    const destinationStart = syntaxStart + match[0].length;
    if (findClosingLinkParenthesis(content, destinationStart) === null) {
      return syntaxStart;
    }
  }

  return null;
}

export function isWaitingForMarkdownLink(
  content: string,
  revealedLength: number,
): boolean {
  const linkStart = getIncompleteMarkdownLinkStart(content);
  return linkStart !== null && revealedLength >= linkStart;
}

/**
 * Prevents an incomplete inline Markdown link destination from being exposed
 * while the typewriter waits for its closing parenthesis.
 */
export function adjustRevealLengthForMarkdownLinks(
  content: string,
  revealedLength: number,
  proposedLength: number,
): number {
  const linkStartPattern = /!?\[[^\]\n]*\]\(/g;

  for (const match of content.matchAll(linkStartPattern)) {
    const syntaxStart = match.index;
    if (syntaxStart >= proposedLength) break;

    const destinationStart = syntaxStart + match[0].length;
    const closingParenthesis = findClosingLinkParenthesis(
      content,
      destinationStart,
    );

    if (closingParenthesis === null) {
      return Math.max(revealedLength, syntaxStart);
    }
    if (proposedLength <= closingParenthesis) {
      return closingParenthesis + 1;
    }
  }

  return proposedLength;
}

// ---------------------------------------------------------------------------
// useTypewriter
// ---------------------------------------------------------------------------

/**
 * Drives the character-by-character reveal animation for active text items.
 * Returns the current `displayedTextMap` and a `clear` function to reset it
 * (call when the active turn ends).
 */
export function useTypewriter(
  activeTurnItemsRef: MutableRefObject<ActiveTurnItem[]>,
  pauseIncompleteMarkdownLinks = false,
): {
  displayedTextMap: Map<string, string>;
  displayedTextMapRef: MutableRefObject<Map<string, string>>;
  clearDisplayedText: () => void;
} {
  const [displayedTextMap, setDisplayedTextMap] = useState<Map<string, string>>(
    new Map(),
  );
  const displayedTextMapRef = useRef<Map<string, string>>(new Map());

  const clearDisplayedText = useCallback(() => {
    displayedTextMapRef.current = new Map();
    setDisplayedTextMap(new Map());
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const items = activeTurnItemsRef.current;
      const current = displayedTextMapRef.current;
      let changed = false;

      const next = new Map(current);
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        if (item.kind !== "text") continue;
        const revealed = current.get(item.id) ?? "";
        if (revealed.length < item.content.length) {
          const hasSuccessor = idx < items.length - 1;
          const charsPerTick = hasSuccessor
            ? TYPEWRITER_FAST_CHARS_PER_TICK
            : TYPEWRITER_CHARS_PER_TICK;
          const nextLen = Math.min(
            revealed.length + charsPerTick,
            item.content.length,
          );
          const adjustedNextLen = pauseIncompleteMarkdownLinks
            ? adjustRevealLengthForMarkdownLinks(
                item.content,
                revealed.length,
                nextLen,
              )
            : nextLen;
          if (adjustedNextLen > revealed.length) {
            changed = true;
            next.set(item.id, item.content.slice(0, adjustedNextLen));
          }
        }
      }

      if (changed) {
        displayedTextMapRef.current = next;
        setDisplayedTextMap(new Map(next));
      }
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeTurnItemsRef, pauseIncompleteMarkdownLinks]);

  return { displayedTextMap, displayedTextMapRef, clearDisplayedText };
}
