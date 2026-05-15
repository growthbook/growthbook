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

type SessionChunk = {
  index: number;
  signedUrl: string;
  expiresAt: string;
};

type SessionChunksResponse = {
  chunks: SessionChunk[];
  metadata: SessionReplayRow;
};

/**
 * Fetch a single gzip-JSON chunk directly from S3 via its signed URL and
 * decompress it in the browser. Uses the WHATWG `DecompressionStream` API
 * (supported in current Chromium, Firefox, and Safari 16.4+).
 *
 * No `credentials` — the signed URL is the capability token. Sending cookies
 * would also trigger a CORS preflight that the bucket isn't configured for.
 */
async function fetchAndDecompressChunk(
  signedUrl: string,
): Promise<eventWithTime[]> {
  const resp = await fetch(signedUrl, { credentials: "omit" });
  if (!resp.ok) {
    throw new Error(
      `Chunk fetch failed: HTTP ${resp.status} ${resp.statusText}`,
    );
  }
  if (!resp.body) {
    throw new Error("Chunk fetch returned an empty body");
  }
  const decompressed = resp.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(decompressed).text();
  return JSON.parse(text) as eventWithTime[];
}

function canReplay(events: eventWithTime[]): boolean {
  if (events.length < 2) return false;
  const hasFullSnapshot = events.some((e) => e.type === 2);
  const hasIncremental = events.some((e) => e.type === 3);
  return hasFullSnapshot && hasIncremental;
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
        // Step 1: ask the back-end for the metadata + a list of signed S3
        // URLs (one per chunk). The back-end does auth + chunk enumeration;
        // we never see the raw S3 keys or bucket name.
        //
        // Note: `apiCall` only throws on responses where the JSON body has a
        // `status >= 400` field. Controllers that send `res.status(...).json(
        // {error: ...})` without a body-level `status` field will resolve
        // silently — so we also defensively check the shape here and surface
        // any malformed response as an error.
        const response = await apiCall<
          SessionChunksResponse | { status?: number; message?: string }
        >(`/session-replay/${sessionId}/chunks`, { method: "GET" });

        if (cancelled) return;

        if (
          !response ||
          !("chunks" in response) ||
          !Array.isArray(response.chunks)
        ) {
          const msg =
            response && "message" in response && response.message
              ? response.message
              : "unexpected response shape";
          throw new Error(`/session-replay/.../chunks failed: ${msg}`);
        }

        const { chunks, metadata: meta } = response;
        setMetadata(meta);

        // Step 2: fetch each chunk directly from S3 in parallel and
        // decompress in the browser. Avoids piping replay payloads through
        // the back-end.
        const chunkEvents = await Promise.all(
          chunks.map((c) => fetchAndDecompressChunk(c.signedUrl)),
        );

        if (cancelled) return;
        setEvents(chunkEvents.flat());
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

    if (!canReplay(events)) {
      setError("Not enough data to replay session.");
      setFirstEvent(null);
      return;
    }

    setError(null);
    setFirstEvent(events[0]);

    if (playerInstance.current) {
      playerInstance.current = null;
    }
    playerRef.current.innerHTML = "";

    const player = new Player({
      target: playerRef.current,
      props: { events, showController: true },
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
