import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { datetime, parseUtcInstantForDisplay } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import PageHead from "@/components/Layout/PageHead";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
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
      display: assigneeLabel(member.id),
    }))
    .sort((a, b) => a.display.localeCompare(b.display));
  if (
    assignee &&
    !memberAssigneeOptions.some((option) => option.value === assignee)
  ) {
    memberAssigneeOptions.push({
      value: assignee,
      display: assigneeLabel(assignee),
    });
  }
  const assigneeOptions = [
    { value: "", display: "Unassigned" },
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
          <div className="mb-3">
            <h1 className="h2">{issue.title}</h1>
            <Text color="text-low" size="medium">
              {issue.fingerprint}
            </Text>
          </div>

          <div className="row mb-4">
            <div className="col-md-8">
              <Callout status="info">
                <div className="small">
                  <strong>First seen:</strong>{" "}
                  {datetime(new Date(issue.firstSeen))}{" "}
                  {issue.firstRelease ? `(release ${issue.firstRelease})` : ""}
                  <br />
                  <strong>Last seen:</strong>{" "}
                  {datetime(new Date(issue.lastSeen))}{" "}
                  {issue.lastRelease ? `(release ${issue.lastRelease})` : ""}
                  <br />
                  <strong>Events (all time):</strong> {issue.events}
                  <br />
                  <strong>Distinct users (all time):</strong> {issue.users}
                </div>
              </Callout>

              <div
                className="d-flex flex-wrap align-items-center mt-3 mb-2"
                style={{ gap: 8 }}
              >
                {GRAPH_RANGE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={graphRange === option.value ? "solid" : "outline"}
                    onClick={() => setGraphRange(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
                {graphZoom && (
                  <Button variant="outline" onClick={() => setGraphZoom(null)}>
                    Reset zoom
                  </Button>
                )}
              </div>
              <IssueTrendChart
                data={data?.graph || []}
                zoomDomain={graphZoom}
                onZoomDomainChange={setGraphZoom}
                activeBucketStartMs={activeBucketStartMs}
                onBarClick={(bucketStartMs, bucketEndMs) => {
                  void selectLatestEventInRange(bucketStartMs, bucketEndMs);
                }}
              />
            </div>
            <div className="col-md-4">
              <Field
                label="Priority"
                options={[
                  { value: "low", display: "Low" },
                  { value: "medium", display: "Medium" },
                  { value: "high", display: "High" },
                  { value: "critical", display: "Critical" },
                ]}
                value={priority}
                onChange={async (e) => {
                  const nextPriority = e.target.value;
                  setPriority(nextPriority);
                  await saveIssue({ priority: nextPriority });
                }}
              />
              <Field
                label="Assignee"
                options={assigneeOptions}
                value={assignee}
                onChange={async (e) => {
                  const nextAssignee = e.target.value;
                  setAssignee(nextAssignee);
                  await saveIssue({
                    assigneeUserId: nextAssignee || null,
                  });
                }}
              />
              <Field
                label="Status"
                options={[
                  { value: "open", display: "Open" },
                  { value: "resolved", display: "Resolved" },
                  { value: "muted", display: "Muted" },
                ]}
                value={status}
                onChange={async (e) => {
                  const nextStatus = e.target.value;
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
            </div>
          </div>

          <p className="small text-muted mb-2">
            Environment and release tables below use all time data.
          </p>
          <div className="row mb-4">
            <div className="col-md-6">
              <h3 className="h5">By environment</h3>
              <table className="table table-sm">
                <tbody>
                  {data?.dimensions.environments.map((e) => (
                    <tr key={e.name}>
                      <td>{e.name || "(empty)"}</td>
                      <td>{e.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="col-md-6">
              <h3 className="h5">By release</h3>
              <table className="table table-sm">
                <tbody>
                  {data?.dimensions.releases.map((e) => (
                    <tr key={e.name}>
                      <td>{e.name || "(empty)"}</td>
                      <td>{e.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <h3 className="h5">Comments</h3>
          <div className="mb-2">
            {issue.comments?.map((c, i) => (
              <div key={i} className="border rounded p-2 mb-2">
                <div className="small text-muted">
                  {c.userName} · {datetime(new Date(c.date))}
                </div>
                <div>{c.body}</div>
              </div>
            ))}
          </div>
          <div className="mb-4">
            <Field
              label="New comment"
              textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button
              className="mt-2"
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
          </div>

          <div className="mb-4" style={{ position: "relative" }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h3 className="h5 mb-0">Events</h3>
              <div
                className="d-flex flex-wrap align-items-center"
                style={{ gap: 12 }}
              >
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
                <Link
                  href={`/error-tracking/${encodeURIComponent(fingerprint)}/events?clientKey=${encodeURIComponent(clientKey)}`}
                >
                  <Button>All events</Button>
                </Link>
              </div>
            </div>
            <div className="row mb-3 align-items-end">
              <div className="col-md-6">
                <Field
                  label="Jump to event id"
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value)}
                />
              </div>
              <div className="col-md-auto">
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
              </div>
            </div>
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
                <div className="row mb-3">
                  <div className="col-md-6">
                    <h4 className="h6">Summary</h4>
                    <table className="table table-sm">
                      <tbody>
                        <tr>
                          <th>Timestamp</th>
                          <td>
                            {datetime(
                              parseUtcInstantForDisplay(activeEvent.timestamp),
                            )}
                          </td>
                        </tr>
                        <tr>
                          <th>Title</th>
                          <td>
                            {String(
                              activeEventProperties.message ||
                                activeEventProperties.title ||
                                activeEvent.title ||
                                "",
                            )}
                          </td>
                        </tr>
                        <tr>
                          <th>Environment</th>
                          <td>{String(activeEvent.environment || "")}</td>
                        </tr>
                        <tr>
                          <th>Release</th>
                          <td>
                            {String(
                              activeEvent.release_version ||
                                activeEventProperties.release ||
                                "",
                            )}
                          </td>
                        </tr>
                        <tr>
                          <th>User</th>
                          <td>
                            {String(
                              activeEvent.user_id ||
                                activeEvent.device_id ||
                                "",
                            )}
                          </td>
                        </tr>
                        <tr>
                          <th>URL</th>
                          <td>{String(activeEvent.url || "")}</td>
                        </tr>
                        <tr>
                          <th>Device / OS</th>
                          <td>
                            {String(activeEvent.ua_device_type || "")} /{" "}
                            {String(activeEvent.ua_os || "")}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="col-md-6">
                    <h4 className="h6">Stack</h4>
                    <SymbolicatedStackTrace
                      rawStack={String(activeEventProperties.stack || "")}
                      symbolicatedStack={activeEvent?.symbolicatedStack}
                    />
                  </div>
                </div>
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
          </div>

          <h3 className="h5">Upload source maps</h3>
          <Text size="medium" color="text-low">
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
