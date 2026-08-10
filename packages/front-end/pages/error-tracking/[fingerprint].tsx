import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Flex, Grid, Box } from "@radix-ui/themes";
import { datetime, parseUtcInstantForDisplay } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import PageHead from "@/components/Layout/PageHead";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import LinkButton from "@/ui/LinkButton";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import DataList from "@/ui/DataList";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import { DocLink } from "@/components/DocLink";
import { useUser } from "@/services/UserContext";
import IssueTrendChart from "@/components/ErrorTracking/IssueTrendChart";
import { findBucketStartForTimestamp } from "@/components/ErrorTracking/issueTrendChartUtils";
import UserEventContextTables from "@/components/ErrorTracking/UserEventContextTables";
import SymbolicatedStackTrace, {
  type SymbolicatedStack,
} from "@/components/ErrorTracking/SymbolicatedStackTrace";
import { getMemberDisplayName } from "@/components/ErrorTracking/memberDisplay";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";

type IssueDetailResponse = {
  issue: {
    fingerprint: string;
    title: string;
    lastSeen: string;
    firstSeen: string;
    events: number;
    users: number;
    lastRelease: string;
    firstRelease: string;
    assigneeUserId: string | null;
    priority: string;
    status: string;
    resolvedAt: string | null;
    resolvedInRelease: string | null;
    comments: {
      userId: string;
      userName: string;
      body: string;
      date: string;
    }[];
  };
  dimensions: {
    environments: { name: string; count: number }[];
    releases: { name: string; count: number }[];
  };
  graph: { t: number; c: number }[];
};

type GraphRange = "hour" | "day" | "week" | "month" | "all";

const GRAPH_RANGE_OPTIONS: { value: GraphRange; label: string }[] = [
  { value: "hour", label: "Last hour" },
  { value: "day", label: "Last day" },
  { value: "week", label: "Last week" },
  { value: "month", label: "Last month" },
  { value: "all", label: "All time" },
];

