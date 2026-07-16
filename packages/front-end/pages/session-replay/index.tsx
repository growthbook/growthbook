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
  PiX,
} from "react-icons/pi";
import { AppFeatures } from "shared/types/app-features";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import SessionReplaySearchFilters from "@/components/Search/SessionReplaySearchFilters";
import { useSessionReplayFilters } from "@/hooks/useSessionReplayFilters";
import type { RrwebPlayerHandle } from "@/components/SessionReplay/player";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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
  startedAt: string;
  endedAt: string;
  lastEventAt: string;
  ingestedAt: string;
  durationMs: number;
  eventCount: number;
  meaningfulEventCount: number;
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

type EvalItem = {
  timestamp: number;
  [key: string]: unknown;
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
  ingestedAt: string;
  durationMs: number;
  eventCount: number;
  meaningfulEventCount: number;
  errorCount: number;
  urlFirst: string;
  urlsVisited: string[];
  pageTitle: string;
  viewportWidth: number;
  viewportHeight: number;
  attributes: Record<string, string>;
  featureKeys: string[];
  experimentKeys: string[];
  featureEvals?: {
    items: (EvalItem & { featureKey: string; result: { value: unknown } })[];
  };
  experimentEvals?: {
    items: (EvalItem & { key: string; result: { variationId: number } })[];
  };
  sessionEvents?: {
    items: (EvalItem & {
      eventName: string;
      properties?: Record<string, unknown>;
    })[];
  };
  userAgent: string;
  country: string;
  device: string;
  browser: string;
};

type SessionResponse = {
  events: eventWithTime[];
  metadata: SessionMetadata;
};

// A session is treated as "still recording" when its most recent chunk was
// ingested within this window. Aligned to the SDK's ~15-min idle timeout — a
// live recorder flushes on a timer, so a gap longer than the idle timeout
// means it has almost certainly stopped. Uses ingestedAt (server clock), never
// lastEventAt (client clock, subject to skew).
const LIVE_THRESHOLD_MS = 15 * 60 * 1000;

