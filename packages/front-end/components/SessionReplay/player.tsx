import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import Player from "rrweb-player";

export type RrwebPlayerHandle = {
  goto: (timeOffsetMs: number) => void;
};

type Props = {
  events: eventWithTime[];
};

const PLAYER_CONTROLLER_PX = 80;

function measurePlayerDims(container: HTMLElement | null): {
  width: number;
  height: number;
} {
  const containerEl = container?.parentElement ?? container;
  const containerW = containerEl?.clientWidth ?? 900;
  const containerH = containerEl?.clientHeight ?? 600;
  const width = Math.max(300, containerW);
  const height = Math.max(200, containerH - PLAYER_CONTROLLER_PX);
  return { width, height };
}

/**
 * Owns the entire rrweb-player lifecycle. The expectation is that the
 * parent renders this with `key={sessionId}` so React physically
 * unmounts/remounts the host DOM on session switch.
 *
 * Silences rrweb's chatty warnings:
 *   1. showWarning:false prop
 *   2. logger prop set to a no-op stub (warn/log become drops; errors
 *      still pass through to the real console)
 *
 * The dev-console noise these suppress isn't actionable for customers:
 *   - "destroyed" warnings are expected aftermath of clean unmount
 *   - "Node with id N not found" comes from multi-FullSnapshot stitching
 *     in sessions that span a page reload
 */
const RrwebPlayer = forwardRef<RrwebPlayerHandle, Props>(function RrwebPlayer(
  { events },
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

    const measured = measurePlayerDims(containerRef.current);

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

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeTarget =
      containerRef.current.parentElement ?? containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const inst = playerInstance.current;
        if (!inst || !containerRef.current) return;
        const { width, height } = measurePlayerDims(containerRef.current);
        try {
          inst.$set?.({ width, height });
        } catch (error) {
          console.debug("Error resizing player:", error);
        }
      }, 50);
    });
    resizeObserver.observe(resizeTarget);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      const inst = playerInstance.current;
      playerInstance.current = null;
      if (!inst) return;
      try {
        inst.pause?.();
      } catch (error) {
        console.debug("Error pausing player on teardown:", error);
      }
      try {
        inst.getReplayer?.()?.destroy?.();
      } catch (error) {
        console.debug("Error destroying replayer on teardown:", error);
      }
      try {
        inst.$destroy?.();
      } catch (error) {
        console.debug("Error destroying player on teardown:", error);
      }
    };
  }, [events]);

  return <div ref={containerRef} />;
});

export default RrwebPlayer;