export default function ErrorIssuePage(): React.ReactElement {
  const { ready: featureReady, shouldRender } = useFeatureDisabledRedirect(
    "enable-error-tracking",
  );
  const router = useRouter();
  const fingerprint = router.query.fingerprint as string;
  const clientKey = router.query.clientKey as string;
  const routeEventId =
    typeof router.query.event === "string" ? router.query.event : "";
  const { getUserDisplay, users } = useUser();
  const { apiCall } = useAuth();
  const [graphRange, setGraphRange] = useState<GraphRange>("all");
  const [graphZoom, setGraphZoom] = useState<[number, number] | null>(null);

  const base = clientKey
    ? `/error-tracking/issues/${encodeURIComponent(fingerprint)}/detail?clientKey=${encodeURIComponent(clientKey)}&graphRange=${encodeURIComponent(graphRange)}`
    : "";

  const { data, error, isLoading, mutate } = useApi<IssueDetailResponse>(base, {
    shouldRun: () => !!fingerprint && !!clientKey,
  });

  const latestEventsPath =
    fingerprint && clientKey
      ? `/error-tracking/issues/${encodeURIComponent(fingerprint)}/events?clientKey=${encodeURIComponent(clientKey)}&limit=1`
      : "";

  const firstEventPath =
    fingerprint && clientKey
      ? `/error-tracking/issues/${encodeURIComponent(fingerprint)}/events?clientKey=${encodeURIComponent(clientKey)}&limit=1&order=asc`
      : "";

  const { data: latestEventsData } = useApi<{ events: { eventId: string }[] }>(
    latestEventsPath,
    { shouldRun: () => !!fingerprint && !!clientKey },
  );

  const { data: firstEventData } = useApi<{ events: { eventId: string }[] }>(
    firstEventPath,
    { shouldRun: () => !!fingerprint && !!clientKey },
  );

  const oldestEventId = firstEventData?.events?.[0]?.eventId;
  const newestEventId = latestEventsData?.events?.[0]?.eventId;

  const [activeEventId, setActiveEventId] = useState("");

  const navigateToEvent = useCallback(
    (eventId: string) => {
      setActiveEventId(eventId);
      void router.push(
        {
          pathname: `/error-tracking/${encodeURIComponent(fingerprint)}`,
          query: { clientKey, event: eventId },
        },
        undefined,
        { shallow: true },
      );
    },
    [clientKey, fingerprint, router],
  );

  const fetchLatestEventIdInRange = useCallback(
    async (fromMs: number, toMs: number): Promise<string | null> => {
      if (!fingerprint || !clientKey || fromMs >= toMs) {
        return null;
      }
      try {
        const response = await apiCall<{ events: { eventId: string }[] }>(
          `/error-tracking/issues/${encodeURIComponent(fingerprint)}/events?clientKey=${encodeURIComponent(clientKey)}&limit=1&fromMs=${fromMs}&toMs=${toMs}`,
        );
        return response.events?.[0]?.eventId || null;
      } catch {
        return null;
      }
    },
    [apiCall, clientKey, fingerprint],
  );

  const selectLatestEventInRange = useCallback(
    async (fromMs: number, toMs: number) => {
      const eventId = await fetchLatestEventIdInRange(fromMs, toMs);
      if (eventId) {
        navigateToEvent(eventId);
      }
    },
    [fetchLatestEventIdInRange, navigateToEvent],
  );

  useEffect(() => {
    if (routeEventId) {
      setActiveEventId(routeEventId);
    }
  }, [routeEventId]);

  useEffect(() => {
    if (routeEventId || graphZoom) {
      return;
    }
    const latestEventId = latestEventsData?.events?.[0]?.eventId;
    if (latestEventId) {
      setActiveEventId(latestEventId);
    }
  }, [routeEventId, graphZoom, latestEventsData?.events]);

  useEffect(() => {
    if (!graphZoom || !fingerprint || !clientKey) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const eventId = await fetchLatestEventIdInRange(
        graphZoom[0],
        graphZoom[1] + 1,
      );
      if (!cancelled && eventId) {
        navigateToEvent(eventId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    graphZoom,
    fingerprint,
    clientKey,
    fetchLatestEventIdInRange,
    navigateToEvent,
  ]);

  const eventDetailPath =
    fingerprint && clientKey && activeEventId
      ? `/error-tracking/events/${encodeURIComponent(activeEventId)}?clientKey=${encodeURIComponent(clientKey)}&fingerprint=${encodeURIComponent(fingerprint)}`
      : "";

  const {
    data: eventData,
    error: eventError,
    isLoading: eventLoading,
  } = useApi<{
    event: Record<string, unknown> & {
      timestamp?: string;
      symbolicatedStack?: SymbolicatedStack | null;
    };
  }>(eventDetailPath, {
    shouldRun: () => !!fingerprint && !!clientKey && !!activeEventId,
  });

  const adjacentPath =
    fingerprint && clientKey && activeEventId
      ? `/error-tracking/events/${encodeURIComponent(activeEventId)}/adjacent?clientKey=${encodeURIComponent(clientKey)}&fingerprint=${encodeURIComponent(fingerprint)}`
      : "";

  const { data: adjacentData } = useApi<{
    previousEventId: string | null;
    nextEventId: string | null;
  }>(adjacentPath, {
    shouldRun: () => !!fingerprint && !!clientKey && !!activeEventId,
  });

  const [comment, setComment] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState("");
  const [resolvedInRelease, setResolvedInRelease] = useState("");

  useEffect(() => {
    if (data?.issue) {
      setPriority(data.issue.priority);
      setAssignee(data.issue.assigneeUserId || "");
      setStatus(data.issue.status);
      setResolvedInRelease(data.issue.resolvedInRelease || "");
    }
  }, [data?.issue]);

  const saveIssue = async (body: {
    assigneeUserId?: string | null;
    priority?: string;
    status?: string;
    resolvedInRelease?: string | null;
  }) => {
    await apiCall(
      `/error-tracking/issues/${encodeURIComponent(fingerprint)}?clientKey=${encodeURIComponent(clientKey)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    );
    await mutate();
  };

  useEffect(() => {
    setGraphZoom(null);
  }, [graphRange]);

  const issue = data?.issue;
  const activeEvent = eventData?.event;
  const activeEventProperties = (activeEvent?.properties || {}) as Record<
    string,
    unknown
  >;
  const activeEventAttributes = (activeEvent?.attributes || {}) as Record<
    string,
    unknown
  >;

  const activeBucketStartMs = useMemo(() => {
    const graph = data?.graph || [];
    if (!graph.length || !activeEvent?.timestamp) {
      return null;
    }
    return findBucketStartForTimestamp(
      graph,
      parseUtcInstantForDisplay(activeEvent.timestamp).getTime(),
    );
  }, [activeEvent?.timestamp, data?.graph]);

  const assigneeLabel = (id: string) =>
    getMemberDisplayName(id, users, getUserDisplay);

  const memberAssigneeOptions = Array.from(users.values())
    .filter((member) => member.id)
    .map((member) => ({
      value: member.id,
      label: assigneeLabel(member.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (
    assignee &&
    !memberAssigneeOptions.some((option) => option.value === assignee)
  ) {
    memberAssigneeOptions.push({
      value: assignee,
      label: assigneeLabel(assignee),
    });
  }
  const assigneeOptions = [
    { value: "", label: "Unassigned" },
    ...memberAssigneeOptions,
  ];

  if (!featureReady || !shouldRender) {
    return <LoadingOverlay />;
  }

  if (!clientKey) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="warning">
          Missing <code>clientKey</code>. Open this issue from the Error
          Tracking list.
        </Callout>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Error Tracking", href: "/error-tracking" },
          { display: issue?.title || "Issue", href: "#" },
        ]}
      />

      {isLoading && !issue && <LoadingOverlay />}
      {error && (
        <Callout status="error">
          {error.message || "Failed to load issue"}
        </Callout>
      )}

      {issue && (
        <>
          <Box mb="3">
            <h1 className="h2">{issue.title}</h1>
            <Text color="text-low" size="md">
              {issue.fingerprint}
            </Text>
          </Box>

          <Grid columns={{ initial: "1", md: "2fr 1fr" }} gap="4" mb="4">
            <Box>
              <DataList
                data={[
                  {
                    label: "First seen",
                    value: `${datetime(new Date(issue.firstSeen))}${issue.firstRelease ? ` (release ${issue.firstRelease})` : ""}`,
                  },
                  {
                    label: "Last seen",
                    value: `${datetime(new Date(issue.lastSeen))}${issue.lastRelease ? ` (release ${issue.lastRelease})` : ""}`,
                  },
                  { label: "Events (all time)", value: String(issue.events) },
                  {
                    label: "Distinct users (all time)",
                    value: String(issue.users),
                  },
                ]}
                mb="3"
              />

              <Flex align="center" justify="between" wrap="wrap" gap="2" mb="2">
                <Tabs
                  value={graphRange}
                  onValueChange={(v) => setGraphRange(v as GraphRange)}
                >
                  <TabsList>
                    {GRAPH_RANGE_OPTIONS.map((option) => (
                      <TabsTrigger key={option.value} value={option.value}>
                        {option.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {graphZoom && (
                  <Button variant="outline" onClick={() => setGraphZoom(null)}>
                    Reset zoom
                  </Button>
                )}
              </Flex>
              <IssueTrendChart
                data={data?.graph || []}
                zoomDomain={graphZoom}
                onZoomDomainChange={setGraphZoom}
                activeBucketStartMs={activeBucketStartMs}
                onBarClick={(bucketStartMs, bucketEndMs) => {
                  void selectLatestEventInRange(bucketStartMs, bucketEndMs);
                }}
              />
            </Box>
            <Box>
              <SelectField
                label="Priority"
                options={[
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                  { value: "critical", label: "Critical" },
                ]}
                value={priority}
                onChange={async (nextPriority) => {
                  setPriority(nextPriority);
                  await saveIssue({ priority: nextPriority });
                }}
              />
              <SelectField
                label="Assignee"
                options={assigneeOptions}
                value={assignee}
                onChange={async (nextAssignee) => {
                  setAssignee(nextAssignee);
                  await saveIssue({
                    assigneeUserId: nextAssignee || null,
                  });
                }}
              />
              <SelectField
                label="Status"
                options={[
                  { value: "open", label: "Open" },
                  { value: "resolved", label: "Resolved" },
                  { value: "muted", label: "Muted" },
                ]}
                value={status}
                onChange={async (nextStatus) => {
                  setStatus(nextStatus);
                  await saveIssue({ status: nextStatus });
                }}
              />
              <Field
                label="Resolved in release (optional)"
                placeholder="e.g. git SHA"
                value={resolvedInRelease}
                onChange={(e) => setResolvedInRelease(e.target.value)}
                onBlur={async (e) => {
                  const nextResolvedInRelease = e.target.value || null;
                  if (
                    nextResolvedInRelease === (issue.resolvedInRelease || null)
                  ) {
                    return;
                  }
                  await saveIssue({
                    resolvedInRelease: nextResolvedInRelease,
                  });
                }}
              />
            </Box>
          </Grid>

          <p className="small text-muted mb-2">
            Environment and release tables below use all time data.
          </p>
          <Grid columns={{ initial: "1", md: "2" }} gap="4" mb="4">
            <Box>
              <h3 className="h5">By environment</h3>
              <Table variant="list">
                <TableBody>
                  {data?.dimensions.environments.map((e) => (
                    <TableRow key={e.name}>
                      <TableCell>{e.name || "(empty)"}</TableCell>
                      <TableCell>{e.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Box>
              <h3 className="h5">By release</h3>
              <Table variant="list">
                <TableBody>
                  {data?.dimensions.releases.map((e) => (
                    <TableRow key={e.name}>
                      <TableCell>{e.name || "(empty)"}</TableCell>
                      <TableCell>{e.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Grid>

          <h3 className="h5">Comments</h3>
          <Box mb="2">
            {issue.comments?.map((c, i) => (
              <Box
                key={i}
                mb="2"
                p="2"
                style={{
                  border: "1px solid var(--gray-a5)",
                  borderRadius: "var(--radius-3)",
                }}
              >
                <div className="small text-muted">
                  {c.userName} · {datetime(new Date(c.date))}
                </div>
                <div>{c.body}</div>
              </Box>
            ))}
          </Box>
          <Box mb="4">
            <Field
              label="New comment"
              textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Box mt="2">
              <Button
                onClick={async () => {
                  await apiCall(
                    `/error-tracking/issues/${encodeURIComponent(fingerprint)}/comments?clientKey=${encodeURIComponent(clientKey)}`,
                    {
                      method: "POST",
                      body: JSON.stringify({ body: comment }),
                    },
                  );
                  setComment("");
                  await mutate();
                }}
              >
                Add comment
              </Button>
            </Box>
          </Box>

          <Box mb="4" style={{ position: "relative" }}>
            <Flex justify="between" align="center" mb="2">
              <h3 className="h5 mb-0">Events</h3>
              <Flex wrap="wrap" align="center" gap="3">
                <Button
                  disabled={!oldestEventId || activeEventId === oldestEventId}
                  onClick={() => {
                    if (oldestEventId) {
                      navigateToEvent(oldestEventId);
                    }
                  }}
                >
                  First
                </Button>
                <Button
                  disabled={!adjacentData?.previousEventId}
                  onClick={() => {
                    if (adjacentData?.previousEventId) {
                      navigateToEvent(adjacentData.previousEventId);
                    }
                  }}
                >
                  Back
                </Button>
                <Button
                  disabled={!adjacentData?.nextEventId}
                  onClick={() => {
                    if (adjacentData?.nextEventId) {
                      navigateToEvent(adjacentData.nextEventId);
                    }
                  }}
                >
                  Next
                </Button>
                <Button
                  disabled={!newestEventId || activeEventId === newestEventId}
                  onClick={() => {
                    if (newestEventId) {
                      navigateToEvent(newestEventId);
                    }
                  }}
                >
                  Last
                </Button>
                <LinkButton
                  href={`/error-tracking/${encodeURIComponent(fingerprint)}/events?clientKey=${encodeURIComponent(clientKey)}`}
                >
                  All events
                </LinkButton>
              </Flex>
            </Flex>
            <Flex gap="2" align="end" mb="3">
              <Box style={{ maxWidth: 400 }}>
                <Field
                  label="Jump to event id"
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value)}
                />
              </Box>
              <Button
                disabled={!jumpInput.trim()}
                onClick={() => {
                  const eventId = jumpInput.trim();
                  if (!eventId) return;
                  navigateToEvent(eventId);
                }}
              >
                Go
              </Button>
            </Flex>
            {eventError && (
              <Callout status="error">
                {eventError.message || "Failed to load event"}
              </Callout>
            )}
            {eventLoading && <LoadingOverlay />}
            {activeEvent && (
              <>
                <div className="small text-muted mb-2">
                  Event {activeEventId} ·{" "}
                  {datetime(parseUtcInstantForDisplay(activeEvent.timestamp))}
                </div>
                <Grid columns={{ initial: "1", md: "2" }} gap="4" mb="3">
                  <Box>
                    <h4 className="h6">Summary</h4>
                    <DataList
                      data={[
                        {
                          label: "Timestamp",
                          value: datetime(
                            parseUtcInstantForDisplay(activeEvent.timestamp),
                          ),
                        },
                        {
                          label: "Title",
                          value: String(
                            activeEventProperties.message ||
                              activeEventProperties.title ||
                              activeEvent.title ||
                              "",
                          ),
                        },
                        {
                          label: "Environment",
                          value: String(activeEvent.environment || ""),
                        },
                        {
                          label: "Release",
                          value: String(
                            activeEvent.release_version ||
                              activeEventProperties.release ||
                              "",
                          ),
                        },
                        {
                          label: "User",
                          value: String(
                            activeEvent.user_id || activeEvent.device_id || "",
                          ),
                        },
                        { label: "URL", value: String(activeEvent.url || "") },
                        {
                          label: "Device / OS",
                          value: `${String(activeEvent.ua_device_type || "")} / ${String(activeEvent.ua_os || "")}`,
                        },
                      ]}
                      columns={1}
                    />
                  </Box>
                  <Box>
                    <h4 className="h6">Stack</h4>
                    <SymbolicatedStackTrace
                      rawStack={String(activeEventProperties.stack || "")}
                      symbolicatedStack={activeEvent?.symbolicatedStack}
                    />
                  </Box>
                </Grid>
                <details className="mb-3">
                  <summary className="h6 mb-0" style={{ cursor: "pointer" }}>
                    Raw event properties
                  </summary>
                  <pre
                    className="bg-light p-2 small mt-2 mb-0"
                    style={{ maxHeight: 240, overflow: "auto" }}
                  >
                    {stringify(activeEventProperties)}
                  </pre>
                </details>
                <h4 className="h6">Context attributes</h4>
                <pre
                  className="bg-light p-2 small"
                  style={{ maxHeight: 240, overflow: "auto" }}
                >
                  {stringify(activeEventAttributes)}
                </pre>
                <UserEventContextTables
                  featureEvaluations={
                    (activeEvent.relatedFeatureUsage || []) as {
                      feature?: unknown;
                      value?: unknown;
                      evaluations?: unknown;
                      lastSeen?: unknown;
                    }[]
                  }
                  experimentMemberships={
                    (activeEvent.relatedExperimentViews || []) as {
                      experiment_id?: unknown;
                      variation_id?: unknown;
                      views?: unknown;
                      lastSeen?: unknown;
                    }[]
                  }
                />
              </>
            )}
          </Box>

          <h3 className="h5">Upload source maps</h3>
          <Text size="md" color="text-low">
            From CI, POST to <code>/api/v1/error-tracking/source-maps</code>{" "}
            with a secret API key and JSON fields <code>clientKey</code>,{" "}
            <code>release</code>, <code>minifiedUrl</code>, and{" "}
            <code>sourceMapJson</code>. See{" "}
            <DocLink docSection="errorTrackingSourceMaps">
              Error tracking docs
            </DocLink>{" "}
            for a sample upload script.
          </Text>
        </>
      )}
    </div>
  );
}
