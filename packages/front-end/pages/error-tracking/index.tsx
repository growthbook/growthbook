import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { datetime } from "shared/dates";
import { isManagedWarehouseAwaitingProvisioning } from "shared/util";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import PageHead from "@/components/Layout/PageHead";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import MiniSparkline from "@/components/ErrorTracking/MiniSparkline";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import { useUser } from "@/services/UserContext";
import { getMemberDisplayName } from "@/components/ErrorTracking/memberDisplay";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";

type IssueRow = {
  fingerprint: string;
  title: string;
  lastSeen: string;
  firstSeen: string;
  events: number;
  users: number;
  trend24h: { t: number; v: number }[];
  trend30d: { t: number; v: number }[];
  assigneeUserId: string | null;
  priority: string;
  status: string;
};

function ageLabel(firstSeen: string): string {
  const a = new Date(firstSeen).getTime();
  const diff = Date.now() - a;
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return "<1d";
  if (d < 30) return `${d}d`;
  const m = Math.floor(d / 30);
  return `${m}mo`;
}

export default function ErrorTrackingIndexPage(): React.ReactElement {
  const { ready: featureReady, shouldRender } = useFeatureDisabledRedirect(
    "enable-error-tracking",
  );
  const router = useRouter();
  const { datasources, projects, ready: definitionsReady } = useDefinitions();
  const { users, getUserDisplay } = useUser();

  const growthbookManagedDatasource = datasources.find(
    (ds) => ds.type === "growthbook_clickhouse",
  );
  const pending = growthbookManagedDatasource
    ? isManagedWarehouseAwaitingProvisioning(growthbookManagedDatasource)
    : false;

  const { data: sdkData } = useApi<{ connections: SDKConnectionInterface[] }>(
    "/sdk-connections",
    { shouldRun: () => definitionsReady },
  );

  const projectFilter = router.query.project as string | undefined;

  const filteredConnections = useMemo(() => {
    const connections = sdkData?.connections ?? [];
    if (!projectFilter || projectFilter === "all") return connections;
    return connections.filter((c) => c.projects?.includes(projectFilter));
  }, [sdkData?.connections, projectFilter]);

  const [clientKey, setClientKey] = useState("");
  useEffect(() => {
    if (!clientKey && filteredConnections[0]?.key) {
      setClientKey(filteredConnections[0].key);
    }
  }, [filteredConnections, clientKey]);

  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  const issuesUrl =
    clientKey &&
    `/error-tracking/issues?clientKey=${encodeURIComponent(clientKey)}&q=${encodeURIComponent(search)}`;

  const { data, error, isLoading, mutate } = useApi<{ issues: IssueRow[] }>(
    issuesUrl || "",
    {
      shouldRun: () =>
        !!growthbookManagedDatasource &&
        !pending &&
        !!clientKey &&
        definitionsReady,
    },
  );

  if (!definitionsReady || !featureReady || !shouldRender) {
    return <LoadingOverlay />;
  }

  if (!growthbookManagedDatasource) {
    return (
      <div className="container-fluid pagecontents">
        <PageHead
          breadcrumb={[{ display: "Error Tracking", href: "/error-tracking" }]}
        />
        <h1>Error Tracking</h1>
        <Callout status="warning">
          Error tracking requires a GrowthBook Managed Warehouse connection.
          Configure one under Metrics and Data → Data Sources.
        </Callout>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="container-fluid pagecontents">
        <PageHead
          breadcrumb={[{ display: "Error Tracking", href: "/error-tracking" }]}
        />
        <h1>Error Tracking</h1>
        <Callout status="info">
          Managed warehouse is still provisioning. Check back shortly.
        </Callout>
      </div>
    );
  }

  const runSearch = () => {
    setSearch(q.trim());
    void mutate();
  };

  return (
    <div className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[{ display: "Error Tracking", href: "/error-tracking" }]}
      />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1>Error Tracking</h1>
        <Button onClick={() => mutate()}>Refresh</Button>
      </div>

      <div className="row mb-3 align-items-end">
        <div className="col-md-auto">
          <Field
            label="Project"
            options={[
              { value: "all", display: "All projects" },
              ...projects.map((p) => ({ value: p.id, display: p.name })),
            ]}
            value={projectFilter || "all"}
            onChange={(e) => {
              const v = e.target.value;
              const next = v === "all" ? undefined : String(v);
              void router.push(
                {
                  pathname: "/error-tracking",
                  query: next ? { project: next } : {},
                },
                undefined,
                { shallow: true },
              );
              setClientKey("");
            }}
          />
        </div>
        <div className="col-md-auto">
          <Field
            label="SDK Connection"
            options={filteredConnections.map((c) => ({
              value: c.key,
              display: `${c.name} (${c.key.slice(0, 8)}…)`,
            }))}
            value={clientKey}
            onChange={(e) => setClientKey(e.target.value)}
          />
        </div>
        <div className="col-md-5">
          <Field
            label="Search"
            placeholder="Title or fingerprint…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            render={(id, ref) => (
              <div className="d-flex align-items-center" style={{ gap: 8 }}>
                <input
                  id={id}
                  ref={ref}
                  className="form-control"
                  value={q}
                  placeholder="Title or fingerprint…"
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runSearch();
                    }
                  }}
                />
                <Button className="flex-shrink-0" onClick={runSearch}>
                  Search
                </Button>
              </div>
            )}
          />
        </div>
      </div>

      {error && (
        <Callout status="error">
          {error.message ||
            "Could not load issues. Ensure the managed warehouse includes the errors table (re-provision if needed)."}
        </Callout>
      )}

      {isLoading && <LoadingOverlay />}

      {!isLoading && data?.issues && (
        <div style={{ overflowX: "auto" }}>
          <table className="table table-hover table-sm">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Last seen</th>
                <th>Age</th>
                <th>Trend (24h)</th>
                <th>Trend (30d)</th>
                <th>Events</th>
                <th>Users</th>
                <th>Priority</th>
                <th>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {data.issues.map((issue) => (
                <tr key={issue.fingerprint}>
                  <td style={{ maxWidth: 360 }}>
                    <Link
                      href={`/error-tracking/${encodeURIComponent(issue.fingerprint)}?clientKey=${encodeURIComponent(clientKey)}`}
                    >
                      {issue.title || issue.fingerprint}
                    </Link>
                    <div className="text-muted small text-truncate">
                      {issue.fingerprint}
                    </div>
                    {issue.status === "resolved" && (
                      <Badge color="green" label="Resolved" />
                    )}
                  </td>
                  <td>{datetime(new Date(issue.lastSeen))}</td>
                  <td>{ageLabel(issue.firstSeen)}</td>
                  <td>
                    <MiniSparkline data={issue.trend24h} />
                  </td>
                  <td>
                    <MiniSparkline
                      data={issue.trend30d}
                      color="var(--violet-9)"
                    />
                  </td>
                  <td>{issue.events}</td>
                  <td>{issue.users}</td>
                  <td>{issue.priority}</td>
                  <td>
                    {getMemberDisplayName(
                      issue.assigneeUserId,
                      users,
                      getUserDisplay,
                    )}
                  </td>
                </tr>
              ))}
              {!data.issues.length && (
                <tr>
                  <td colSpan={9} className="text-muted">
                    No errors recorded yet. Use the SDK{" "}
                    <code>growthbookErrorTrackingPlugin</code> with{" "}
                    <code>growthbookTrackingPlugin</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
