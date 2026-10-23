import React, { useState } from "react";
import { PiXBold } from "react-icons/pi";
import { useRouter } from "next/router";
import { ago, datetime } from "shared/dates";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import type {
  DataSourceUsage as DataSourceUsageData,
  QueryInterface,
  QueryLogInterface,
  QueryLogUsage,
  QueryLogUsageGroup,
} from "shared/types/query";
import {
  Box,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
} from "@radix-ui/themes";
import { isManagedWarehouseUnavailable } from "shared/util";
import { useSearch } from "@/services/search";
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
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
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
  // Unrounded value for a tooltip
  exact: (value: number) => string;
};

type UsageResponse = {
  usage: DataSourceUsageData;
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

  const header = (
    <>
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: d?.name ?? did, href: `/datasources/${did}` },
          { display: "Usage" },
        ]}
      />
      <Heading as="h1" size="xl" mb="5">
        Usage
      </Heading>
    </>
  );
  const errorPage = (message: React.ReactNode) => (
    <div className="container pagecontents">
      {header}
      <Callout status="error">{message}</Callout>
    </div>
  );

  if (datasourceError) return errorPage(datasourceError);
  if (!ready) return <LoadingOverlay />;
  if (!d) {
    return errorPage(
      <>
        Data Source <code>{did}</code> does not exist.
      </>,
    );
  }
  if (!permissions.check("readData", d.projects || [])) {
    return errorPage("You do not have access to view this page.");
  }

  return (
    <div className="container pagecontents">
      {header}
      <DataSourceUsage datasource={d} />
    </div>
  );
};

export default DataSourceUsagePage;

const DRIVER_TABS = [
  { key: "factTables", label: "Fact tables", column: "Fact table" },
  { key: "experiments", label: "Experiments", column: "Experiment" },
  { key: "users", label: "People", column: "Run by" },
  { key: "queryTypes", label: "Query types", column: "Query type" },
] as const;

type UsageDriver = (typeof DRIVER_TABS)[number]["key"];

