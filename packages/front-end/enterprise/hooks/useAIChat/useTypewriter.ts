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
          changed = true;
          const hasSuccessor = idx < items.length - 1;
          const charsPerTick = hasSuccessor
            ? TYPEWRITER_FAST_CHARS_PER_TICK
            : TYPEWRITER_CHARS_PER_TICK;
          const nextLen = Math.min(
            revealed.length + charsPerTick,
            item.content.length,
          );
          next.set(item.id, item.content.slice(0, nextLen));
        }
      }

      if (changed) {
        displayedTextMapRef.current = next;
        setDisplayedTextMap(new Map(next));
      }
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeTurnItemsRef]);

  return { displayedTextMap, displayedTextMapRef, clearDisplayedText };
}
