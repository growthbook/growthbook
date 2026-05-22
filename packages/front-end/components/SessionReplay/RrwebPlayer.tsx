import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import Player from "rrweb-player";

/**
 * Imperative handle exposed to the parent. Just `goto` for the
 * click-to-jump flow in the evaluations panel — anything more belongs
 * inside the player itself.
 */
export type RrwebPlayerHandle = {
  goto: (timeOffsetMs: number) => void;
};

type Props = {
  events: eventWithTime[];
  /**
   * Optional explicit pixel dimensions. When omitted, the component
   * measures its own container and computes a 16:9 fit within
   * MIN_HEIGHT..MAX_HEIGHT, clamped to the container width. rrweb-player
   * ignores CSS sizing on its target element — width/height MUST be
   * passed to the constructor or it falls back to 1024×576.
   */
  width?: number;
  height?: number;
};

const PLAYER_CONTROLLER_PX = 80;
const PLAYER_MIN_HEIGHT = 320;
const PLAYER_MAX_HEIGHT = 560;

function measurePlayerDims(container: HTMLElement | null): {
  width: number;
  height: number;
} {
  const containerEl = container?.parentElement ?? container;
  const containerW = containerEl?.clientWidth ?? 900;
  const containerH = containerEl?.clientHeight ?? 600;
  const availableH = containerH - PLAYER_CONTROLLER_PX;
  const height = Math.max(
    PLAYER_MIN_HEIGHT,
    Math.min(PLAYER_MAX_HEIGHT, availableH),
  );
  const width = Math.min(containerW, Math.round((height * 16) / 9));
  return { width, height };
}

/**
 * Owns the entire rrweb-player lifecycle. The expectation is that the
 * parent renders this with `key={sessionId}` so React physically
 * unmounts/remounts the host DOM on session switch — that's what makes
 * teardown bulletproof in rrweb-player 2.0.0-alpha.20, where the inner
 * Replayer's destroy() doesn't fully tear down its Timer and mirror.
 * Reusing the same Player instance across sessions leaves zombie state
 * that logs "Looks like your replayer has been destroyed" + "Node with
 * id N not found" against the new session's events.
 *
 * Also silences rrweb's chatty warnings three ways:
 *   1. showWarning:false prop (the documented knob, but the prop
 *      pipeline in this alpha doesn't forward it reliably)
 *   2. logger prop set to a no-op stub (warn/log become drops; errors
 *      still pass through to the real console so genuine failures
 *      aren't hidden)
 *   3. Post-construction write-through to replayer.config — bypasses
 *      any prop-forwarding bugs by setting the exact fields the
 *      Replayer reads at log time.
 *
 * The dev-console noise these suppress isn't actionable for customers:
 *   - "destroyed" warnings are expected aftermath of clean unmount
 *     (rrweb's Timer has rAF callbacks already in flight when the
 *     iframe is detached; they fire one tick later and complain).
 *   - "Node with id N not found" comes from multi-FullSnapshot stitching
 *     in sessions that span a page reload (tracked separately as a
 *     back-end fix).
 */
const RrwebPlayer = forwardRef<RrwebPlayerHandle, Props>(function RrwebPlayer(
  { events, width: explicitWidth, height: explicitHeight },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerInstance = useRef<any>(null);

  useImperativeHandle(
    ref,
    () => ({
      goto: (timeOffsetMs: number) => {
        playerInstance.current?.goto?.(timeOffsetMs);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    // Use explicit dimensions when provided; otherwise self-measure.
    const measured =
      explicitWidth != null && explicitHeight != null
        ? { width: explicitWidth, height: explicitHeight }
        : measurePlayerDims(containerRef.current);

    // No-op logger drops warn/log; errors still go to the real console.
    const silentLogger = {
      warn: () => {},
      log: () => {},
      error: (...args: unknown[]) => console.error(...args),
    };

    const player = new Player({
      target: containerRef.current,
      props: {
        events,
        showController: true,
        width: measured.width,
        height: measured.height,
        showWarning: false,
        logger: silentLogger,
      },
    });
    playerInstance.current = player;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const replayer: any = player.getReplayer?.();
    if (replayer?.config) {
      replayer.config.showWarning = false;
      replayer.config.logger = silentLogger;
    }

    // Three-step teardown: stop the user-facing playhead, destroy the
    // inner Replayer (its Timer, emitter, iframe, mirror), then unmount
    // the Svelte UI. Each in its own try/catch so a throw in one doesn't
    // skip the others. With the parent's keyed-remount pattern this is
    // belt-and-suspenders — React detaches the container div anyway —
    // but a clean explicit teardown stops rrweb's internal timers
    // immediately instead of letting them tick one more time into a
    // detached iframe.
    return () => {
      const inst = playerInstance.current;
      playerInstance.current = null;
      if (!inst) return;
      try {
        inst.pause?.();
      } catch {
        /* keep tearing down */
      }
      try {
        inst.getReplayer?.()?.destroy?.();
      } catch {
        /* keep tearing down */
      }
      try {
        inst.$destroy?.();
      } catch {
        /* keep tearing down */
      }
    };
  }, [events, explicitWidth, explicitHeight]);

  return <div ref={containerRef} />;
});

export default RrwebPlayer;