export function DataSourceUsage({
  datasource,
}: {
  datasource: DataSourceInterfaceWithParams;
}): React.ReactElement {
  const [driverTab, setDriverTab] = useState<UsageDriver>("factTables");
  const managedWarehousePending = isManagedWarehouseUnavailable(datasource);
  const { data, error, mutate } = useApi<UsageResponse>(
    `/datasource/${datasource.id}/usage`,
  );

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const units = USAGE_UNITS[datasource.type] ?? DEFAULT_USAGE_UNITS;
  const { total } = data.usage;
  const activeDriver =
    DRIVER_TABS.find((tab) => tab.key === driverTab) ?? DRIVER_TABS[0];

  const summaryCards = (
    <Grid
      columns={{ initial: "1", sm: String(units.length + 1) }}
      gap="4"
      mb="4"
    >
      {units.map((u) => (
        <Frame key={u.field} mb="0" py="4" px="5">
          <Text color="text-mid" weight="medium">
            {u.label}
          </Text>
          <Tooltip content={u.exact(total[u.field])}>
            <Text as="div" size="xl" weight="semibold">
              {u.scaleFor([total[u.field]])(total[u.field])}
            </Text>
          </Tooltip>
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
  );

  return (
    <>
      {managedWarehousePending ? (
        <Box mt="3" mb="3">
          <ManagedWarehouseNoEventsCallout />
        </Box>
      ) : null}

      <Heading as="h2" size="md" mb="3">
        Last 30 Days
      </Heading>
      {summaryCards}

      <IncrementalRefreshCallout
        datasource={datasource}
        usage={data.usage}
        units={units}
      />

      <Box mb="3">
        <SegmentedControl.Root
          style={{ width: "fit-content" }}
          value={driverTab}
          onValueChange={(value) => {
            if (DRIVER_TABS.some((tab) => tab.key === value)) {
              setDriverTab(value as UsageDriver);
            }
          }}
          aria-label="Usage breakdown"
        >
          {DRIVER_TABS.map((tab) => (
            <SegmentedControl.Item key={tab.key} value={tab.key}>
              {tab.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Box>
      <UsageGroupTable
        key={activeDriver.key}
        tab={activeDriver}
        groups={data.usage[activeDriver.key]}
        total={total}
        units={units}
        data={data}
      />

      <Heading as="h2" size="md" mt="6" mb="3">
        Recent Queries
      </Heading>
      <RecentQueries
        datasource={datasource}
        data={data}
        units={units}
        onCancel={mutate}
      />
    </>
  );
}

function IncrementalRefreshCallout({
  datasource,
  usage,
  units,
}: {
  datasource: DataSourceInterfaceWithParams;
  usage: DataSourceUsageData;
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
      <strong>Data Pipeline Mode</strong> can help optimize this.
    </Callout>
  );
}

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

  const {
    items,
    searchInputProps,
    isFiltered,
    clear,
    SortableTableColumnHeader,
  } = useSearch({
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
    <>
      <SearchField
        {...searchInputProps}
        placeholder={`Search ${tab.label.toLowerCase()}`}
        mt="3"
      />
      <Table variant="list" roundedCorners scrollX>
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
                    <Tooltip content="The fact table SQL has no {{startDate}} filter, so queries may scan the whole table.">
                      <Badge
                        color="amber"
                        variant="soft"
                        label="No date filter"
                      />
                    </Tooltip>
                  )}
                </Flex>
              </TableCell>
              <TableCell style={NUMERIC_CELL}>
                {row.queries.toLocaleString()}
              </TableCell>
              {units.map((u, i) => (
                <TableCell key={u.field} style={NUMERIC_CELL}>
                  <Tooltip content={u.exact(row[u.field])}>
                    <span>{formats[i](row[u.field])}</span>
                  </Tooltip>
                  <span style={{ display: "inline-block", width: 44 }}>
                    <Text size="sm" color="text-low">
                      {share(row[u.field], total[u.field])}
                    </Text>
                  </span>
                </TableCell>
              ))}
            </TableRow>
          ))}
          {isFiltered && !items.length && (
            <NoMatchesRow colSpan={2 + units.length} clear={clear} />
          )}
        </TableBody>
      </Table>
    </>
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
        factTable: factTableIds
          .map((id) => getFactTableById(id)?.name ?? id)
          .join(", "),
        person: q.userId ? getUserDisplay(q.userId) : "Automated",
        startedAt: new Date(q.startedAt).getTime(),
        status: q.status,
        error: q.error,
      };
    }),
  ];

  const {
    items,
    searchInputProps,
    isFiltered,
    clear,
    SortableTableColumnHeader,
  } = useSearch({
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
      <SearchField {...searchInputProps} placeholder="Search queries" />
      <Table variant="list" roundedCorners scrollX stickyLastColumn>
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
              <TableRow key={row.id}>
                <TableCell>
                  {queryId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openQuery(queryId)}
                    >
                      {row.queryType}
                    </Button>
                  ) : (
                    row.queryType
                  )}
                </TableCell>
                <TableCell>
                  {row.experimentId ? (
                    <Link href={`/experiment/${row.experimentId}`}>
                      {row.experiment}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {row.factTableIds.length
                    ? row.factTableIds.map((id, i) => (
                        <React.Fragment key={id}>
                          {i > 0 && ", "}
                          <Link href={`/fact-tables/${id}`}>
                            {getFactTableById(id)?.name ?? id}
                          </Link>
                        </React.Fragment>
                      ))
                    : "—"}
                </TableCell>
                <TableCell>{row.person || "—"}</TableCell>
                <TableCell>
                  <Tooltip content={datetime(new Date(row.startedAt))}>
                    <span>{ago(new Date(row.startedAt))}</span>
                  </Tooltip>
                </TableCell>
                {statUnits.map((u, i) => {
                  const value = row[u.field];
                  return (
                    <TableCell key={u.field} style={NUMERIC_CELL}>
                      {value !== undefined ? (
                        <Tooltip content={u.exact(value)}>
                          <span>{statFormats[i](value)}</span>
                        </Tooltip>
                      ) : (
                        "—"
                      )}
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
          {isFiltered && !items.length && (
            <NoMatchesRow colSpan={6 + statUnits.length} clear={clear} />
          )}
        </TableBody>
      </Table>
    </>
  );
}

function SearchField(props: React.ComponentProps<typeof TextField>) {
  return (
    <Box maxWidth="300px" mb="3">
      <TextField type="search" {...props} />
    </Box>
  );
}

function NoMatchesRow({
  colSpan,
  clear,
}: {
  colSpan: number;
  clear: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} style={{ textAlign: "center" }}>
        No matching results.{" "}
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear search
        </Button>
      </TableCell>
    </TableRow>
  );
}

const STATUS_BADGES: Record<
  QueryInterface["status"],
  { label: string; color: "green" | "amber" | "red" | "blue" | "gray" }
> = {
  succeeded: { label: "Succeeded", color: "green" },
  "partially-succeeded": { label: "Partially succeeded", color: "amber" },
  failed: { label: "Failed", color: "red" },
  running: { label: "Running", color: "blue" },
  queued: { label: "Queued", color: "gray" },
};

function QueryStatus({
  status,
  error,
  onCancel,
}: {
  status: QueryInterface["status"];
  error?: string;
  onCancel?: () => Promise<void>;
}) {
  const { label, color } = STATUS_BADGES[status];
  return (
    <Flex align="center" gap="2">
      <Tooltip content={error} enabled={status === "failed" && !!error}>
        <Badge label={label} color={color} variant="soft" />
      </Tooltip>
      {onCancel && (
        <Tooltip content="Cancel query">
          <IconButton
            variant="solid"
            color="tomato"
            size="1"
            radius="full"
            aria-label="Cancel query"
            onClick={onCancel}
          >
            <PiXBold />
          </IconButton>
        </Tooltip>
      )}
    </Flex>
  );
}
