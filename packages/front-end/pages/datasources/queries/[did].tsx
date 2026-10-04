import React, { useState } from "react";
import {
  FaCheck,
  FaCircle,
  FaExclamationTriangle,
  FaSquare,
} from "react-icons/fa";
import { PiXBold } from "react-icons/pi";
import { useRouter } from "next/router";
import { ago, datetime } from "shared/dates";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  DataSourceUsage,
  QueryInterface,
  QueryLogInterface,
  QueryLogUsage,
  QueryLogUsageGroup,
} from "shared/types/query";
import { capitalize } from "lodash";
import { Flex, Grid, IconButton } from "@radix-ui/themes";
import { isManagedWarehouseUnavailable } from "shared/util";
import { useSearch } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import ExpandableQuery from "@/components/Queries/ExpandableQuery";
import { getQueryTypeLabel } from "@/components/Queries/queryTypeLabels";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { DocLink } from "@/components/DocLink";

type UsageField = Exclude<keyof QueryLogUsage, "queries">;
type UsageUnit = {
  field: UsageField;
  label: string;
  // Picks one scale for a column from its biggest value, so rows compare at a glance
  scaleFor: (values: (number | undefined)[]) => (value: number) => string;
  // Unrounded value for a title tooltip
  exact: (value: number) => string;
};

type UsageResponse = {
  usage: DataSourceUsage;
  recent: QueryLogInterface[];
  running: Pick<
    QueryInterface,
    "id" | "queryType" | "status" | "createdAt" | "startedAt"
  >[];
  experimentNames: Record<string, string>;
  factTablesWithoutDateFilter: string[];
};

type Scale = { min: number; divisor: number; suffix: string };

// Largest first; a column uses the first scale its biggest value exceeds
const SIZE_SCALES: Scale[] = [
  { min: 10 * 1024 ** 4, divisor: 1024 ** 4, suffix: "TB" },
  { min: 10 * 1024 ** 3, divisor: 1024 ** 3, suffix: "GB" },
  { min: -Infinity, divisor: 1024 ** 2, suffix: "MB" },
];
const TIME_SCALES: Scale[] = [
  { min: 60 * 60 * 1000, divisor: 60 * 60 * 1000, suffix: "h" },
  { min: -Infinity, divisor: 1000, suffix: "s" },
];

function scaled(scales: Scale[], digits: number) {
  const numberFormat = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (values: (number | undefined)[]) => {
    const max = Math.max(0, ...values.map((v) => v ?? 0));
    const scale = scales.find((s) => max > s.min) ?? scales[scales.length - 1];
    return (v: number) =>
      `${numberFormat.format(v / scale.divisor)} ${scale.suffix}`;
  };
}

const EXACT_FORMAT = new Intl.NumberFormat("en-US");

const bytes = (field: UsageField, label: string): UsageUnit => ({
  field,
  label,
  scaleFor: scaled(SIZE_SCALES, 2),
  exact: (v) => `${EXACT_FORMAT.format(v)} bytes`,
});
const time = (field: UsageField, label: string): UsageUnit => ({
  field,
  label,
  scaleFor: scaled(TIME_SCALES, 1),
  exact: (v) => `${EXACT_FORMAT.format(v)} ms`,
});

// The units each warehouse bills on. BigQuery shows both because we can't
// tell whether a project pays per byte (on demand) or per slot (reservation).
// Snowflake bills on time, but bytes scanned helps spot inefficient queries.
const USAGE_UNITS: Partial<
  Record<DataSourceInterfaceWithParams["type"], UsageUnit[]>
> = {
  bigquery: [
    bytes("bytesBilled", "Bytes billed"),
    time("totalSlotMs", "Slot time"),
  ],
  snowflake: [
    time("executionDurationMs", "Execution time"),
    bytes("bytesProcessed", "Bytes scanned"),
  ],
  athena: [
    bytes("bytesProcessed", "Bytes scanned"),
    time("durationMs", "Duration"),
  ],
};
const DURATION_UNIT = time("durationMs", "Duration");
const DEFAULT_USAGE_UNITS = [DURATION_UNIT];

