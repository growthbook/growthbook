import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import { datetime } from "shared/dates";
import { isManagedWarehouseAwaitingProvisioning } from "shared/util";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import PageHead from "@/components/Layout/PageHead";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import { Select, SelectItem } from "@/ui/Select";
import Button from "@/ui/Button";
import MiniSparkline from "@/components/ErrorTracking/MiniSparkline";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import { RadixColor } from "@/ui/HelperText";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { useUser } from "@/services/UserContext";
import { getMemberDisplayName } from "@/components/ErrorTracking/memberDisplay";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";

const PRIORITY_COLORS: Record<string, RadixColor> = {
  critical: "red",
  high: "orange",
  medium: "amber",
  low: "gray",
};

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

  const priorityColor = (priority: string): RadixColor =>
    PRIORITY_COLORS[priority] || "gray";

  const runSearch = () => {
    setSearch(q.trim());
    void mutate();
  };

  return (
    <div className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[{ display: "Error Tracking", href: "/error-tracking" }]}
      />
      <Flex justify="between" align="center" mb="3">
        <h1>Error Tracking</h1>
        <Button onClick={() => mutate()}>Refresh</Button>
      </Flex>

      <Flex gap="3" align="end" mb="3" wrap="wrap">
        <Select
          label="Project"
          value={projectFilter || "all"}
          setValue={(v) => {
            const next = v === "all" ? undefined : v;
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
        >
          <SelectItem value="all">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="SDK Connection"
          value={clientKey}
          setValue={(v) => setClientKey(v)}
        >
          {filteredConnections.map((c) => (
            <SelectItem key={c.key} value={c.key}>
              {`${c.name} (${c.key.slice(0, 8)}…)`}
            </SelectItem>
          ))}
        </Select>
        <Flex gap="2" align="end">
          <Field
            label="Search"
            placeholder="Title or fingerprint…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runSearch();
              }
            }}
          />
          <Button onClick={runSearch}>Search</Button>
        </Flex>
      </Flex>

      {error && (
        <Callout status="error">
          {error.message ||
            "Could not load issues. Ensure the managed warehouse includes the errors table (re-provision if needed)."}
        </Callout>
      )}

      {isLoading && <LoadingOverlay />}

      {!isLoading && data?.issues && (
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Issue</TableColumnHeader>
              <TableColumnHeader>Last seen</TableColumnHeader>
              <TableColumnHeader>Age</TableColumnHeader>
              <TableColumnHeader>Trend (24h)</TableColumnHeader>
              <TableColumnHeader>Trend (30d)</TableColumnHeader>
              <TableColumnHeader>Events</TableColumnHeader>
              <TableColumnHeader>Users</TableColumnHeader>
              <TableColumnHeader>Priority</TableColumnHeader>
              <TableColumnHeader>Assignee</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.issues.map((issue) => (
              <TableRow key={issue.fingerprint}>
                <TableCell style={{ maxWidth: 360 }}>
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
                </TableCell>
                <TableCell>{datetime(new Date(issue.lastSeen))}</TableCell>
                <TableCell>{ageLabel(issue.firstSeen)}</TableCell>
                <TableCell>
                  <MiniSparkline data={issue.trend24h} />
                </TableCell>
                <TableCell>
                  <MiniSparkline
                    data={issue.trend30d}
                    color="var(--violet-9)"
                  />
                </TableCell>
                <TableCell>{issue.events}</TableCell>
                <TableCell>{issue.users}</TableCell>
                <TableCell>
                  <Badge
                    color={priorityColor(issue.priority)}
                    label={issue.priority}
                  />
                </TableCell>
                <TableCell>
                  {getMemberDisplayName(
                    issue.assigneeUserId,
                    users,
                    getUserDisplay,
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!data.issues.length && (
              <TableRow>
                <TableCell colSpan={9} className="text-muted">
                  No errors recorded yet. Use the SDK{" "}
                  <code>growthbookErrorTrackingPlugin</code> with{" "}
                  <code>growthbookTrackingPlugin</code>.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