function isSessionLive(ingestedAt: string | undefined): boolean {
  if (!ingestedAt) return false;
  const t = new Date(ingestedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < LIVE_THRESHOLD_MS;
}

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

function buildEvaluationsFromMetadata(
  metadata: SessionMetadata,
): EvaluationEntry[] {
  const entries: EvaluationEntry[] = [];

  const toMs = (v: unknown): number => {
    const n = typeof v === "string" ? Number(v) : (v as number);
    return Number.isFinite(n) ? n : 0;
  };

  for (const item of metadata.featureEvals?.items ?? []) {
    const value = item.result?.value;
    entries.push({
      timestamp: toMs(item.timestamp),
      kind: "flag",
      label: item.featureKey,
      formattedMessage: `${item.featureKey} → ${JSON.stringify(value ?? null)}`,
    });
  }

  for (const item of metadata.experimentEvals?.items ?? []) {
    const variationId = item.result?.variationId;
    entries.push({
      timestamp: toMs(item.timestamp),
      kind: "exp",
      label: item.key,
      formattedMessage: `${item.key} → variation ${variationId ?? "?"}`,
    });
  }

  for (const item of metadata.sessionEvents?.items ?? []) {
    entries.push({
      timestamp: toMs(item.timestamp),
      kind: "event",
      label: item.eventName,
      formattedMessage: item.eventName,
    });
  }

  entries.sort((a, b) => a.timestamp - b.timestamp);
  return entries;
}

export default function SessionReplayPage() {
  const gb = useGrowthBook<AppFeatures>();
  const sessionReplayEnabled = !!gb?.isOn("session-replays");
  const permissionsUtil = usePermissionsUtil();

  const router = useRouter();
  const { apiCall } = useAuth();
  const { project } = useDefinitions();

  // ---- UI panel state ------------------------------------------------------
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);

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

  // ---- search / filters ----------------------------------------------------
  const { searchInputProps, syntaxFilters, setSearchValue, queryParams } =
    useSessionReplayFilters(router, project);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (project) params.set("project", project);
    for (const [k, v] of Object.entries(queryParams)) {
      if (v) params.set(k, v);
    }
    return params.toString();
  }, [page, project, queryParams]);

  const { data: sessionsData, error: sessionsError } = useApi<{
    sessions: SessionReplayRow[];
  }>(`/session-replay?${queryString}`);

  const sessions = useMemo(() => sessionsData?.sessions ?? [], [sessionsData]);
  const hasNextPage = sessions.length === 100;

  // Clear selected session when project changes so a session from another
  // project doesn't stay visible after switching.
  const prevProjectRef = useRef(project);
  useEffect(() => {
    if (prevProjectRef.current !== project) {
      prevProjectRef.current = project;
      if (selectedSessionId) {
        const { sessionId: _, ...rest } = router.query;
        void router.push(
          { pathname: "/session-replay", query: { ...rest, page: "1" } },
          undefined,
          { shallow: true },
        );
      }
    }
  }, [project, selectedSessionId, router]);

  const goToPage = (nextPage: number) => {
    const query: Record<string, string> = {
      page: String(nextPage),
      ...queryParams,
    };
    if (selectedSessionId) query.sessionId = selectedSessionId;
    void router.push({ pathname: "/session-replay", query }, undefined, {
      shallow: true,
    });
  };

  const selectSession = (sessionId: string) => {
    const query: Record<string, string> = {
      page: String(page),
      ...queryParams,
    };
    query.sessionId = sessionId;
    void router.push({ pathname: "/session-replay", query }, undefined, {
      shallow: true,
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

    if (metadata) {
      setEvaluations(buildEvaluationsFromMetadata(metadata));
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
    const sessionId = metadata?.id ?? selectedSessionId;
    if (sessionId) void navigator.clipboard.writeText(sessionId);
  };

  if (
    !sessionReplayEnabled ||
    !permissionsUtil.canViewSessionReplay({
      projects: project ? [project] : [],
    })
  ) {
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
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 16,
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

          {/* Search bar + filter dropdowns */}
          <Box mt="2">
            <Field
              placeholder="Search filters (e.g. user:alice duration:>30)"
              type="search"
              {...searchInputProps}
            />
            <Flex mt="2" wrap="wrap">
              <SessionReplaySearchFilters
                searchInputProps={searchInputProps}
                syntaxFilters={syntaxFilters}
                setSearchValue={setSearchValue}
                sessions={sessions}
              />
            </Flex>
          </Box>

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
                          ID: {session.id?.slice(0, 20) ?? "unknown"}…
                        </span>
                      </Text>
                    </Box>
                    <Flex gap="2" mt="1" align="center" wrap="wrap">
                      <Text color="text-low" size="small">
                        ⌁ {session.meaningfulEventCount.toLocaleString()} key
                        events
                      </Text>
                      <Text color="text-low" size="small">
                        ⏱ {formatDuration(session.durationMs)}
                      </Text>
                      {session.errorCount > 0 && (
                        <Badge
                          label={`${session.errorCount} error${
                            session.errorCount === 1 ? "" : "s"
                          }`}
                          size="xs"
                          variant="soft"
                          color="red"
                          radius="full"
                        />
                      )}
                      {isSessionLive(session.ingestedAt) && (
                        <Badge
                          label="● Recording"
                          size="xs"
                          variant="soft"
                          color="red"
                          radius="full"
                        />
                      )}
                    </Flex>
                  </Box>
                );
              })}
          </Box>

          {/* Pagination */}
          <Flex justify="between" align="center" mt="3">
            <Text color="text-low" size="small">
              Showing {sessions.length} session
              {sessions.length === 1 ? "" : "s"}
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
                <Button
                  variant="ghost"
                  size="xs"
                  icon={<PiCopy />}
                  onClick={copySessionId}
                  aria-label="Copy session ID"
                  title="Copy session ID"
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
                  Key events
                </Text>
                <Text color="text-low">
                  {metadata?.meaningfulEventCount?.toLocaleString() ?? "—"}
                </Text>
                {metadata ? (
                  <Text color="text-low" size="small" ml="1">
                    ({metadata.eventCount.toLocaleString()} total)
                  </Text>
                ) : null}
              </Flex>
              {metadata && metadata.errorCount > 0 && (
                <Flex gap="1" align="center">
                  <Text weight="medium" color="text-high">
                    Errors
                  </Text>
                  <Badge
                    label={metadata.errorCount.toLocaleString()}
                    size="sm"
                    variant="soft"
                    color="red"
                    radius="full"
                  />
                </Flex>
              )}
              {isSessionLive(metadata?.ingestedAt) && (
                <Badge
                  label="● Recording"
                  size="sm"
                  variant="soft"
                  color="red"
                  radius="full"
                />
              )}
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
                      <Badge
                        label={String(evaluations.length)}
                        size="xs"
                        variant="soft"
                        color="violet"
                        radius="full"
                        style={{ marginLeft: 6 }}
                      />
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
          {!selectedSessionId || playerLoading || playerError ? (
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
          ) : events ? (
            <RrwebPlayer
              key={selectedSessionId}
              events={events}
              handleRef={playerHandle}
            />
          ) : null}
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
                onClick={() => setEvalOpen(false)}
                aria-label="Close evaluations"
                title="Close evaluations"
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
                      Exp ({expCount})
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
                    <Text
                      as="div"
                      size="medium"
                      weight="semibold"
                      color="text-high"
                      truncate={true}
                    >
                      {evt.formattedMessage}
                    </Text>
                    <Text
                      as="div"
                      size="small"
                      weight="regular"
                      color="text-low"
                    >
                      {(() => {
                        const d = new Date(evt.timestamp);
                        return isNaN(d.getTime()) ? "" : d.toLocaleString();
                      })()}
                    </Text>
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
                          : "amber"
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
