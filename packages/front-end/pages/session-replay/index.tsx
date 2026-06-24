import React, { useEffect, useMemo, useRef, useState } from "react";
import type { eventWithTime } from "@rrweb/types";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import dynamic from "next/dynamic";
import {
  PiCaretDoubleLeft,
  PiCaretDoubleRight,
  PiCopy,
  PiListBullets,
  PiPlus,
  PiX,
} from "react-icons/pi";
import Badge from "@/ui/Badge";
import { AppFeatures } from "@/types/app-features";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import type { RrwebPlayerHandle } from "@/components/SessionReplay/player";
import Custom404 from "@/pages/404";

// rrweb-player accesses `document` at the module level, so it must be
// loaded client-side only to avoid SSR crashes in Next.js.
const RrwebPlayer = dynamic(() => import("@/components/SessionReplay/player"), {
  ssr: false,
});

type SessionReplayRow = {
  id: string;
  clientKey: string;
  userId: string;
  deviceId: string;
  s3Key: string;
  startedAt: string;
  endedAt: string;
  lastEventAt: string;
  durationMs: number;
  eventCount: number;
  errorCount: number;
  urlFirst: string;
  urlsVisited: string[];
  pageTitle: string;
  viewportWidth: number;
  viewportHeight: number;
  attributes: Record<string, string>;
  featureKeys: string[];
  experimentKeys: string[];
  userAgent: string;
  country: string;
  device: string;
  browser: string;
};

type SessionMetadata = {
  id: string;
  organization: string;
  dateCreated: string;
  dateUpdated: string;
  clientKey: string;
  userId: string;
  deviceId: string;
  s3Key: string;
  startedAt: string;
  endedAt: string;
  lastEventAt: string;
  durationMs: number;
  eventCount: number;
  errorCount: number;
  urlFirst: string;
  urlsVisited: string[];
  pageTitle: string;
  viewportWidth: number;
  viewportHeight: number;
  attributes: Record<string, string>;
  featureKeys: string[];
  experimentKeys: string[];
  userAgent: string;
  country: string;
  device: string;
  browser: string;
};