const NUMERIC_CELL = { textAlign: "right", whiteSpace: "nowrap" } as const;

function share(value: number, total: number) {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "";
}

const DataSourceUsagePage = (): React.ReactElement => {
  const permissions = usePermissions();
  const router = useRouter();
  const { did } = router.query as { did: string };
  const { getDatasourceById, ready, error: datasourceError } = useDefinitions();
  const d = getDatasourceById(did);
  const managedWarehousePending = d ? isManagedWarehouseUnavailable(d) : false;

  const canView = d && permissions.check("readData", d.projects || []);

  const { data, error, mutate } = useApi<UsageResponse>(
    `/datasource/${did}/usage`,
  );

  if (!canView) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  if (datasourceError || error) {
    return (
      <div className="container pagecontents">
        <Callout status="error">{datasourceError ?? error?.message}</Callout>
      </div>
    );
  }

  if (!ready || !data) {
    return <LoadingOverlay />;
  }
  if (!d) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Datasource <code>{did}</code> does not exist.
        </Callout>
      </div>
    );
  }

  const units = USAGE_UNITS[d.type] ?? DEFAULT_USAGE_UNITS;
  const { total } = data.usage;

  return (
    <div className="container pagecontents">
      {managedWarehousePending ? (
        <div className="mt-3 mb-3">
          <ManagedWarehouseNoEventsCallout />
        </div>
      ) : null}
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: d.name, href: `/datasources/${did}` },
          { display: "Usage" },
        ]}
      />
      <Heading as="h1" size="xl" mb="5">
        Usage
      </Heading>

      <Heading as="h2" size="md" mb="3">
        Last 30 Days
      </Heading>
      <Grid columns={{ initial: "1", sm: "4" }} gap="4" mb="4">
        {units.map((u) => (
          <Frame key={u.field} mb="0" py="4" px="5">
            <Text color="text-mid" weight="medium">
              {u.label}
            </Text>
            <Text
              as="div"
              size="xl"
              weight="semibold"
              title={u.exact(total[u.field])}
            >
              {u.scaleFor([total[u.field]])(total[u.field])}
            </Text>
          </Frame>
        ))}
        <Frame mb="0" py="4" px="5">
          <Text color="text-mid" weight="medium">
            Queries
          </Text>
          <Text as="div" size="xl" weight="semibold">
            {total.queries.toLocaleString()}
          </Text>
        </Frame>
      </Grid>

      <IncrementalRefreshCallout
        datasource={d}
        usage={data.usage}
        units={units}
      />

      <Tabs defaultValue="factTables">
        <TabsList>
          {DRIVER_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {DRIVER_TABS.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <UsageGroupTable
              tab={t}
              groups={data.usage[t.key]}
              total={total}
              units={units}
              data={data}
            />
          </TabsContent>
        ))}
      </Tabs>

      <Heading as="h2" size="md" mt="6" mb="3">
        Recent Queries
      </Heading>
      <RecentQueries
        datasource={d}
        data={data}
        units={units}
        onCancel={mutate}
      />
    </div>
  );
};

export default DataSourceUsagePage;

function IncrementalRefreshCallout({
  datasource,
  usage,
  units,
}: {
  datasource: DataSourceInterfaceWithParams;
  usage: DataSourceUsage;
  units: UsageUnit[];
}) {
  const pipeline = datasource.settings.pipelineSettings;
  const incrementalOn =
    pipeline?.allowWriting && pipeline.mode === "incremental";
  if (incrementalOn || !datasource.properties?.hasIncrementalRefresh) {
    return null;
  }

  const experimentGroups = usage.queryTypes.filter((g) =>
    g.id?.startsWith("experiment"),
  );
  const shares = units
    .map((u) => {
      const used = experimentGroups.reduce((sum, g) => sum + g[u.field], 0);
      if (!used) return null;
      if (used / usage.total[u.field] < 0.5) return null;
      return `${share(used, usage.total[u.field])} of ${u.label.toLowerCase()}`;
    })
    .filter(Boolean);
  if (!shares.length) return null;

  return (
    <Callout
      status="info"
      mb="4"
      action={
        <DocLink docSection="pipelineMode" useRadix={true}>
          Learn more
        </DocLink>
      }
    >
      Experiment queries used {shares.join(" and ")}.{" "}
      <strong>Data Pipeline mode</strong> can help optimize this.
    </Callout>
  );
}

