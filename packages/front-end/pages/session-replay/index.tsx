import React, { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import Player from "rrweb-player";
import { Flex, Box } from "@radix-ui/themes";
import { toast, Toaster } from "sonner";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableRow,
} from "@/ui/Table";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

// JSON-serialized shape of SessionReplayInterface coming from the back-end
// (Date fields arrive as ISO strings over the wire). The canonical type
// lives in `shared/validators/session-replay.ts`; we intentionally re-shape
// it here rather than importing it because front-end can't import `shared`
// types that contain Date instances when they cross the JSON boundary.
type SessionReplayRow = {
  id: string;
  organization: string;
  sessionId: string;
  clientKey: string;
  userId: string;
  storagePrefix: string;
  startedAt: string;
  endedAt: string;
  lastEventAt: string;
  durationMs: number;
  eventCount: number;
  urlFirst: string;
  urlsVisited: string[];
  attributes: Record<string, string>;
  experiments: [string, string][];
  flags: Record<string, string>;
  userAgent: string;
  state: "recording" | "finalized" | "deleted";
  dateCreated: string;
  dateUpdated: string;
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
    return `Feature Flag: ${data.payload.id} → ${JSON.stringify(data.payload.value)}`;
  } else if (data.tag === "experiment") {
    return `Experiment: ${data.payload.id} → variation ${data.payload.variation}`;
  }
  return "Custom Event";
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function SessionReplayPage() {
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [firstEvent, setFirstEvent] = useState<null | eventWithTime>(null);
  const [customEvents, setCustomEvents] = useState<
    { timestamp: number; formattedMessage: string }[]
  >([]);
  const [loadingSession, setLoadingSession] = useState(false);

  const playerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerInstance = useRef<any>(null);

  const { data: sessionsData, error: sessionsError } = useApi<{
    sessions: SessionReplayRow[];
  }>("/api/session-replay");

  const { apiCall } = useAuth();

  const onCustomEvent = (e: {
    data: { tag: string; payload: Record<string, unknown> };
  }) => {
    const { tag, payload } = e.data;
    toast(formatCustomEvent({ tag, payload }));
  };

  const jumpToEvent = (timestamp: number) => {
    const offset = firstEvent?.timestamp || 0;
    if (playerInstance.current) {
      playerInstance.current.goto(timestamp - offset);
    }
  };

  const loadSession = async (sessionId: string) => {
    setLoadingSession(true);
    setError(null);
    try {
      const data = await apiCall<{ events: eventWithTime[] }>(
        `/api/session-replay/${sessionId}`,
        { method: "GET" },
      );
      setEvents(data.events);
    } catch {
      setError("Failed to load session");
    } finally {
      setLoadingSession(false);
    }
  };

  useEffect(() => {
    return () => {
      if (playerInstance.current) {
        playerInstance?.current?.removeEventListener?.(
          "custom-event",
          onCustomEvent,
        );
      }
    };
  }, []);

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
      playerInstance?.current?.removeEventListener?.(
        "custom-event",
        onCustomEvent,
      );
      playerInstance.current = null;
    }
    playerRef.current.innerHTML = "";

    const player = new Player({
      target: playerRef.current,
      props: { events, showController: true },
    });

    playerInstance.current = player;
    player.addEventListener("custom-event", onCustomEvent);

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

  return (
    <div className="pagecontents">
      <h1>Session Replay</h1>

      {error && (
        <Box mb="3">
          <Callout status="warning">{error}</Callout>
        </Box>
      )}

      {/* Player + evaluations sidebar */}
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
            style={{ minWidth: 300, overflowY: "auto", maxHeight: 500 }}
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

      {/* Session list */}
      <Box className="box p-4">
        <Text size="x-large" weight="semibold">
          Recorded Sessions
        </Text>

        {sessionsError && (
          <Box mt="3">
            <Callout status="warning">Failed to load sessions</Callout>
          </Box>
        )}

        {!sessionsData && !sessionsError && (
          <Box mt="3">
            <Text color="text-mid">Loading sessions…</Text>
          </Box>
        )}

        {sessionsData && sessionsData.sessions.length === 0 && (
          <Box mt="3">
            <Text color="text-mid">
              No sessions recorded yet. Embed the SDK with{" "}
              <code>sessionReplayPlugin()</code> to start capturing.
            </Text>
          </Box>
        )}

        {sessionsData && sessionsData.sessions.length > 0 && (
          <Box mt="3">
            <Table>
              <thead>
                <tr>
                  <TableColumnHeader>Session ID</TableColumnHeader>
                  <TableColumnHeader>User</TableColumnHeader>
                  <TableColumnHeader>Started</TableColumnHeader>
                  <TableColumnHeader>Duration</TableColumnHeader>
                  <TableColumnHeader>Events</TableColumnHeader>
                  <TableColumnHeader>URL</TableColumnHeader>
                </tr>
              </thead>
              <TableBody>
                {sessionsData.sessions.map((session) => (
                  <TableRow
                    key={session.sessionId}
                    onClick={() => loadSession(session.sessionId)}
                    style={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <code title={session.sessionId}>
                        {session.sessionId.slice(0, 8)}…
                      </code>
                    </TableCell>
                    <TableCell>
                      {session.userId || <em>anonymous</em>}
                    </TableCell>
                    <TableCell>
                      {new Date(session.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{formatDuration(session.durationMs)}</TableCell>
                    <TableCell>{session.eventCount}</TableCell>
                    <TableCell
                      style={{
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={session.urlFirst}
                    >
                      {session.urlFirst || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {loadingSession && (
          <Box mt="3">
            <Text color="text-mid">Loading session data…</Text>
          </Box>
        )}
      </Box>

      <Toaster richColors />
    </div>
  );
}
