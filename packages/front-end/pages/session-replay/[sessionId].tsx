import React, { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import Player from "rrweb-player";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";

type SessionReplayRow = {
  sessionId: string;
  userId: string;
  startedAt: string;
  durationMs: number;
  eventCount: number;
  urlFirst: string;
};

type SessionResponse = {
  events: eventWithTime[];
  metadata: SessionReplayRow;
};

/**
 * Returns null if the events are playable, or a string explaining what's
 * missing if not. The distinction matters operationally:
 *   - "fewer than 2 events": the recording is just too short
 *   - "no FullSnapshot": chunk 0 is missing from S3 (lost in transport) or
 *     the SDK never captured one (initialized after the page was already
 *     mutating). Without a FullSnapshot rrweb cannot render any DOM.
 *   - "no IncrementalSnapshot": something captured the initial DOM but no
 *     subsequent activity — the recording effectively has nothing to play.
 */
function getReplayBlockReason(events: eventWithTime[]): string | null {
  if (events.length < 2) {
    return `Session has only ${events.length} event(s) — not enough to replay.`;
  }
  const hasFullSnapshot = events.some((e) => e.type === 2);
  const hasIncremental = events.some((e) => e.type === 3);
  if (!hasFullSnapshot) {
    return "Session is missing its FullSnapshot (chunk 0 was likely lost in transport — the recording can't be rendered without the initial DOM).";
  }
  if (!hasIncremental) {
    return "Session has the initial DOM but no subsequent activity to replay.";
  }
  return null;
}

/**
 * Pick a player size that always leaves the controller above the fold.
 *
 * rrweb-player renders at fixed pixel dimensions passed in props (CSS on
 * the container is ignored). The controller bar adds ~80 px below the
 * canvas, so we reserve room for it plus the page chrome (title row,
 * metadata box, padding). Clamp to a sensible range so very tall viewports
 * don't produce an absurdly large player and very short ones don't produce
 * an unusable tiny one.
 */
const PLAYER_CONTROLLER_PX = 80;
const PAGE_CHROME_PX = 320;
const PLAYER_MIN_HEIGHT = 360;
const PLAYER_MAX_HEIGHT = 540;

function computePlayerDims(container: HTMLElement | null): {
  width: number;
  height: number;
} {
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const containerW = container?.clientWidth ?? 1000;
  const availableH = viewportH - PAGE_CHROME_PX - PLAYER_CONTROLLER_PX;
  const height = Math.max(
    PLAYER_MIN_HEIGHT,
    Math.min(PLAYER_MAX_HEIGHT, availableH),
  );
  // Maintain a 16:9 aspect ratio, but never exceed the actual container
  // width — the right-side evaluations panel takes some space.
  const width = Math.min(containerW, Math.round((height * 16) / 9));
  return { width, height };
}

function formatCustomEvent(data: {
  tag: string;
  payload: Record<string, unknown>;
}) {
  if (data.tag === "feature-flag") {
    return `Feature Flag: ${data.payload.id} -> ${JSON.stringify(data.payload.value)}`;
  } else if (data.tag === "experiment") {
    return `Experiment: ${data.payload.id} -> variation ${data.payload.variation}`;
  }
  return "Custom Event";
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function SessionReplayDetailPage() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [metadata, setMetadata] = useState<SessionReplayRow | null>(null);
  const [firstEvent, setFirstEvent] = useState<null | eventWithTime>(null);
  const [customEvents, setCustomEvents] = useState<
    { timestamp: number; formattedMessage: string }[]
  >([]);

  const playerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerInstance = useRef<any>(null);

  const sessionId =
    typeof router.query.sessionId === "string" ? router.query.sessionId : "";

  useEffect(() => {
    return () => {
      playerInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        // Back-end proxies the S3 reads and gzip decompression — keeps
        // replay payloads behind authenticated REST endpoints (no signed
        // URLs in the browser, no CORS exposure on the bucket).
        const response = await apiCall<
          SessionResponse | { status?: number; message?: string }
        >(`/session-replay/${sessionId}`, { method: "GET" });

        if (cancelled) return;

        if (
          !response ||
          !("events" in response) ||
          !Array.isArray(response.events)
        ) {
          const msg =
            response && "message" in response && response.message
              ? response.message
              : "unexpected response shape";
          throw new Error(`/session-replay/${sessionId} failed: ${msg}`);
        }

        setEvents(response.events);
        setMetadata(response.metadata);
      } catch (e) {
        if (cancelled) return;

        console.error("Failed to load session replay", e);
        setError(
          e instanceof Error && e.message
            ? e.message
            : "Failed to load session",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiCall, sessionId]);

  useEffect(() => {
    if (!events || !playerRef.current) {
      setFirstEvent(null);
      return;
    }

    const blockReason = getReplayBlockReason(events);
    if (blockReason) {
      setError(blockReason);
      setFirstEvent(null);
      return;
    }

    setError(null);
    setFirstEvent(events[0]);

    if (playerInstance.current) {
      playerInstance.current = null;
    }
    playerRef.current.innerHTML = "";

    // rrweb-player ignores CSS sizing on its target — we have to pass width
    // and height as props. Default is 1024×576 plus ~80px for the controller,
    // which overflows the viewport on most laptops and forces a scroll to
    // reach the controls. Size to fit available viewport instead.
    const { width: playerWidth, height: playerHeight } = computePlayerDims(
      playerRef.current,
    );

    const player = new Player({
      target: playerRef.current,
      props: {
        events,
        showController: true,
        width: playerWidth,
        height: playerHeight,
      },
    });
    playerInstance.current = player;

    const customEventsList = events
      .filter((e) => e.type === 5)
      .map((e) => ({
        timestamp: e.timestamp,
        formattedMessage: formatCustomEvent(
          e.data as { tag: string; payload: Record<string, unknown> },
        ),
      }));

    setCustomEvents(customEventsList);
  }, [events]);

  const jumpToEvent = (timestamp: number) => {
    const offset = firstEvent?.timestamp || 0;
    if (playerInstance.current) {
      playerInstance.current.goto(timestamp - offset);
    }
  };

  return (
    <div className="pagecontents">
      <Flex justify="between" align="center" mb="3">
        <h1>Session Replay</h1>
        <Button
          variant="outline"
          onClick={() => void router.push("/session-replay")}
        >
          Back to sessions
        </Button>
      </Flex>

      {error && (
        <Box mb="3">
          <Callout status="warning">{error}</Callout>
        </Box>
      )}

      {loading && (
        <Box mb="3">
          <Text color="text-mid">Loading session data...</Text>
        </Box>
      )}

      {metadata && (
        <Box className="box p-4" mb="4">
          <Text weight="semibold">Session {metadata.sessionId} </Text>
          <Text color="text-mid">
            | User: {metadata.userId || "anonymous"} | Started:{" "}
            {new Date(metadata.startedAt).toLocaleString()} | Duration:{" "}
            {formatDuration(metadata.durationMs)} | Events:{" "}
            {metadata.eventCount}
          </Text>
          <Text color="text-mid"> | URL: {metadata.urlFirst || "-"}</Text>
        </Box>
      )}

      {events && (
        <Flex gap="4" mb="4">
          <Box
            className="box"
            style={{ flex: 1, display: "flex", justifyContent: "center" }}
          >
            <div ref={playerRef} />
          </Box>

          <Box
            className="box p-4"
            style={{ minWidth: 320, overflowY: "auto", maxHeight: 500 }}
          >
            <Text size="large" weight="semibold">
              Evaluations
            </Text>
            <ul className="list-unstyled mt-2">
              {customEvents.map((event, index) => (
                <li
                  key={index}
                  className="cursor-pointer mb-2 p-2 border rounded"
                  onClick={() => jumpToEvent(event.timestamp)}
                  style={{ backgroundColor: "#f0f0f0", color: "#333" }}
                >
                  <strong>
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </strong>
                  : {event.formattedMessage}
                </li>
              ))}
            </ul>
          </Box>
        </Flex>
      )}
    </div>
  );
}