const DRIVER_TABS = [
  { key: "factTables", label: "Fact tables", column: "Fact table" },
  { key: "experiments", label: "Experiments", column: "Experiment" },
  { key: "users", label: "People", column: "Person" },
  { key: "queryTypes", label: "Query types", column: "Query type" },
] as const;

type GroupRow = QueryLogUsage & {
  id: string;
  name: string;
  href?: string;
  noDateFilter?: boolean;
};

function UsageGroupTable({
  tab,
  groups,
  total,
  units,
  data,
}: {
  tab: (typeof DRIVER_TABS)[number];
  groups: QueryLogUsageGroup[];
  total: QueryLogUsage;
  units: UsageUnit[];
  data: UsageResponse;
}) {
  const { getFactTableById } = useDefinitions();
  const { getUserDisplay } = useUser();

  const rows: GroupRow[] = groups.map(({ id, ...usage }) => {
    if (tab.key === "factTables" && id) {
      return {
        ...usage,
        id,
        name: getFactTableById(id)?.name ?? id,
        href: `/fact-tables/${id}`,
        noDateFilter: data.factTablesWithoutDateFilter.includes(id),
      };
    }
    if (tab.key === "experiments" && id) {
      return {
        ...usage,
        id,
        name: data.experimentNames[id] ?? id,
        href: `/experiment/${id}`,
      };
    }
    if (tab.key === "users") {
      return {
        ...usage,
        id: id ?? "",
        name: id ? getUserDisplay(id) : "Automated",
      };
    }
    return { ...usage, id: id ?? "", name: getQueryTypeLabel(id ?? "unknown") };
  });

  const { items, SortableTableColumnHeader } = useSearch({
    items: rows,
    searchFields: ["name"],
    localStorageKey: `datasourceUsage:${tab.key}`,
    defaultSortField: units[0].field,
    defaultSortDir: -1,
    disableUrlSearchTerm: true,
  });

  const formats = units.map((u) => u.scaleFor(rows.map((r) => r[u.field])));

  if (!rows.length) {
    return (
      <Text as="p" color="text-mid" mt="3">
        No usage in the last 30 days.
      </Text>
    );
  }

  return (
    <Table variant="list" stickyHeader={false} roundedCorners mt="3">
      <TableHeader>
        <TableRow>
          <SortableTableColumnHeader field="name">
            {tab.column}
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="queries" style={NUMERIC_CELL}>
            Queries
          </SortableTableColumnHeader>
          {units.map((u) => (
            <SortableTableColumnHeader
              key={u.field}
              field={u.field}
              style={NUMERIC_CELL}
            >
              {u.label}
            </SortableTableColumnHeader>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Flex align="center" gap="2" wrap="wrap">
                {row.href ? (
                  <Link href={row.href}>{row.name}</Link>
                ) : (
                  <Text color={row.id ? "text-high" : "text-mid"}>
                    {row.name}
                  </Text>
                )}
                {row.noDateFilter && (
                  <Badge
                    color="amber"
                    variant="soft"
                    label="No date filter"
                    title="The fact table SQL doesn't filter on {{startDate}}"
                  />
                )}
              </Flex>
            </TableCell>
            <TableCell style={NUMERIC_CELL}>
              {row.queries.toLocaleString()}
            </TableCell>
            {units.map((u, i) => (
              <TableCell
                key={u.field}
                style={NUMERIC_CELL}
                title={u.exact(row[u.field])}
              >
                {formats[i](row[u.field])}
                <span style={{ display: "inline-block", width: 44 }}>
                  <Text size="sm" color="text-low">
                    {share(row[u.field], total[u.field])}
                  </Text>
                </span>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type RecentRow = Partial<Record<UsageField, number>> & {
  id: string;
  queryId?: string;
  queryType: string;
  experiment: string;
  experimentId?: string;
  factTable: string;
  factTableIds: string[];
  person: string;
  startedAt: number;
  status: QueryInterface["status"];
  error?: string;
};

function RecentQueries({
  datasource,
  data,
  units,
  onCancel,
}: {
  datasource: DataSourceInterfaceWithParams;
  data: UsageResponse;
  units: UsageUnit[];
  onCancel: () => Promise<unknown>;
}) {
  const permissions = usePermissions();
  const { apiCall } = useAuth();
  const { getFactTableById } = useDefinitions();
  const { getUserDisplay } = useUser();
  const [modalData, setModalData] = useState<QueryInterface | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canCancel = permissions.check("runQueries", datasource.projects || []);

  // Add wall-clock duration unless a unit already measures how long queries ran
  const statUnits = units.some(
    (u) => u.field === "durationMs" || u.field === "executionDurationMs",
  )
    ? units
    : [DURATION_UNIT, ...units];

  const rows: RecentRow[] = [
    ...data.running.map((q) => ({
      id: q.id,
      queryId: q.id,
      queryType: getQueryTypeLabel(q.queryType || "unknown"),
      experiment: "",
      factTable: "",
      factTableIds: [],
      person: "",
      startedAt: new Date(q.startedAt ?? q.createdAt).getTime(),
      status: q.status,
    })),
    ...data.recent.map((q) => {
      const factTableIds = q.factTableIds ?? [];
      return {
        ...Object.fromEntries(
          statUnits.map((u) => [
            u.field,
            u.field === "durationMs" ? q.durationMs : q.statistics?.[u.field],
          ]),
        ),
        id: q.id,
        queryId: q.queryId,
        queryType: getQueryTypeLabel(q.queryType),
        experimentId: q.experimentId,
        experiment: q.experimentId
          ? (data.experimentNames[q.experimentId] ?? q.experimentId)
          : "",
        factTableIds,
        factTable: factTableIds[0]
          ? (getFactTableById(factTableIds[0])?.name ?? factTableIds[0])
          : "",
        person: q.userId ? getUserDisplay(q.userId) : "Automated",
        startedAt: new Date(q.startedAt).getTime(),
        status: q.status,
        error: q.error,
      };
    }),
  ];

  const { items, SortableTableColumnHeader } = useSearch({
    items: rows,
    searchFields: ["queryType", "experiment", "factTable", "person"],
    localStorageKey: "datasourceRecentQueries",
    defaultSortField: "startedAt",
    defaultSortDir: -1,
    undefinedLast: true,
    disableUrlSearchTerm: true,
  });

  const statFormats = statUnits.map((u) =>
    u.scaleFor(rows.map((r) => r[u.field])),
  );

  if (!rows.length) {
    return (
      <Text as="p" color="text-mid">
        No queries have been run on this Data Source.
      </Text>
    );
  }

  async function openQuery(queryId: string) {
    setActionError(null);
    try {
      const res = await apiCall<{ queries: (QueryInterface | null)[] }>(
        `/queries/${queryId}`,
      );
      if (res.queries[0]) setModalData(res.queries[0]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to load query");
    }
  }

  return (
    <>
      {modalData && (
        <ModalStandard
          trackingEventModalType=""
          open
          close={() => setModalData(null)}
          size="lg"
          header="Inspect query"
        >
          <ExpandableQuery query={modalData} i={0} total={1} />
        </ModalStandard>
      )}
      {actionError && (
        <Callout status="error" mb="3">
          {actionError}
        </Callout>
      )}
      <Table variant="list" stickyHeader={false} roundedCorners>
        <TableHeader>
          <TableRow>
            <SortableTableColumnHeader field="queryType">
              Query type
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="experiment">
              Experiment
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="factTable">
              Fact tables
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="person">
              Run by
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="startedAt">
              Started
            </SortableTableColumnHeader>
            {statUnits.map((u) => (
              <SortableTableColumnHeader
                key={u.field}
                field={u.field}
                style={NUMERIC_CELL}
              >
                {u.label}
              </SortableTableColumnHeader>
            ))}
            <TableColumnHeader>Status</TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => {
            const { queryId } = row;
            return (
              <TableRow
                key={row.id}
                onClick={queryId ? () => openQuery(queryId) : undefined}
                style={queryId ? { cursor: "pointer" } : undefined}
              >
                <TableCell>{row.queryType}</TableCell>
                <TableCell>
                  {row.experimentId ? (
                    <Link
                      href={`/experiment/${row.experimentId}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.experiment}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {row.factTable ? (
                    <span
                      title={row.factTableIds
                        .map((id) => getFactTableById(id)?.name ?? id)
                        .join(", ")}
                    >
                      <Link
                        href={`/fact-tables/${row.factTableIds[0]}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.factTable}
                      </Link>
                      {row.factTableIds.length > 1 && (
                        <Text color="text-low">
                          {" "}
                          +{row.factTableIds.length - 1}
                        </Text>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{row.person || "—"}</TableCell>
                <TableCell>
                  <span title={datetime(new Date(row.startedAt))}>
                    {ago(new Date(row.startedAt))}
                  </span>
                </TableCell>
                {statUnits.map((u, i) => {
                  const value = row[u.field];
                  return (
                    <TableCell
                      key={u.field}
                      style={NUMERIC_CELL}
                      title={value !== undefined ? u.exact(value) : undefined}
                    >
                      {value !== undefined ? statFormats[i](value) : "—"}
                    </TableCell>
                  );
                })}
                <TableCell>
                  <QueryStatus
                    status={row.status}
                    error={row.error}
                    onCancel={
                      row.status === "running" && canCancel
                        ? async () => {
                            setActionError(null);
                            try {
                              await apiCall(
                                `/datasource/${datasource.id}/query/${row.id}/cancel`,
                                { method: "POST" },
                              );
                            } catch (e) {
                              setActionError(
                                e instanceof Error
                                  ? e.message
                                  : "Failed to cancel query",
                              );
                            } finally {
                              await onCancel();
                            }
                          }
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}

function QueryStatus({
  status,
  error,
  onCancel,
}: {
  status: QueryInterface["status"];
  error?: string;
  onCancel?: () => Promise<void>;
}) {
  return (
    <span className="d-flex align-items-center">
      <Tooltip
        body={
          <div>
            <strong>{capitalize(status)}</strong>
            {status === "failed" && error && <p className="mb-0">{error}</p>}
          </div>
        }
        tipMinWidth="50px"
        tipPosition="top"
      >
        {status === "running" && (
          <FaCircle className="text-info mr-2" title="Running" />
        )}
        {status === "queued" && (
          <FaSquare className="text-secondary mr-2" title="Queued" />
        )}
        {status === "failed" && (
          <FaExclamationTriangle className="text-danger mr-2" title="Failed" />
        )}
        {status === "succeeded" && (
          <FaCheck className="text-success mr-2" title="Succeeded" />
        )}
      </Tooltip>
      {onCancel && (
        <Tooltip
          body="Cancel query"
          tipPosition="top"
          tipMinWidth="50"
          flipTheme={false}
        >
          <IconButton
            variant="solid"
            color="tomato"
            size="2"
            style={{ width: 20, height: 20, padding: 2 }}
            radius="full"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            <PiXBold size={14} />
          </IconButton>
        </Tooltip>
      )}
    </span>
  );
}
