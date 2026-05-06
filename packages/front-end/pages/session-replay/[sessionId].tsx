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
    setLoading(true);
    setError(null);
    void apiCall<SessionResponse>(`/api/session-replay/${sessionId}`, {
      method: "GET",
    })
      .then((data) => {
        setEvents(data.events);
        setMetadata(data.metadata);
      })
      .catch(() => {
        setError("Failed to load session");
      })
      .finally(() => {
        setLoading(false);
      });
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
          <Text weight="semibold">Session {metadata.sessionId}</Text>
          <Text color="text-mid">
            User: {metadata.userId || "anonymous"} | Started:{" "}
            {new Date(metadata.startedAt).toLocaleString()} | Duration:{" "}
            {formatDuration(metadata.durationMs)} | Events:{" "}
            {metadata.eventCount}
          </Text>
          <Text color="text-mid">URL: {metadata.urlFirst || "-"}</Text>
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
