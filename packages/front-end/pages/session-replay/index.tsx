import React, { useEffect, useMemo, useRef, useState } from "react";
import type { eventWithTime } from "@rrweb/types";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import {
  PiCaretDoubleLeft,
  PiCaretDoubleRight,
  PiCopy,
  PiListBullets,
  PiPlus,
  PiX,
} from "react-icons/pi";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import { AppFeatures } from "@/types/app-features";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "@/components/LoadingSpinner";
import RrwebPlayer, {
  RrwebPlayerHandle,
} from "@/components/SessionReplay/player";
import FilterQueryPopover, {
  type FilterCondition,
} from "@/components/SessionReplay/FilterQueryPopover";
import Custom404 from "@/pages/404";

type FeatureEvalItem = {
  featureKey: string;
  timestamp: number;
  result: { value: unknown; experimentKey?: string };
};

type ExperimentEvalItem = {
  key: string;
  timestamp: number;
  name?: string;
  result: { value: unknown; variationId: number; featureId: string | null };
};

type SessionEventItem = {
  eventName: string;
  timestamp: number;
  properties?: Record<string, unknown>;
};

type SessionReplayRow = {
  sessionId: string;
  userId: string;
  startedAt: string;
  durationMs: number;
  eventCount: number;
  state: "recording" | "finalized" | "deleted";
  featureKeys: string[];
  experimentKeys: string[];
};

type SessionMetadata = {
  sessionId: string;
  userId: string;
  startedAt: string;
  durationMs: number;
  eventCount: number;
  urlFirst: string;
  featureEvals?: { items: FeatureEvalItem[] };
  experimentEvals?: { items: ExperimentEvalItem[] };
  sessionEvents?: { items: SessionEventItem[] };
};

type SessionResponse = {
  events: eventWithTime[];
  metadata: SessionMetadata;
};

