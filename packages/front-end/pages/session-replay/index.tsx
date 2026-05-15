import React, { useEffect, useMemo, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import Player from "rrweb-player";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";

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

type SessionMetadata = {
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
  metadata: SessionMetadata;
};

type EvaluationEntry = {
  timestamp: number;
  kind: "flag" | "exp";
  label: string;
  formattedMessage: string;
};

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const sameDay =
    d.toDateString() === new Date(now).toDateString() && diff < oneDay;
  const yesterday = new Date(now - oneDay).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `Today, ${time}`;
  if (yesterday) return `Yesterday, ${time}`;
  if (diff < 7 * oneDay) {
    const days = Math.floor(diff / oneDay);
    return `${days} day${days === 1 ? "" : "s"} ago, ${time}`;
  }
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function avatarInitial(userId: string): string {
  if (!userId) return "?";
  return userId.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Fetch a single gzip-JSON chunk directly from S3 via its signed URL and
 * decompress it in the browser. Uses the WHATWG `DecompressionStream` API
 * (supported in current Chromium, Firefox, and Safari 16.4+).
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
}): { kind: "flag" | "exp"; label: string; formattedMessage: string } | null {
  if (data.tag === "feature-flag") {
    const id = String(data.payload.id ?? "");
    const value = JSON.stringify(data.payload.value);
    return {
      kind: "flag",
      label: id,
      formattedMessage: `${id} → ${value}`,
    };
  } else if (data.tag === "experiment") {
    const id = String(data.payload.id ?? "");
    const variation = String(data.payload.variation ?? "");
    return {
      kind: "exp",
      label: id,
      formattedMessage: `${id} → variation ${variation}`,
    };
  }
  return null;
}