type SessionResponse = {
  events: eventWithTime[];
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
 * Returns null if the events are playable, or a string explaining what's
 * missing. The distinction matters operationally:
 *   - "fewer than 2 events": the recording is just too short.
 *   - "no FullSnapshot": chunk 0 is missing from S3 (lost in transport) or
 *     the SDK never captured one (initialized after the page was already
 *     mutating). Without a FullSnapshot rrweb cannot render any DOM.
 *   - "no IncrementalSnapshot": something captured the initial DOM but
 *     no subsequent activity — effectively nothing to play.
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
  const gb = useGrowthBook<AppFeatures>();
  const sessionReplayEnabled = !!gb?.isOn("session-replays");

  const router = useRouter();
  const { apiCall } = useAuth();

  // ---- list / filter state -------------------------------------------------
  const [userIdFilter, setUserIdFilter] = useState("");
  const [clientKeyFilter, setClientKeyFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [urlFilter, setUrlFilter] = useState("");

  // ---- UI panel state ------------------------------------------------------
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

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

  // Close evaluations panel when no session is selected
  useEffect(() => {
    if (!selectedSessionId) {
      setEvalOpen(false);
    }
  }, [selectedSessionId]);

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

  // Back-end may return duplicate rows for the same session because the
  // ClickHouse table is a plain MergeTree without FINAL dedupe (see comment
  // in services/clickhouse.ts). Keep the most-recent row per id so the list
  // shows each session once and the "selected" highlight only applies to a
  // single card.
  const rawSessions = useMemo(
    () => sessionsData?.sessions ?? [],
    [sessionsData],
  );
  const hasNextPage = rawSessions.length === 100;
  const sessions = useMemo(() => {
    const byId = new Map<string, SessionReplayRow>();
    for (const s of rawSessions) {
      if (!s.id) continue;
      const existing = byId.get(s.id);
      if (
        !existing ||
        new Date(s.startedAt).getTime() > new Date(existing.startedAt).getTime()
      ) {
        byId.set(s.id, s);
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }, [rawSessions]);

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
    if (typeof router.query.url === "string" && router.query.url) {
      chips.push({ key: "url", label: `url: ${router.query.url}` });
    }
    return chips;
  }, [router.query.userId, router.query.clientKey, router.query.url]);

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
    if (key === "url") {
      next.url = "";
      setUrlFilter("");
    }
    updateRouteQuery({ ...next, page: 1, sessionId: selectedSessionId });
  };

  // ---- show tabs (maps to stateFilter) ------------------------------------
  // "All" → no state filter, "Recorded" → finalized, "Live" → recording
  const showTab = useMemo(() => {
    const s = typeof router.query.state === "string" ? router.query.state : "";
    if (s === "finalized") return "recorded";
    if (s === "recording") return "live";
    return "all";
  }, [router.query.state]);

  const handleShowTabChange = (tab: string) => {
    const newState =
      tab === "recorded" ? "finalized" : tab === "live" ? "recording" : "";
    setStateFilter(newState);
    updateRouteQuery({
      userId:
        typeof router.query.userId === "string" ? router.query.userId : "",
      clientKey:
        typeof router.query.clientKey === "string"
          ? router.query.clientKey
          : "",
      state: newState,
      url: typeof router.query.url === "string" ? router.query.url : "",
      page: 1,
      sessionId: selectedSessionId,
    });
  };

  // ---- player / chunk loading ----------------------------------------------
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [metadata, setMetadata] = useState<SessionMetadata | null>(null);
  const [firstEvent, setFirstEvent] = useState<null | eventWithTime>(null);
  const [evaluations, setEvaluations] = useState<EvaluationEntry[]>([]);
  const [evalTab, setEvalTab] = useState<"all" | "flags" | "exp">("all");

  const playerHandle = useRef<RrwebPlayerHandle>(null);

  useEffect(() => {
    if (!selectedSessionId) {
      setEvents(null);
      setMetadata(null);
      setEvaluations([]);
      setFirstEvent(null);
      setPlayerError(null);
      return;
    }
    // Clear previous session's state synchronously before the new fetch
    // returns. Setting events=null unmounts the keyed RrwebPlayer
    // immediately, tearing down the old rrweb Replayer before B's data
    // arrives. Without this clear, the parent re-renders with OLD events
    // but a NEW key and briefly constructs a player around the wrong
    // session.
    setEvents(null);
    setMetadata(null);
    setEvaluations([]);
    setFirstEvent(null);
    let cancelled = false;
    setPlayerLoading(true);
    setPlayerError(null);

    const load = async () => {
      try {
        const response = await apiCall<
          SessionResponse | { status?: number; message?: string }
        >(`/session-replay/${selectedSessionId}`, { method: "GET" });

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
          throw new Error(
            `/session-replay/${selectedSessionId} failed: ${msg}`,
          );
        }

        setMetadata(response.metadata);
        setEvents(response.events);
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
    if (!events) {
      setFirstEvent(null);
      setEvaluations([]);
      return;
    }
    const blockReason = getReplayBlockReason(events);
    if (blockReason) {
      setPlayerError(blockReason);
      setFirstEvent(null);
      setEvaluations([]);
      return;
    }

    setPlayerError(null);
    setFirstEvent(events[0]);

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
    playerHandle.current?.goto(timestamp - offset);
  };

  const visibleEvaluations = useMemo(() => {
    if (evalTab === "all") return evaluations;
    if (evalTab === "flags")
      return evaluations.filter((e) => e.kind === "flag");
    return evaluations.filter((e) => e.kind === "exp");
  }, [evaluations, evalTab]);

  const flagCount = useMemo(
    () => evaluations.filter((e) => e.kind === "flag").length,
    [evaluations],
  );
  const expCount = useMemo(
    () => evaluations.filter((e) => e.kind === "exp").length,
    [evaluations],
  );

  const copySessionId = () => {
    const sessionId = metadata?.id ?? selectedSessionId;
    if (sessionId) void navigator.clipboard.writeText(sessionId);
  };

  if (!sessionReplayEnabled) {
    return <Custom404 />;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        height: "calc(100vh - 72px)",
        minHeight: 520,
        overflow: "hidden",
      }}
    >
      {/* ----- LEFT: Sessions sidebar ------------------------------------- */}
      {leftCollapsed ? (
        // Collapsed state: narrow strip with expand button
        <div
          style={{
            width: 36,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Button
            variant="soft"
            size="xs"
            icon={<PiCaretDoubleRight />}
            aria-label="Expand sessions panel"
            title="Expand sessions panel"
            onClick={() => setLeftCollapsed(false)}
          >
            {""}
          </Button>
        </div>
      ) : (
        // Expanded state: full sessions panel
        <div
          className="box"
          style={{
            width: 310,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            padding: 16,
            minHeight: 0,
            overflow: "hidden",
            marginBottom: 0,
          }}
        >
          {/* Header */}
          <Flex justify="between" align="start">
            <Box>
              <Text size="large" weight="semibold" color="text-high">
                Recorded Sessions
              </Text>
              <Text color="text-mid" size="small" as="div">
                Select a session to begin playback
              </Text>
            </Box>
            <Button
              variant="soft"
              size="xs"
              icon={<PiCaretDoubleLeft />}
              aria-label="Collapse sessions panel"
              title="Collapse sessions panel"
              onClick={() => setLeftCollapsed(true)}
              style={{ flexShrink: 0 }}
            >
              {""}
            </Button>
          </Flex>

          {/* Show tabs */}
          <Flex align="center" gap="2" mt="3">
            <Text size="small" color="text-high" weight="medium">
              Show:
            </Text>
            <Tabs value={showTab} onValueChange={handleShowTabChange}>
              <TabsList size="1">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="recorded">Recorded</TabsTrigger>
                <TabsTrigger value="live">Live</TabsTrigger>
              </TabsList>
            </Tabs>
          </Flex>

          {/* Add filter toggle */}
          <Box mt="2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: "var(--accent-9)",
                fontSize: 13,
              }}
            >
              <PiPlus style={{ fontSize: 14 }} />
              {showFilters ? "Hide filters" : "Add filter"}
            </button>
          </Box>

          {/* Expandable filters */}
          {showFilters && (
            <Box mt="2">
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
              <Field
                label="Client key"
                placeholder="exact client key"
                value={clientKeyFilter}
                onChange={(e) => setClientKeyFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                containerStyle={{ marginBottom: 8 }}
              />
              <Flex gap="2">
                <Button size="xs" onClick={applyFilters}>
                  Apply
                </Button>
                <Button size="xs" variant="ghost" onClick={clearFilters}>
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
          )}

          {/* Session list */}
          <Box
            mt="3"
            style={{
              flex: 1,
              minHeight: 0,
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
                const isSelected =
                  !!selectedSessionId && session.id === selectedSessionId;
                return (
                  <Box
                    key={session.id}
                    onClick={() => selectSession(session.id)}
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
                      <Flex
                        gap="2"
                        align="center"
                        style={{ minWidth: 0, flex: 1 }}
                      >
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
                            flexShrink: 0,
                          }}
                        >
                          {avatarInitial(session.userId)}
                        </Box>
                        <Text weight="medium" color="text-high" truncate={true}>
                          {session.userId || "anonymous"}
                        </Text>
                      </Flex>
                      <Text
                        color="text-low"
                        size="small"
                        whiteSpace="nowrap"
                        ml="2"
                      >
                        {formatRelative(session.startedAt)}
                      </Text>
                    </Flex>
                    <Box style={{ marginTop: 2 }}>
                      <Text size="small">
                        <span
                          style={{
                            fontFamily: "monospace",
                            color: "var(--accent-9)",
                          }}
                        >
                          ID: {session.id?.slice(0, 20) ?? "unknown"}…
                        </span>
                      </Text>
                    </Box>
                    <Flex gap="3" mt="1">
                      <Text color="text-low" size="small">
                        ⌁ {session.eventCount} events
                      </Text>
                      <Text color="text-low" size="small">
                        ⏱ {formatDuration(session.durationMs)}
                      </Text>
                    </Flex>
                  </Box>
                );
              })}
          </Box>

          {/* Pagination */}
          <Flex justify="between" align="center" mt="3">
            <Text color="text-low" size="small">
              {sessions.length} session{sessions.length === 1 ? "" : "s"}{" "}
              matched
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
        </div>
      )}

      {/* ----- CENTER: Player -------------------------------------------- */}
      <div
        className="box"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          marginBottom: 0,
          position: "relative",
        }}
      >
        {/* Session header bar */}
        <Flex
          align="center"
          gap="4"
          wrap="wrap"
          style={{
            padding: "14px 24px 14px 20px",
            borderBottom: "1px solid var(--slate-a5)",
            flexShrink: 0,
          }}
        >
          {selectedSessionId ? (
            <>
              {/* ID + copy */}
              <Flex gap="1" align="center">
                <Text weight="medium" color="text-high">
                  ID:
                </Text>
                <Text color="text-low">
                  <span style={{ fontFamily: "monospace" }}>
                    {(metadata?.id ?? selectedSessionId).slice(0, 16)}…
                  </span>
                </Text>
                <button
                  onClick={copySessionId}
                  title="Copy session ID"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 2,
                    display: "flex",
                    alignItems: "center",
                    color: "var(--slate-a9)",
                  }}
                >
                  <PiCopy style={{ fontSize: 14 }} />
                </button>
              </Flex>
              <Flex gap="1" align="center">
                <Text weight="medium" color="text-high">
                  User
                </Text>
                <Text color="text-low">{metadata?.userId || "anonymous"}</Text>
              </Flex>
              <Flex gap="1" align="center">
                <Text weight="medium" color="text-high">
                  Started
                </Text>
                <Text color="text-low">
                  {metadata
                    ? new Date(metadata.startedAt).toLocaleString()
                    : "—"}
                </Text>
              </Flex>
              <Flex gap="1" align="center">
                <Text weight="medium" color="text-high">
                  Duration
                </Text>
                <Text color="text-low">
                  {metadata ? formatDuration(metadata.durationMs) : "—"}
                </Text>
              </Flex>
              <Flex gap="1" align="center">
                <Text weight="medium" color="text-high">
                  Events
                </Text>
                <Text color="text-low">{metadata?.eventCount ?? "—"}</Text>
              </Flex>
              {/* Evaluations toggle — pushed to far right */}
              <Box style={{ marginLeft: "auto" }}>
                <Button
                  variant={evalOpen ? "soft" : "outline"}
                  size="sm"
                  icon={<PiListBullets />}
                  onClick={() => setEvalOpen(!evalOpen)}
                >
                  <>
                    Evaluations
                    {evaluations.length > 0 && (
                      <Box
                        as="span"
                        style={{
                          marginLeft: 6,
                          background: "var(--violet-a3)",
                          color: "var(--violet-a11)",
                          fontSize: 10,
                          fontWeight: 500,
                          lineHeight: "15px",
                          padding: "0 4px",
                          borderRadius: 2,
                          minWidth: 16,
                          textAlign: "center",
                          display: "inline-block",
                        }}
                      >
                        {evaluations.length}
                      </Box>
                    )}
                  </>
                </Button>
              </Box>
            </>
          ) : (
            <Text color="text-mid">Select a session to view details</Text>
          )}
        </Flex>

        {/* Player area — fills remaining space; player is mounted edge-to-edge */}
        <Box
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Empty / error / loading states: centered inside the container */}
          {(!selectedSessionId || playerLoading || playerError) && (
            <Flex
              align="center"
              justify="center"
              style={{ width: "100%", height: "100%" }}
            >
              {!selectedSessionId && (
                <Text color="text-mid">
                  Select a session on the left to begin playback.
                </Text>
              )}
              {selectedSessionId && playerError && (
                <Box style={{ maxWidth: 480, padding: 16 }}>
                  <Callout status="warning">{playerError}</Callout>
                </Box>
              )}
              {selectedSessionId && playerLoading && !playerError && (
                <Text color="text-mid">Loading session data…</Text>
              )}
            </Flex>
          )}
          {/* Player fills the full container — dimensions measured from container */}
          {events && (
            <RrwebPlayer
              key={selectedSessionId}
              events={events}
              ref={playerHandle}
            />
          )}
        </Box>

        {/* ----- Evaluations overlay — absolute over player --------------- */}
        {evalOpen && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              height: "100%",
              width: 324,
              display: "flex",
              flexDirection: "column",
              background: "var(--color-panel-solid)",
              boxShadow: "-3px 0px 4.4px rgba(0,0,0,0.25)",
              zIndex: 10,
            }}
          >
            {/* Header */}
            <Flex
              align="center"
              justify="between"
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--slate-a3)",
                flexShrink: 0,
              }}
            >
              <Text size="large" weight="semibold" color="text-high">
                Evaluations
              </Text>
              <button
                onClick={() => setEvalOpen(false)}
                title="Close evaluations"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  color: "var(--slate-a9)",
                  padding: 4,
                }}
              >
                <PiX style={{ fontSize: 15 }} />
              </button>
            </Flex>

            {/* Tabs with counts — active: text-high/medium, inactive: text-low/medium */}
            <Box style={{ flexShrink: 0 }}>
              <Tabs
                value={evalTab}
                onValueChange={(v) =>
                  setEvalTab((v as "all" | "flags" | "exp") || "all")
                }
              >
                <TabsList size="2">
                  <TabsTrigger value="all">
                    <Text
                      size="medium"
                      weight="medium"
                      color={evalTab === "all" ? "text-high" : "text-low"}
                    >
                      All ({evaluations.length})
                    </Text>
                  </TabsTrigger>
                  <TabsTrigger value="flags">
                    <Text
                      size="medium"
                      weight="medium"
                      color={evalTab === "flags" ? "text-high" : "text-low"}
                    >
                      Flags ({flagCount})
                    </Text>
                  </TabsTrigger>
                  <TabsTrigger value="exp">
                    <Text
                      size="medium"
                      weight="medium"
                      color={evalTab === "exp" ? "text-high" : "text-low"}
                    >
                      Experiments ({expCount})
                    </Text>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </Box>

            {/* Evaluation rows */}
            <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {selectedSessionId &&
                events &&
                visibleEvaluations.length === 0 && (
                  <Box style={{ padding: "12px 16px" }}>
                    <Text size="small" color="text-low" weight="regular">
                      No evaluations recorded for this session.
                    </Text>
                  </Box>
                )}
              {!events && !playerError && selectedSessionId && (
                <Box style={{ padding: "12px 16px" }}>
                  <Text size="small" color="text-low" weight="regular">
                    Loading evaluations…
                  </Text>
                </Box>
              )}
              {visibleEvaluations.map((evt, index) => (
                <Flex
                  key={index}
                  align="center"
                  justify="between"
                  gap="2"
                  onClick={() => jumpToEvent(evt.timestamp)}
                  style={{
                    padding: "0 16px",
                    height: 49,
                    borderBottom: "1px solid var(--slate-a3)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    {/* 14px semibold text-high — body/medium/semibold */}
                    <Text
                      size="medium"
                      weight="semibold"
                      color="text-high"
                      truncate={true}
                    >
                      {evt.formattedMessage}
                    </Text>
                    {/* 12px regular text-low — body/small/regular */}
                    <Text size="small" weight="regular" color="text-low">
                      {new Date(evt.timestamp).toLocaleString()}
                    </Text>
                  </Box>
                  <Badge
                    label={evt.kind === "flag" ? "Flag" : "Exp"}
                    size="xs"
                    variant="soft"
                    color={evt.kind === "flag" ? "indigo" : "violet"}
                    radius="full"
                    style={{ flexShrink: 0 }}
                  />
                </Flex>
              ))}
            </Box>
          </div>
        )}
      </div>
    </div>
  );
}