type EvaluationEntry = {
  timestamp: number;
  kind: "flag" | "exp" | "event";
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

  // ---- UI panel state ------------------------------------------------------
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);

  const page = useMemo(() => {
    const raw = router.query.page;
    const value = parseInt(typeof raw === "string" ? raw : "1", 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, [router.query.page]);

  const selectedSessionId =
    typeof router.query.sessionId === "string" ? router.query.sessionId : "";

  // Close evaluations panel when no session is selected
  useEffect(() => {
    if (!selectedSessionId) {
      setEvalOpen(false);
    }
  }, [selectedSessionId]);

  // Helper: read all active filter params from the current router query
  const getFilterParams = () => {
    const q = router.query;
    const str = (k: string) =>
      typeof q[k] === "string" ? (q[k] as string) : "";
    return {
      userId: str("userId"),
      clientKey: str("clientKey"),
      state: str("state"),
      url: str("url"),
      country: str("country"),
      device: str("device"),
      durationMinSecs: str("durationMinSecs"),
      durationMaxSecs: str("durationMaxSecs"),
      eventCountMin: str("eventCountMin"),
      eventCountMax: str("eventCountMax"),
      featureKey: str("featureKey"),
      experimentKey: str("experimentKey"),
    };
  };

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    const q = router.query;
    const setIfPresent = (k: string) => {
      if (typeof q[k] === "string" && q[k]) params.set(k, q[k] as string);
    };
    setIfPresent("userId");
    setIfPresent("clientKey");
    setIfPresent("state");
    setIfPresent("url");
    setIfPresent("country");
    setIfPresent("device");
    setIfPresent("durationMinSecs");
    setIfPresent("durationMaxSecs");
    setIfPresent("eventCountMin");
    setIfPresent("eventCountMax");
    setIfPresent("featureKey");
    setIfPresent("experimentKey");
    return params.toString();
  }, [page, router.query]);

  const { data: sessionsData, error: sessionsError } = useApi<{
    sessions: SessionReplayRow[];
  }>(`/session-replay?${queryString}`);

  // Back-end may return duplicate rows for the same sessionId because the
  // ClickHouse table is a plain MergeTree without FINAL dedupe (see comment
  // in services/clickhouse.ts). Keep the most-recent row per sessionId so
  // the list shows each session once and the "selected" highlight only
  // applies to a single card.
  const rawSessions = useMemo(
    () => sessionsData?.sessions ?? [],
    [sessionsData],
  );
  const hasNextPage = rawSessions.length === 100;
  const sessions = useMemo(() => {
    const byId = new Map<string, SessionReplayRow>();
    for (const s of rawSessions) {
      if (!s.sessionId) continue;
      const existing = byId.get(s.sessionId);
      if (
        !existing ||
        new Date(s.startedAt).getTime() > new Date(existing.startedAt).getTime()
      ) {
        byId.set(s.sessionId, s);
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
    country?: string;
    device?: string;
    durationMinSecs?: string;
    durationMaxSecs?: string;
    eventCountMin?: string;
    eventCountMax?: string;
    featureKey?: string;
    experimentKey?: string;
    page: number;
    sessionId?: string;
  }) => {
    const query: Record<string, string> = { page: String(next.page) };
    const setIfPresent = (k: keyof typeof next) => {
      const v = next[k];
      if (v && typeof v === "string") query[k] = v;
    };
    setIfPresent("userId");
    setIfPresent("clientKey");
    setIfPresent("state");
    setIfPresent("url");
    setIfPresent("country");
    setIfPresent("device");
    setIfPresent("durationMinSecs");
    setIfPresent("durationMaxSecs");
    setIfPresent("eventCountMin");
    setIfPresent("eventCountMax");
    setIfPresent("featureKey");
    setIfPresent("experimentKey");
    setIfPresent("sessionId");
    void router.push({ pathname: "/session-replay", query }, undefined, {
      shallow: true,
    });
  };

  const handleAddFilter = (condition: FilterCondition) => {
    const next = { ...getFilterParams() };
    const { property, operator, value } = condition;

    if (property === "userId") next.userId = value;
    else if (property === "clientKey") next.clientKey = value;
    else if (property === "state") next.state = value;
    else if (property === "url") next.url = value;
    else if (property === "country") next.country = value;
    else if (property === "device") next.device = value;
    else if (property === "durationMs") {
      const secs = String(Math.max(0, Number(value)));
      if (operator === "equals") {
        next.durationMinSecs = secs;
        next.durationMaxSecs = secs;
      } else if (operator === "gte") {
        next.durationMinSecs = secs;
        next.durationMaxSecs = "";
      } else {
        next.durationMaxSecs = secs;
        next.durationMinSecs = "";
      }
    } else if (property === "eventCount") {
      const count = String(Math.max(0, Number(value)));
      if (operator === "equals") {
        next.eventCountMin = count;
        next.eventCountMax = count;
      } else if (operator === "gte") {
        next.eventCountMin = count;
        next.eventCountMax = "";
      } else {
        next.eventCountMax = count;
        next.eventCountMin = "";
      }
    } else if (property.startsWith("featureKey:")) {
      next.featureKey = property.slice("featureKey:".length);
    } else if (property.startsWith("experimentKey:")) {
      next.experimentKey = property.slice("experimentKey:".length);
    }

    updateRouteQuery({ ...next, page: 1, sessionId: selectedSessionId });
  };

  const clearFilters = () => {
    // Preserve the tab's state filter; only clear the query-builder conditions
    const { state } = getFilterParams();
    updateRouteQuery({ state, page: 1, sessionId: selectedSessionId });
  };

  const goToPage = (nextPage: number) => {
    updateRouteQuery({
      ...getFilterParams(),
      page: nextPage,
      sessionId: selectedSessionId,
    });
  };

  const selectSession = (sessionId: string) => {
    updateRouteQuery({ ...getFilterParams(), page, sessionId });
  };

  // ---- active filter chips -------------------------------------------------
  const activeFilters = useMemo(() => {
    const q = router.query;
    const chips: { key: string; label: string }[] = [];
    const str = (k: string) =>
      typeof q[k] === "string" ? (q[k] as string) : "";

    if (str("userId"))
      chips.push({ key: "userId", label: `User ID: ${str("userId")}` });
    if (str("clientKey"))
      chips.push({
        key: "clientKey",
        label: `Client key: ${str("clientKey")}`,
      });
    if (str("url"))
      chips.push({ key: "url", label: `URL contains ${str("url")}` });
    if (str("country"))
      chips.push({ key: "country", label: `Country: ${str("country")}` });
    if (str("device"))
      chips.push({ key: "device", label: `Device: ${str("device")}` });
    if (
      str("durationMinSecs") &&
      str("durationMinSecs") === str("durationMaxSecs")
    ) {
      chips.push({
        key: "durationEq",
        label: `Duration = ${str("durationMinSecs")}s`,
      });
    } else {
      if (str("durationMinSecs"))
        chips.push({
          key: "durationMin",
          label: `Duration ≥ ${str("durationMinSecs")}s`,
        });
      if (str("durationMaxSecs"))
        chips.push({
          key: "durationMax",
          label: `Duration ≤ ${str("durationMaxSecs")}s`,
        });
    }
    if (str("eventCountMin") && str("eventCountMin") === str("eventCountMax")) {
      chips.push({
        key: "eventCountEq",
        label: `Events = ${str("eventCountMin")}`,
      });
    } else {
      if (str("eventCountMin"))
        chips.push({
          key: "eventCountMin",
          label: `Events ≥ ${str("eventCountMin")}`,
        });
      if (str("eventCountMax"))
        chips.push({
          key: "eventCountMax",
          label: `Events ≤ ${str("eventCountMax")}`,
        });
    }
    if (str("featureKey"))
      chips.push({ key: "featureKey", label: `Flag: ${str("featureKey")}` });
    if (str("experimentKey"))
      chips.push({
        key: "experimentKey",
        label: `Experiment: ${str("experimentKey")}`,
      });
    return chips;
  }, [router.query]);

  const removeFilter = (key: string) => {
    const next = { ...getFilterParams() };
    if (key === "userId") next.userId = "";
    else if (key === "clientKey") next.clientKey = "";
    else if (key === "url") next.url = "";
    else if (key === "country") next.country = "";
    else if (key === "device") next.device = "";
    else if (key === "durationMin") next.durationMinSecs = "";
    else if (key === "durationMax") next.durationMaxSecs = "";
    else if (key === "durationEq") {
      next.durationMinSecs = "";
      next.durationMaxSecs = "";
    } else if (key === "eventCountMin") next.eventCountMin = "";
    else if (key === "eventCountMax") next.eventCountMax = "";
    else if (key === "eventCountEq") {
      next.eventCountMin = "";
      next.eventCountMax = "";
    } else if (key === "featureKey") next.featureKey = "";
    else if (key === "experimentKey") next.experimentKey = "";
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
    updateRouteQuery({
      ...getFilterParams(),
      state: newState,
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
  const [evalTab, setEvalTab] = useState<"all" | "flags" | "exp" | "events">(
    "all",
  );

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

    // Prefer structured featureEvals/experimentEvals from session metadata
    // (populated by newer SDK versions). Fall back to parsing legacy rrweb
    // custom events (type 5) for older sessions that don't have them.
    const featureItems = metadata?.featureEvals?.items ?? [];
    const experimentItems = metadata?.experimentEvals?.items ?? [];
    const sessionEventItems = metadata?.sessionEvents?.items ?? [];
    const hasStructuredEvals =
      featureItems.length > 0 ||
      experimentItems.length > 0 ||
      sessionEventItems.length > 0;

    if (hasStructuredEvals) {
      const flagEvals: EvaluationEntry[] = featureItems.map((item) => ({
        timestamp: Number(item.timestamp),
        kind: "flag" as const,
        label: item.featureKey,
        formattedMessage: `${item.featureKey} → ${JSON.stringify(item.result?.value)}`,
      }));
      const expEvals: EvaluationEntry[] = experimentItems.map((item) => ({
        timestamp: Number(item.timestamp),
        kind: "exp" as const,
        label: item.key,
        formattedMessage: `${item.key} → variation ${item.result?.variationId}`,
      }));
      const eventEvals: EvaluationEntry[] = sessionEventItems.map((item) => {
        const props = item.properties
          ? ` — ${JSON.stringify(item.properties)}`
          : "";
        return {
          timestamp: Number(item.timestamp),
          kind: "event" as const,
          label: item.eventName,
          formattedMessage: `${item.eventName}${props}`,
        };
      });
      setEvaluations(
        [...flagEvals, ...expEvals, ...eventEvals].sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
      );
    } else {
      // Legacy fallback: parse rrweb custom events (type 5)
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
    }
  }, [events, metadata]);

  const jumpToEvent = (timestamp: number) => {
    const offset = firstEvent?.timestamp || 0;
    playerHandle.current?.goto(timestamp - offset);
  };

  const visibleEvaluations = useMemo(() => {
    if (evalTab === "all") return evaluations;
    if (evalTab === "flags")
      return evaluations.filter((e) => e.kind === "flag");
    if (evalTab === "events")
      return evaluations.filter((e) => e.kind === "event");
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
  const eventCount = useMemo(
    () => evaluations.filter((e) => e.kind === "event").length,
    [evaluations],
  );

  const copySessionId = () => {
    const id = metadata?.sessionId ?? selectedSessionId;
    if (id) void navigator.clipboard.writeText(id);
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

          {/* Add filter + Clear all */}
          <Flex align="center" gap="2" mt="2">
            <FilterQueryPopover
              open={filterPopoverOpen}
              onOpenChange={setFilterPopoverOpen}
              onAdd={handleAddFilter}
              sessions={sessions}
              trigger={
                <Button variant="ghost" size="xs" icon={<PiPlus />}>
                  Add filter
                </Button>
              }
            />
            {activeFilters.length > 0 && (
              <Button variant="outline" size="xs" onClick={clearFilters}>
                Clear all
              </Button>
            )}
          </Flex>

          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <Flex gap="2" wrap="wrap" mt="2">
              {activeFilters.map((chip) => (
                <Box
                  key={chip.key}
                  onClick={() => removeFilter(chip.key)}
                  style={{
                    cursor: "pointer",
                    padding: "0 6px",
                    height: 20,
                    borderRadius: 3,
                    background: "var(--slate-a3)",
                    color: "var(--slate-12)",
                    fontSize: 12,
                    fontWeight: 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  title="Click to remove filter"
                >
                  {chip.label}
                  <PiX style={{ flexShrink: 0, opacity: 0.6, fontSize: 11 }} />
                </Box>
              ))}
            </Flex>
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
              <Flex align="center" gap="2">
                <LoadingSpinner />
                <Text color="text-mid">Loading sessions…</Text>
              </Flex>
            )}
            {sessionsData && sessions.length === 0 && (
              <Text color="text-mid">
                No matching sessions for the current filters.
              </Text>
            )}
            {sessionsData &&
              sessions.map((session) => {
                const isSelected =
                  !!selectedSessionId &&
                  session.sessionId === selectedSessionId;
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
                      <Flex
                        gap="2"
                        align="center"
                        style={{ minWidth: 0, flex: 1 }}
                      >
                        <Avatar size="sm" variant="soft">
                          {avatarInitial(session.userId)}
                        </Avatar>
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
                          ID: {session.sessionId?.slice(0, 20) ?? "unknown"}…
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
                    {(metadata?.sessionId ?? selectedSessionId).slice(0, 16)}…
                  </span>
                </Text>
                <Button
                  variant="ghost"
                  size="xs"
                  icon={<PiCopy />}
                  aria-label="Copy session ID"
                  title="Copy session ID"
                  onClick={copySessionId}
                >
                  {""}
                </Button>
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
                <Flex align="center" gap="2">
                  <LoadingSpinner />
                  <Text color="text-mid">Loading session data…</Text>
                </Flex>
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
              <Button
                variant="ghost"
                size="xs"
                icon={<PiX />}
                aria-label="Close evaluations"
                title="Close evaluations"
                onClick={() => setEvalOpen(false)}
              >
                {""}
              </Button>
            </Flex>

            {/* Tabs with counts — active: text-high/medium, inactive: text-low/medium */}
            <Box style={{ flexShrink: 0 }}>
              <Tabs
                value={evalTab}
                onValueChange={(v) =>
                  setEvalTab((v as "all" | "flags" | "exp" | "events") || "all")
                }
              >
                <TabsList size="1">
                  <TabsTrigger value="all">
                    <Text
                      size="small"
                      weight="medium"
                      color={evalTab === "all" ? "text-high" : "text-low"}
                    >
                      All ({evaluations.length})
                    </Text>
                  </TabsTrigger>
                  <TabsTrigger value="flags">
                    <Text
                      size="small"
                      weight="medium"
                      color={evalTab === "flags" ? "text-high" : "text-low"}
                    >
                      Flags ({flagCount})
                    </Text>
                  </TabsTrigger>
                  <TabsTrigger value="exp">
                    <Text
                      size="small"
                      weight="medium"
                      color={evalTab === "exp" ? "text-high" : "text-low"}
                    >
                      Experiments ({expCount})
                    </Text>
                  </TabsTrigger>
                  <TabsTrigger value="events">
                    <Text
                      size="small"
                      weight="medium"
                      color={evalTab === "events" ? "text-high" : "text-low"}
                    >
                      Events ({eventCount})
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
                      No evaluations or events recorded for this session.
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
                  align="start"
                  justify="between"
                  gap="2"
                  onClick={() => jumpToEvent(evt.timestamp)}
                  style={{
                    padding: "8px 16px",
                    minHeight: 49,
                    borderBottom: "1px solid var(--slate-a3)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    {/* 14px semibold text-high — body/medium/semibold */}
                    <Text size="medium" weight="semibold" color="text-high">
                      {evt.formattedMessage}
                    </Text>
                    {/* 12px regular text-low — body/small/regular */}
                    <Box mt="2">
                      <Text
                        as="div"
                        size="small"
                        weight="regular"
                        color="text-low"
                      >
                        {new Date(evt.timestamp).toLocaleString()}
                      </Text>
                    </Box>
                  </Box>
                  <Badge
                    label={
                      evt.kind === "flag"
                        ? "Flag"
                        : evt.kind === "exp"
                          ? "Exp"
                          : "Event"
                    }
                    size="xs"
                    variant="soft"
                    color={
                      evt.kind === "flag"
                        ? "indigo"
                        : evt.kind === "exp"
                          ? "violet"
                          : "teal"
                    }
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