export default function SessionReplayPage() {
  const router = useRouter();
  const { apiCall } = useAuth();

  // ---- list / filter state -------------------------------------------------
  const [userIdFilter, setUserIdFilter] = useState("");
  const [clientKeyFilter, setClientKeyFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [urlFilter, setUrlFilter] = useState("");

  const page = useMemo(() => {
    const raw = router.query.page;
    const value = parseInt(typeof raw === "string" ? raw : "1", 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, [router.query.page]);

  const selectedSessionId =
    typeof router.query.sessionId === "string" ? router.query.sessionId : "";

  useEffect(() => {
    if (!router.isReady) return;
    setUserIdFilter(
      typeof router.query.userId === "string" ? router.query.userId : "",
    );
    setClientKeyFilter(
      typeof router.query.clientKey === "string" ? router.query.clientKey : "",
    );
    setStateFilter(
      typeof router.query.state === "string" ? router.query.state : "",
    );
    setUrlFilter(typeof router.query.url === "string" ? router.query.url : "");
  }, [router.isReady, router.query]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (typeof router.query.userId === "string" && router.query.userId) {
      params.set("userId", router.query.userId);
    }
    if (typeof router.query.clientKey === "string" && router.query.clientKey) {
      params.set("clientKey", router.query.clientKey);
    }
    if (typeof router.query.state === "string" && router.query.state) {
      params.set("state", router.query.state);
    }
    if (typeof router.query.url === "string" && router.query.url) {
      params.set("url", router.query.url);
    }
    return params.toString();
  }, [
    page,
    router.query.clientKey,
    router.query.state,
    router.query.url,
    router.query.userId,
  ]);

  const { data: sessionsData, error: sessionsError } = useApi<{
    sessions: SessionReplayRow[];
  }>(`/session-replay?${queryString}`);

  const sessions = sessionsData?.sessions ?? [];
  const hasNextPage = sessions.length === 100;

  const updateRouteQuery = (next: {
    userId?: string;
    clientKey?: string;
    state?: string;
    url?: string;
    page: number;
    sessionId?: string;
  }) => {
    const query: Record<string, string> = {
      page: String(next.page),
    };
    if (next.userId) query.userId = next.userId;
    if (next.clientKey) query.clientKey = next.clientKey;
    if (next.state) query.state = next.state;
    if (next.url) query.url = next.url;
    if (next.sessionId) query.sessionId = next.sessionId;
    void router.push(
      {
        pathname: "/session-replay",
        query,
      },
      undefined,
      { shallow: true },
    );
  };

  const applyFilters = () => {
    updateRouteQuery({
      userId: userIdFilter.trim(),
      clientKey: clientKeyFilter.trim(),
      state: stateFilter,
      url: urlFilter.trim(),
      page: 1,
      sessionId: selectedSessionId,
    });
  };

  const clearFilters = () => {
    setUserIdFilter("");
    setClientKeyFilter("");
    setStateFilter("");
    setUrlFilter("");
    updateRouteQuery({ page: 1, sessionId: selectedSessionId });
  };

  const goToPage = (nextPage: number) => {
    updateRouteQuery({
      userId:
        typeof router.query.userId === "string" ? router.query.userId : "",
      clientKey:
        typeof router.query.clientKey === "string"
          ? router.query.clientKey
          : "",
      state: typeof router.query.state === "string" ? router.query.state : "",
      url: typeof router.query.url === "string" ? router.query.url : "",
      page: nextPage,
      sessionId: selectedSessionId,
    });
  };

  const selectSession = (sessionId: string) => {
    updateRouteQuery({
      userId:
        typeof router.query.userId === "string" ? router.query.userId : "",
      clientKey:
        typeof router.query.clientKey === "string"
          ? router.query.clientKey
          : "",
      state: typeof router.query.state === "string" ? router.query.state : "",
      url: typeof router.query.url === "string" ? router.query.url : "",
      page,
      sessionId,
    });
  };

  // ---- active filter chips -------------------------------------------------
  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    if (typeof router.query.userId === "string" && router.query.userId) {
      chips.push({ key: "userId", label: `user: ${router.query.userId}` });
    }
    if (typeof router.query.clientKey === "string" && router.query.clientKey) {
      chips.push({
        key: "clientKey",
        label: `client: ${router.query.clientKey}`,
      });
    }
    if (typeof router.query.state === "string" && router.query.state) {
      chips.push({ key: "state", label: router.query.state });
    }
    if (typeof router.query.url === "string" && router.query.url) {
      chips.push({ key: "url", label: `url: ${router.query.url}` });
    }
    return chips;
  }, [
    router.query.userId,
    router.query.clientKey,
    router.query.state,
    router.query.url,
  ]);

  const removeFilter = (key: string) => {
    const next = {
      userId:
        typeof router.query.userId === "string" ? router.query.userId : "",
      clientKey:
        typeof router.query.clientKey === "string"
          ? router.query.clientKey
          : "",
      state: typeof router.query.state === "string" ? router.query.state : "",
      url: typeof router.query.url === "string" ? router.query.url : "",
    };
    if (key === "userId") {
      next.userId = "";
      setUserIdFilter("");
    }
    if (key === "clientKey") {
      next.clientKey = "";
      setClientKeyFilter("");
    }
    if (key === "state") {
      next.state = "";
      setStateFilter("");
    }
    if (key === "url") {
      next.url = "";
      setUrlFilter("");
    }
    updateRouteQuery({ ...next, page: 1, sessionId: selectedSessionId });
  };

  // ---- player / chunk loading ----------------------------------------------
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [metadata, setMetadata] = useState<SessionMetadata | null>(null);
  const [firstEvent, setFirstEvent] = useState<null | eventWithTime>(null);
  const [evaluations, setEvaluations] = useState<EvaluationEntry[]>([]);
  const [evalTab, setEvalTab] = useState<"all" | "flags" | "exp">("all");

  const playerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerInstance = useRef<any>(null);

  useEffect(() => {
    return () => {
      playerInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setEvents(null);
      setMetadata(null);
      setEvaluations([]);
      setPlayerError(null);
      if (playerRef.current) playerRef.current.innerHTML = "";
      playerInstance.current = null;
      return;
    }
    let cancelled = false;
    setPlayerLoading(true);
    setPlayerError(null);

    const load = async () => {
      try {
        const response = await apiCall<
          SessionChunksResponse | { status?: number; message?: string }
        >(`/session-replay/${selectedSessionId}/chunks`, { method: "GET" });

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

        const chunkEvents = await Promise.all(
          chunks.map((c) => fetchAndDecompressChunk(c.signedUrl)),
        );

        if (cancelled) return;
        setEvents(chunkEvents.flat());
      } catch (e) {
        if (cancelled) return;

        console.error("Failed to load session replay", e);
        setPlayerError(
          e instanceof Error && e.message
            ? e.message
            : "Failed to load session",
        );
      } finally {
        if (!cancelled) setPlayerLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [apiCall, selectedSessionId]);

  useEffect(() => {
    if (!events || !playerRef.current) {
      setFirstEvent(null);
      return;
    }
    if (!canReplay(events)) {
      setPlayerError("Not enough data to replay session.");
      setFirstEvent(null);
      return;
    }

    setPlayerError(null);
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

    const evals: EvaluationEntry[] = events
      .filter((e) => e.type === 5)
      .map((e) => {
        const formatted = formatCustomEvent(
          e.data as { tag: string; payload: Record<string, unknown> },
        );
        if (!formatted) return null;
        return {
          timestamp: e.timestamp,
          ...formatted,
        } as EvaluationEntry;
      })
      .filter((x): x is EvaluationEntry => x !== null);

    setEvaluations(evals);
  }, [events]);

  const jumpToEvent = (timestamp: number) => {
    const offset = firstEvent?.timestamp || 0;
    if (playerInstance.current) {
      playerInstance.current.goto(timestamp - offset);
    }
  };

  const visibleEvaluations = useMemo(() => {
    if (evalTab === "all") return evaluations;
    if (evalTab === "flags")
      return evaluations.filter((e) => e.kind === "flag");
    return evaluations.filter((e) => e.kind === "exp");
  }, [evaluations, evalTab]);

  // ---- render --------------------------------------------------------------
  return (
    <div className="pagecontents">
      <Flex align="center" gap="2" mb="3">
        <Text color="text-mid">Product Analytics</Text>
        <Text color="text-mid">›</Text>
        <Text weight="semibold">Session Replay</Text>
      </Flex>

      <Flex
        gap="3"
        align="stretch"
        style={{ minHeight: "calc(100vh - 180px)" }}
      >
        {/* ----- LEFT: Recorded Sessions ------------------------------------ */}
        <Box
          className="box"
          style={{
            width: 340,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            padding: 16,
          }}
        >
          <Text size="large" weight="semibold">
            Recorded Sessions
          </Text>
          <Text color="text-mid" size="small">
            Select a session to begin playback
          </Text>

          <Box mt="3">
            <Field
              label="User ID"
              placeholder="exact user id"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters();
              }}
              containerStyle={{ marginBottom: 8 }}
            />
            <Field
              label="URL contains"
              placeholder="substring of first URL"
              value={urlFilter}
              onChange={(e) => setUrlFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters();
              }}
              containerStyle={{ marginBottom: 8 }}
            />
            <Flex gap="2" wrap="wrap" align="end">
              <Field
                label="State"
                options={["recording", "finalized", "deleted"]}
                initialOption="All states"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                containerStyle={{ flex: 1, minWidth: 120, marginBottom: 0 }}
              />
              <Field
                label="Client key"
                placeholder="exact client key"
                value={clientKeyFilter}
                onChange={(e) => setClientKeyFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                containerStyle={{ flex: 1, minWidth: 120, marginBottom: 0 }}
              />
            </Flex>
            <Flex gap="2" mt="2" align="center">
              <Button onClick={applyFilters}>Filter</Button>
              <Button variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            </Flex>
            {activeFilters.length > 0 && (
              <Flex gap="1" wrap="wrap" mt="2">
                {activeFilters.map((chip) => (
                  <Box
                    key={chip.key}
                    onClick={() => removeFilter(chip.key)}
                    style={{
                      cursor: "pointer",
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--accent-3)",
                      color: "var(--accent-11)",
                      fontSize: 12,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="Click to remove filter"
                  >
                    {chip.label} <span style={{ opacity: 0.7 }}>×</span>
                  </Box>
                ))}
              </Flex>
            )}
          </Box>

          <Box
            mt="3"
            style={{
              flex: 1,
              overflowY: "auto",
              borderTop: "1px solid var(--slate-a4)",
              paddingTop: 8,
            }}
          >
            {sessionsError && (
              <Callout status="warning">Failed to load sessions</Callout>
            )}
            {!sessionsData && !sessionsError && (
              <Text color="text-mid">Loading sessions…</Text>
            )}
            {sessionsData && sessions.length === 0 && (
              <Text color="text-mid">
                No matching sessions for the current filters.
              </Text>
            )}
            {sessionsData &&
              sessions.map((session) => {
                const isSelected = session.sessionId === selectedSessionId;
                return (
                  <Box
                    key={session.sessionId}
                    onClick={() => selectSession(session.sessionId)}
                    style={{
                      cursor: "pointer",
                      padding: "10px 8px",
                      borderRadius: 6,
                      marginBottom: 4,
                      background: isSelected
                        ? "var(--accent-3)"
                        : "transparent",
                      border: isSelected
                        ? "1px solid var(--accent-7)"
                        : "1px solid transparent",
                    }}
                  >
                    <Flex justify="between" align="center">
                      <Flex gap="2" align="center">
                        <Box
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            background: "var(--accent-4)",
                            color: "var(--accent-11)",
                            fontSize: 11,
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {avatarInitial(session.userId)}
                        </Box>
                        <Text weight="medium">
                          {session.userId || "anonymous"}
                        </Text>
                      </Flex>
                      <Text color="text-mid" size="small">
                        {formatRelative(session.startedAt)}
                      </Text>
                    </Flex>
                    <Text color="text-mid" size="small" as="div">
                      <code style={{ fontSize: 11 }}>
                        ID: {session.sessionId?.slice(0, 18) ?? "unknown"}…
                      </code>
                    </Text>
                    <Flex gap="3" mt="1">
                      <Text color="text-mid" size="small">
                        ⌁ {session.eventCount} events
                      </Text>
                      <Text color="text-mid" size="small">
                        ⏱ {formatDuration(session.durationMs)}
                      </Text>
                    </Flex>
                  </Box>
                );
              })}
          </Box>

          <Flex justify="between" align="center" mt="3">
            <Text color="text-mid" size="small">
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </Text>
            <Flex gap="1">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                ‹
              </Button>
              <Button variant="ghost">{page}</Button>
              <Button
                variant="outline"
                disabled={!hasNextPage}
                onClick={() => goToPage(page + 1)}
              >
                ›
              </Button>
            </Flex>
          </Flex>
        </Box>

        {/* ----- CENTER: Player --------------------------------------------- */}
        <Box
          className="box"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: 16,
            minWidth: 0,
          }}
        >
          {!selectedSessionId && (
            <Flex
              align="center"
              justify="center"
              style={{ flex: 1, minHeight: 400 }}
            >
              <Text color="text-mid">
                Select a session on the left to begin playback.
              </Text>
            </Flex>
          )}

          {selectedSessionId && (
            <>
              <Flex gap="4" wrap="wrap" align="center" mb="3">
                <Flex gap="1" align="center">
                  <Text size="small" color="text-mid">
                    ID:
                  </Text>
                  <Text size="small">
                    <code>
                      {metadata?.sessionId?.slice(0, 12) ??
                        selectedSessionId.slice(0, 12)}
                      …
                    </code>
                  </Text>
                </Flex>
                <Flex gap="1" align="center">
                  <Text size="small" color="text-mid">
                    User:
                  </Text>
                  <Text size="small">{metadata?.userId || "anonymous"}</Text>
                </Flex>
                <Flex gap="1" align="center">
                  <Text size="small" color="text-mid">
                    Started:
                  </Text>
                  <Text size="small">
                    {metadata
                      ? new Date(metadata.startedAt).toLocaleString()
                      : "—"}
                  </Text>
                </Flex>
                <Flex gap="1" align="center">
                  <Text size="small" color="text-mid">
                    Duration:
                  </Text>
                  <Text size="small">
                    {metadata ? formatDuration(metadata.durationMs) : "—"}
                  </Text>
                </Flex>
                <Flex gap="1" align="center">
                  <Text size="small" color="text-mid">
                    Events:
                  </Text>
                  <Text size="small">{metadata?.eventCount ?? "—"}</Text>
                </Flex>
              </Flex>

              {playerError && (
                <Box mb="3">
                  <Callout status="warning">{playerError}</Callout>
                </Box>
              )}
              {playerLoading && !playerError && (
                <Box mb="3">
                  <Text color="text-mid">Loading session data…</Text>
                </Box>
              )}

              <Box
                style={{
                  flex: 1,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  minHeight: 400,
                }}
              >
                <div ref={playerRef} />
              </Box>
            </>
          )}
        </Box>

        {/* ----- RIGHT: Evaluations ----------------------------------------- */}
        <Box
          className="box"
          style={{
            width: 300,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            padding: 16,
          }}
        >
          <Flex justify="between" align="center" mb="2">
            <Text size="large" weight="semibold">
              Evaluations
            </Text>
            <Tabs
              value={evalTab}
              onValueChange={(v) =>
                setEvalTab((v as "all" | "flags" | "exp") || "all")
              }
            >
              <TabsList size="1">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="flags">Flags</TabsTrigger>
                <TabsTrigger value="exp">Exp</TabsTrigger>
              </TabsList>
            </Tabs>
          </Flex>

          <Box style={{ flex: 1, overflowY: "auto" }}>
            {!selectedSessionId && (
              <Text color="text-mid" size="small">
                Evaluations will appear here once a session is loaded.
              </Text>
            )}
            {selectedSessionId && events && visibleEvaluations.length === 0 && (
              <Text color="text-mid" size="small">
                No evaluations recorded for this session.
              </Text>
            )}
            {visibleEvaluations.map((evt, index) => (
              <Box
                key={index}
                onClick={() => jumpToEvent(evt.timestamp)}
                style={{
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: 6,
                  marginBottom: 6,
                  border: "1px solid var(--slate-a4)",
                }}
              >
                <Flex justify="between" align="center">
                  <Text size="small" weight="medium">
                    {evt.formattedMessage}
                  </Text>
                  <Box
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--accent-3)",
                      color: "var(--accent-11)",
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                    }}
                  >
                    {evt.kind === "flag" ? "Flag" : "Exp"}
                  </Box>
                </Flex>
                <Text color="text-mid" size="small">
                  {new Date(evt.timestamp).toLocaleString()}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Flex>
    </div>
  );
}
