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
// Spreading each SSE chunk over this many ticks keeps the reveal rate steady
// instead of dumping a chunk on arrival and trickling until the next one.
const TYPEWRITER_DRAIN_TICKS = 8;

export function getTypewriterCharsPerTick({
  contentLength,
  revealedLength,
  hasSuccessor,
}: {
  contentLength: number;
  revealedLength: number;
  hasSuccessor: boolean;
}): number {
  const bufferedCharacters = Math.max(contentLength - revealedLength, 0);
  const baseRate = hasSuccessor
    ? TYPEWRITER_FAST_CHARS_PER_TICK
    : TYPEWRITER_CHARS_PER_TICK;

  return Math.min(
    bufferedCharacters,
    Math.max(baseRate, Math.ceil(bufferedCharacters / TYPEWRITER_DRAIN_TICKS)),
  );
}

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

function findClosingBacktickRun(
  content: string,
  openingStart: number,
  delimiterLength: number,
): number | null {
  for (let i = openingStart + delimiterLength; i < content.length; i++) {
    if (content[i] !== "`") continue;

    let runLength = 1;
    while (content[i + runLength] === "`") runLength++;
    if (runLength === delimiterLength) return i + runLength - 1;
    i += runLength - 1;
  }

  return null;
}

/**
 * `destinationStart` is null while the label is still streaming in (no `]`
 * yet, or `]` is the last buffered character so `(` may still follow).
 */
function findMarkdownLinkStarts(
  content: string,
): Array<{ syntaxStart: number; destinationStart: number | null }> {
  const starts: Array<{
    syntaxStart: number;
    destinationStart: number | null;
  }> = [];

  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\\") {
      i++;
      continue;
    }

    const isImage = content[i] === "!" && content[i + 1] === "[";
    if (content[i] !== "[" && !isImage) continue;

    const syntaxStart = i;
    const labelStart = isImage ? i + 1 : i;
    let nestedBrackets = 0;
    let labelClosed = false;

    for (let j = labelStart + 1; j < content.length; j++) {
      if (content[j] === "\\") {
        j++;
        continue;
      }
      if (content[j] === "`") {
        let delimiterLength = 1;
        while (content[j + delimiterLength] === "`") delimiterLength++;

        const closingDelimiterEnd = findClosingBacktickRun(
          content,
          j,
          delimiterLength,
        );
        if (closingDelimiterEnd !== null) {
          j = closingDelimiterEnd;
          continue;
        }
        j += delimiterLength - 1;
        continue;
      }
      if (content[j] === "\n") {
        labelClosed = true;
        break;
      }
      if (content[j] === "[") {
        nestedBrackets++;
        continue;
      }
      if (content[j] !== "]") continue;
      if (nestedBrackets > 0) {
        nestedBrackets--;
        continue;
      }
      labelClosed = true;
      if (j + 1 >= content.length) {
        starts.push({ syntaxStart, destinationStart: null });
      } else if (content[j + 1] === "(") {
        starts.push({ syntaxStart, destinationStart: j + 2 });
        i = j + 1;
      }
      break;
    }

    if (!labelClosed) {
      starts.push({ syntaxStart, destinationStart: null });
    }
  }

  return starts;
}

function isMarkdownLinkIncomplete(
  content: string,
  destinationStart: number | null,
): boolean {
  return (
    destinationStart === null ||
    findClosingLinkParenthesis(content, destinationStart) === null
  );
}

function getIncompleteMarkdownLinkStart(content: string): number | null {
  for (const { syntaxStart, destinationStart } of findMarkdownLinkStarts(
    content,
  )) {
    if (isMarkdownLinkIncomplete(content, destinationStart)) {
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
 * Holds the reveal at `[` until the whole link has streamed in, so neither a
 * half-typed label nor a raw destination is ever shown. An unclosed `[` is
 * treated as a possible link until the character after `]` rules it out.
 */
export function adjustRevealLengthForMarkdownLinks(
  content: string,
  revealedLength: number,
  proposedLength: number,
): number {
  for (const { syntaxStart, destinationStart } of findMarkdownLinkStarts(
    content,
  )) {
    if (syntaxStart >= proposedLength) break;

    if (destinationStart === null) {
      return Math.max(revealedLength, syntaxStart);
    }

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
          const charsPerTick = getTypewriterCharsPerTick({
            contentLength: item.content.length,
            revealedLength: revealed.length,
            hasSuccessor,
          });
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
