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
const TYPEWRITER_MIN_CHARS_PER_TICK = 1;
export const TYPEWRITER_INITIAL_CHARS_PER_TICK = 3;
const TYPEWRITER_FAST_CHARS_PER_TICK = 15;
// Longer than typical inter-chunk gaps, so bursty delivery doesn't surge then stall.
const ARRIVAL_RATE_WINDOW_TICKS = 50;
// Ticks of output held back so a gap between chunks doesn't stall the reveal.
const TARGET_BUFFER_TICKS = 17;
const BUFFER_CORRECTION_TICKS = 40;
const MAX_BUFFER_CORRECTION_RATIO = 0.3;
// Past this backlog the estimate is behind; drain it.
const CATCH_UP_BUFFER_TICKS = 100;
const CATCH_UP_DRAIN_TICKS = 8;
const FINISHED_DRAIN_TICKS = 3;

export function updateArrivalRateEstimate(
  previousRate: number,
  arrivedCharacters: number,
): number {
  return (
    previousRate +
    (Math.max(arrivedCharacters, 0) - previousRate) / ARRIVAL_RATE_WINDOW_TICKS
  );
}

/** Fractional; callers accumulate the remainder so 2.5 alternates 2 and 3. */
export function getTypewriterCharsPerTick({
  bufferedCharacters,
  arrivalRate,
  hasSuccessor,
  streamComplete,
}: {
  bufferedCharacters: number;
  arrivalRate: number;
  hasSuccessor: boolean;
  streamComplete: boolean;
}): number {
  const buffered = Math.max(bufferedCharacters, 0);
  if (buffered === 0) return 0;

  const baseRate = Math.max(TYPEWRITER_MIN_CHARS_PER_TICK, arrivalRate);
  const targetBuffer = arrivalRate * TARGET_BUFFER_TICKS;
  const maxCorrection = baseRate * MAX_BUFFER_CORRECTION_RATIO;
  const correction = Math.min(
    maxCorrection,
    Math.max(
      -maxCorrection,
      (buffered - targetBuffer) / BUFFER_CORRECTION_TICKS,
    ),
  );
  let rate = Math.max(TYPEWRITER_MIN_CHARS_PER_TICK, baseRate + correction);

  const catchUpThreshold =
    Math.max(arrivalRate, TYPEWRITER_INITIAL_CHARS_PER_TICK) *
    CATCH_UP_BUFFER_TICKS;
  if (buffered > catchUpThreshold) {
    rate = Math.max(rate, buffered / CATCH_UP_DRAIN_TICKS);
  }

  if (hasSuccessor || streamComplete) {
    rate = Math.max(
      rate,
      TYPEWRITER_FAST_CHARS_PER_TICK,
      buffered / FINISHED_DRAIN_TICKS,
    );
  }

  return Math.min(rate, buffered);
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

/** `destinationStart` stays null until `](` arrives, so a trailing `]` can still be a link. */
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

/** Pause at `[` until the link closes, or the next character rules a link out. */
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

type TypewriterRateState = {
  seenContentLength: number;
  arrivalRate: number;
  fractionalCarry: number;
};

/**
 * Drives the character-by-character reveal animation for active text items.
 * Returns the current `displayedTextMap` and a `clear` function to reset it
 * (call when the active turn ends). `streamCompleteRef` drains whatever is
 * still buffered once no more content will arrive.
 */
export function useTypewriter(
  activeTurnItemsRef: MutableRefObject<ActiveTurnItem[]>,
  pauseIncompleteMarkdownLinks = false,
  streamCompleteRef?: MutableRefObject<boolean>,
): {
  displayedTextMap: Map<string, string>;
  displayedTextMapRef: MutableRefObject<Map<string, string>>;
  clearDisplayedText: () => void;
} {
  const [displayedTextMap, setDisplayedTextMap] = useState<Map<string, string>>(
    new Map(),
  );
  const displayedTextMapRef = useRef<Map<string, string>>(new Map());
  const rateStateRef = useRef<Map<string, TypewriterRateState>>(new Map());

  const clearDisplayedText = useCallback(() => {
    displayedTextMapRef.current = new Map();
    rateStateRef.current = new Map();
    setDisplayedTextMap(new Map());
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const items = activeTurnItemsRef.current;
      const current = displayedTextMapRef.current;
      const rateStates = rateStateRef.current;
      const streamComplete = streamCompleteRef?.current ?? false;
      let changed = false;

      const activeIds = new Set<string>();
      const next = new Map(current);
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        if (item.kind !== "text") continue;
        activeIds.add(item.id);

        const rateState = rateStates.get(item.id) ?? {
          seenContentLength: 0,
          arrivalRate: TYPEWRITER_INITIAL_CHARS_PER_TICK,
          fractionalCarry: 0,
        };
        rateState.arrivalRate = updateArrivalRateEstimate(
          rateState.arrivalRate,
          item.content.length - rateState.seenContentLength,
        );
        rateState.seenContentLength = item.content.length;
        rateStates.set(item.id, rateState);

        const revealed = current.get(item.id) ?? "";
        if (revealed.length < item.content.length) {
          const hasSuccessor = idx < items.length - 1;
          const budget =
            rateState.fractionalCarry +
            getTypewriterCharsPerTick({
              bufferedCharacters: item.content.length - revealed.length,
              arrivalRate: rateState.arrivalRate,
              hasSuccessor,
              streamComplete,
            });
          const charsPerTick = Math.floor(budget);
          rateState.fractionalCarry = budget - charsPerTick;
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

      for (const id of rateStates.keys()) {
        if (!activeIds.has(id)) rateStates.delete(id);
      }

      if (changed) {
        displayedTextMapRef.current = next;
        setDisplayedTextMap(new Map(next));
      }
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeTurnItemsRef, pauseIncompleteMarkdownLinks, streamCompleteRef]);

  return { displayedTextMap, displayedTextMapRef, clearDisplayedText };
}
