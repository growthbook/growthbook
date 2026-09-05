import { Fragment, useEffect, useMemo, useState } from "react";
import uniqid from "uniqid";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { date } from "shared/dates";
import {
  groupLegacyMetricsIntoFactTables,
  LegacyMetricGroup,
} from "shared/legacy-metrics";
import { MetricInterface } from "shared/types/metric";
import {
  CreateFactTableProps,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import { ProgressBar } from "@/ui/ProgressBar";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingOverlay from "@/components/LoadingOverlay";
import SortedTags from "@/components/Tags/SortedTags";
import ProjectBadges from "@/components/ProjectBadges";
import PageHead from "@/components/Layout/PageHead";

// Mirrors MigrateLegacyMetricsResponse in the back-end controller
interface MigrateResponse {
  results: {
    factTableId: string;
    created: string[];
    skipped: string[];
    errors: { id: string; message: string }[];
  }[];
  archived: string[];
  notArchived: { id: string; reason: string }[];
  metricGroupsUpdated: number;
  templatesUpdated: number;
}

interface RunSummary {
  created: number;
  skipped: number;
  archived: number;
  notArchived: { id: string; reason: string }[];
  metricGroupsUpdated: number;
  templatesUpdated: number;
  errors: { id: string; message: string }[];
}

// Keep each request well under the 2MB body limit and quick to run
const MAX_GROUPS_PER_BATCH = 10;
const MAX_METRICS_PER_BATCH = 40;

function allowedUserIdTypes(ds: DataSourceInterfaceWithParams): string[] {
  const raw: unknown = ds.settings?.userIdTypes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t: unknown) =>
      typeof t === "string"
        ? t
        : typeof t === "object" && t && "userIdType" in t
          ? String((t as { userIdType: unknown }).userIdType)
          : "",
    )
    .filter(Boolean);
}

// Strip the server-owned fields from the util's output
function toFactTableProps(
  factTable: LegacyMetricGroup["factTable"],
): CreateFactTableProps & { id: string } {
  return {
    id: factTable.id,
    name: factTable.name || factTable.id,
    description: "",
    owner: "",
    projects: factTable.projects || [],
    tags: factTable.tags || [],
    datasource: factTable.datasource || "",
    userIdTypes: factTable.userIdTypes,
    sql: factTable.sql,
    eventName: "",
    columns: factTable.columns
      .filter((c) => c.numberFormat)
      .map((c) => ({ column: c.column, numberFormat: c.numberFormat })),
  };
}

function toFactMetricProps(metric: FactMetricInterface) {
  const {
    organization: _org,
    dateCreated: _created,
    dateUpdated: _updated,
    ...props
  } = metric;
  return props;
}

// The legacy metric a fact metric was converted from. Funnels list the whole
// chain in `replaces`, ending with the metric that was converted.
function legacyIdOf(metric: FactMetricInterface): string {
  return metric.replaces?.[metric.replaces.length - 1] || "";
}

type PlanItem = { group: LegacyMetricGroup; metrics: FactMetricInterface[] };

function chunk(items: PlanItem[]): PlanItem[][] {
  const batches: PlanItem[][] = [];
  let current: PlanItem[] = [];
  let count = 0;
  for (const item of items) {
    if (
      current.length &&
      (current.length >= MAX_GROUPS_PER_BATCH ||
        count + item.metrics.length > MAX_METRICS_PER_BATCH)
    ) {
      batches.push(current);
      current = [];
      count = 0;
    }
    current.push(item);
    count += item.metrics.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export default function MigrateLegacyMetricsPage() {
  const {
    datasources,
    _factMetricsIncludingArchived: allFactMetrics,
    getDatasourceById,
    mutateDefinitions,
  } = useDefinitions();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const { data: metricsData, mutate: mutateMetrics } = useApi<{
    metrics: MetricInterface[];
  }>("/metrics");
  const { data: factTablesData, mutate: mutateFactTables } = useApi<{
    factTables: FactTableInterface[];
  }>("/fact-tables");

  // Legacy metrics still worth migrating, per datasource
  const eligibleByDatasource = useMemo(() => {
    const replaced = new Set(allFactMetrics.flatMap((m) => m.replaces || []));
    const map = new Map<string, MetricInterface[]>();
    for (const m of metricsData?.metrics || []) {
      if (m.status === "archived" || replaced.has(m.id)) continue;
      if (!getDatasourceById(m.datasource)) continue;
      map.set(m.datasource, [...(map.get(m.datasource) || []), m]);
    }
    return map;
  }, [metricsData, allFactMetrics, getDatasourceById]);

  const datasourceOptions = datasources.filter((d) =>
    eligibleByDatasource.has(d.id),
  );
  const [datasourceId, setDatasourceId] = useState("");
  useEffect(() => {
    if (!datasourceOptions.some((d) => d.id === datasourceId)) {
      setDatasourceId(datasourceOptions[0]?.id || "");
    }
  }, [datasourceOptions, datasourceId]);

  const conversion = useMemo(() => {
    const datasource = getDatasourceById(datasourceId);
    const eligible = eligibleByDatasource.get(datasourceId);
    if (!datasource || !eligible || !factTablesData) return null;
    const result = groupLegacyMetricsIntoFactTables(eligible, {
      datasourceType: datasource.type,
      generateFactTableId: () => `ftb_migrated_${uniqid()}`,
      generateFactMetricId: (m) => `fact__${m.id}`,
      existingFactTables: factTablesData.factTables.filter(
        (f) => f.datasource === datasourceId && !f.archived,
      ),
      userIdTypes: allowedUserIdTypes(datasource),
    });
    const legacyById = new Map(eligible.map((m) => [m.id, m]));
    return {
      eligible,
      groups: result.groups,
      errors: result.errors.flatMap((e) => {
        const metric = legacyById.get(e.metricId);
        return metric ? [{ metric, error: e.error }] : [];
      }),
      legacyById,
    };
  }, [datasourceId, eligibleByDatasource, factTablesData, getDatasourceById]);

  // Selection is per fact metric id
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(
      new Set(
        conversion?.groups.flatMap((g) => g.metrics.map((m) => m.id)) || [],
      ),
    );
  }, [conversion]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // Every table with a selected metric, plus tables that selected ratio or
  // funnel metrics reference (created with no metrics of their own)
  const plan = useMemo(() => {
    if (!conversion) return [];
    const byId = new Map(conversion.groups.map((g) => [g.factTable.id, g]));
    const items = new Map<string, PlanItem>();
    for (const group of conversion.groups) {
      const metrics = group.metrics.filter((m) => selected.has(m.id));
      if (metrics.length) items.set(group.factTable.id, { group, metrics });
    }
    for (const { metrics } of [...items.values()]) {
      for (const m of metrics) {
        const refs = [
          m.denominator?.factTableId,
          ...(m.funnelSettings?.steps.map((s) => s.factTableId) || []),
        ];
        for (const ref of refs) {
          const group = ref ? byId.get(ref) : undefined;
          if (group && !items.has(group.factTable.id)) {
            items.set(group.factTable.id, { group, metrics: [] });
          }
        }
      }
    }
    return [...items.values()];
  }, [conversion, selected]);

  const selectedCount = selected.size;

  const canMigrate =
    permissionsUtil.canCreateFactTable({ projects: [] }) &&
    permissionsUtil.canCreateMetric({ projects: [] });

  async function run() {
    setRunning(true);
    setProgress(0);
    const result: RunSummary = {
      created: 0,
      skipped: 0,
      archived: 0,
      notArchived: [],
      metricGroupsUpdated: 0,
      templatesUpdated: 0,
      errors: [],
    };
    const batches = chunk(plan);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const res = await apiCall<MigrateResponse>("/legacy-metrics/migrate", {
          method: "POST",
          body: JSON.stringify({
            archive: true,
            groups: batch.map(({ group, metrics }) => ({
              factTable: toFactTableProps(group.factTable),
              existing: group.existing,
              metrics: metrics.map(toFactMetricProps),
            })),
          }),
        });
        for (const r of res.results) {
          result.created += r.created.length;
          result.skipped += r.skipped.length;
          result.errors.push(...r.errors);
        }
        result.archived += res.archived.length;
        result.notArchived.push(...res.notArchived);
        result.metricGroupsUpdated += res.metricGroupsUpdated;
        result.templatesUpdated += res.templatesUpdated;
      } catch (e) {
        result.errors.push(
          ...batch.map(({ group }) => ({
            id: group.factTable.name || group.factTable.id,
            message: e instanceof Error ? e.message : String(e),
          })),
        );
      }
      setProgress((i + 1) / batches.length);
    }
    await Promise.all([
      mutateDefinitions(),
      mutateMetrics(),
      mutateFactTables(),
    ]);
    setSummary(result);
    setRunning(false);
  }

  if (!canMigrate) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have permission to create Fact Tables and Fact Metrics.
        </Callout>
      </div>
    );
  }
  if (!metricsData || !factTablesData) return <LoadingOverlay />;

  const legacyNames = new Map(
    (metricsData.metrics || []).map((m) => [m.id, m.name]),
  );

  return (
    <div className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Metrics", href: "/metrics" },
          { display: "Migrate Legacy Metrics" },
        ]}
      />
      <Flex justify="between" align="center" mb="4">
        <Heading as="h1" size="lg" mb="0">
          Migrate Legacy Metrics
        </Heading>
        <Box style={{ maxWidth: 400 }}>
          <Select
            value={datasourceId}
            setValue={setDatasourceId}
            disabled={running}
          >
            {datasourceOptions.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name} ({eligibleByDatasource.get(d.id)?.length} legacy
                metrics)
              </SelectItem>
            ))}
          </Select>
        </Box>
      </Flex>

      {summary && (
        <Box mb="4">
          <Callout status={summary.errors.length ? "warning" : "success"}>
            <Text weight="semibold">Migration finished.</Text> Created{" "}
            {summary.created} Fact Metrics ({summary.skipped} already existed),
            archived {summary.archived} legacy metrics, updated{" "}
            {summary.metricGroupsUpdated} metric groups and{" "}
            {summary.templatesUpdated} Experiment Templates.
            {summary.notArchived.length > 0 && (
              <Box mt="2">
                <Text weight="semibold">
                  {summary.notArchived.length} legacy metrics were migrated but
                  not archived:
                </Text>
                <ul className="mb-0">
                  {summary.notArchived.map((n) => (
                    <li key={n.id}>
                      {legacyNames.get(n.id) || n.id}: {n.reason}
                    </li>
                  ))}
                </ul>
              </Box>
            )}
            {summary.errors.length > 0 && (
              <Box mt="2">
                <Text weight="semibold">{summary.errors.length} errors:</Text>
                <ul className="mb-0">
                  {summary.errors.map((e, i) => (
                    <li key={i}>
                      {e.id}: {e.message}
                    </li>
                  ))}
                </ul>
              </Box>
            )}
          </Callout>
        </Box>
      )}

      {datasourceOptions.length === 0 ? (
        <Callout status="info">
          There are no legacy metrics left to migrate.
        </Callout>
      ) : (
        <>
          {conversion && (
            <>
              <Flex align="center" mb="3">
                <Flex gap="3" align="center">
                  <Button
                    variant="ghost"
                    disabled={running}
                    onClick={() =>
                      setSelected(
                        new Set(
                          conversion.groups.flatMap((g) =>
                            g.metrics.map((m) => m.id),
                          ),
                        ),
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={running || selected.size === 0}
                    onClick={() => setSelected(new Set())}
                  >
                    Select none
                  </Button>
                </Flex>

                <Box flexGrow={"1"} />
                <Box mr="4">
                  {selectedCount} /{" "}
                  {conversion.groups.reduce((n, g) => n + g.metrics.length, 0)}{" "}
                  metrics selected
                </Box>

                <Button onClick={run} disabled={running || selectedCount === 0}>
                  Run Migration
                </Button>
              </Flex>

              {running && (
                <Box mb="4">
                  <ProgressBar
                    segments={[
                      {
                        id: "migration",
                        weight: 100,
                        completion: Math.round(progress * 100),
                        color: "violet",
                      },
                    ]}
                  />
                  <Text size="sm">
                    Migrating in batches, {Math.round(progress * 100)}% done.
                    Legacy metrics used by running experiments are migrated but
                    left unarchived.
                  </Text>
                </Box>
              )}

              {conversion.groups.map((group) => (
                <FactTableFrame
                  key={group.factTable.id}
                  group={group}
                  legacyById={conversion.legacyById}
                  selected={selected}
                  disabled={running}
                  requiredOnly={plan.some(
                    (p) =>
                      p.group.factTable.id === group.factTable.id &&
                      p.metrics.length === 0,
                  )}
                  onToggle={(ids, checked) => {
                    const next = new Set(selected);
                    ids.forEach((id) =>
                      checked ? next.add(id) : next.delete(id),
                    );
                    setSelected(next);
                  }}
                />
              ))}

              {conversion.errors.length > 0 && (
                <Box mt="5">
                  <Flex align="center" gap="3" mb="2">
                    <Heading as="h2" size="md" mb="0">
                      Cannot Be Migrated
                    </Heading>
                    <Button
                      variant="ghost"
                      onClick={() => setShowErrors((v) => !v)}
                    >
                      {showErrors ? "Hide" : `Show ${conversion.errors.length}`}
                    </Button>
                  </Flex>
                  <Text size="sm" as="p">
                    These metrics use SQL that does not map onto a Fact Table,
                    such as CTEs, UNIONs, or aggregations that change which rows
                    count. They stay as legacy metrics.
                  </Text>
                  {showErrors && (
                    <Table variant="list">
                      <TableHeader>
                        <TableRow>
                          <TableColumnHeader>Metric</TableColumnHeader>
                          <TableColumnHeader>Reason</TableColumnHeader>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {conversion.errors.map(({ metric, error }) => (
                          <TableRow key={metric.id}>
                            <TableCell>
                              <Link href={`/metric/${metric.id}`}>
                                {metric.name}
                              </Link>
                            </TableCell>
                            <TableCell>{error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function FactTableFrame({
  group,
  legacyById,
  selected,
  disabled,
  requiredOnly,
  onToggle,
}: {
  group: LegacyMetricGroup;
  legacyById: Map<string, MetricInterface>;
  selected: Set<string>;
  disabled: boolean;
  // Created with no metrics because a selected ratio or funnel references it
  requiredOnly: boolean;
  onToggle: (ids: string[], checked: boolean) => void;
}) {
  const { getOwnerDisplay } = useUser();
  const [showSql, setShowSql] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const ids = group.metrics.map((m) => m.id);
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  const checkboxValue =
    selectedCount === 0
      ? false
      : selectedCount === ids.length
        ? true
        : "indeterminate";

  return (
    <Frame>
      <Flex justify="between" align="center" mb="3">
        <Flex gap="3" align="center">
          <Checkbox
            value={checkboxValue}
            disabled={disabled}
            setValue={(checked) => onToggle(ids, checked)}
          />
          <Heading as="h3" size="md" mb="0">
            {group.factTable.name}
          </Heading>
          {group.existing && <Badge label="Existing Fact Table" color="gray" />}
          {requiredOnly && (
            <Badge
              label="Created for a selected ratio or funnel metric"
              color="amber"
            />
          )}
          <Text size="sm">
            {selectedCount} of {ids.length} selected
          </Text>
        </Flex>
        <Button variant="ghost" onClick={() => setShowSql((v) => !v)}>
          {showSql ? "Hide SQL" : "Show SQL"}
        </Button>
      </Flex>
      {showSql && (
        <Box mb="3">
          <Code
            language="sql"
            code={group.factTable.sql}
            showLineNumbers={false}
          />
        </Box>
      )}
      <Table variant="list">
        <TableHeader>
          <TableRow data-no-hover>
            <TableColumnHeader style={{ width: 40 }} />
            <TableColumnHeader>Metric</TableColumnHeader>
            <TableColumnHeader>Type</TableColumnHeader>
            <TableColumnHeader>Tags</TableColumnHeader>
            <TableColumnHeader>Projects</TableColumnHeader>
            <TableColumnHeader>Created</TableColumnHeader>
            <TableColumnHeader>Owner</TableColumnHeader>
            <TableColumnHeader style={{ width: 90 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.metrics.map((metric) => {
            const legacy = legacyById.get(legacyIdOf(metric));
            const isExpanded = expanded.has(metric.id);
            return (
              <Fragment key={metric.id}>
                <TableRow data-no-hover>
                  <TableCell>
                    <Checkbox
                      value={selected.has(metric.id)}
                      disabled={disabled}
                      setValue={(checked) => onToggle([metric.id], checked)}
                    />
                  </TableCell>
                  <TableCell>
                    {legacy ? (
                      <Link href={`/metric/${legacy.id}`}>{metric.name}</Link>
                    ) : (
                      metric.name
                    )}
                  </TableCell>
                  <TableCell>{metric.metricType}</TableCell>
                  <TableCell>
                    <SortedTags tags={metric.tags} useFlex />
                  </TableCell>
                  <TableCell>
                    <ProjectBadges
                      resourceType="metric"
                      projectIds={metric.projects}
                    />
                  </TableCell>
                  <TableCell>
                    {legacy?.dateCreated ? date(legacy.dateCreated) : ""}
                  </TableCell>
                  <TableCell>{getOwnerDisplay(metric.owner)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const next = new Set(expanded);
                        if (isExpanded) next.delete(metric.id);
                        else next.add(metric.id);
                        setExpanded(next);
                      }}
                    >
                      {isExpanded ? "Hide" : "Details"}
                    </Button>
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow data-no-hover>
                    <TableCell colSpan={8}>
                      <MetricDetails metric={metric} legacy={legacy} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Frame>
  );
}

function MetricDetails({
  metric,
  legacy,
}: {
  metric: FactMetricInterface;
  legacy?: MetricInterface;
}) {
  const numerator = metric.numerator;
  const window = metric.windowSettings;
  const legacySettings: [string, string][] = [
    ["Type", legacy?.type || ""],
    ...(legacy?.aggregation
      ? [["Aggregation", legacy.aggregation] as [string, string]]
      : []),
  ];
  const settings: [string, string][] = [
    ["Type", metric.metricType],
    [
      "Value",
      metric.metricType === "funnel"
        ? `${metric.funnelSettings?.steps.length} step funnel: ${metric.funnelSettings?.steps.map((s) => s.name).join(" → ")}`
        : `${numerator?.column}${numerator?.aggregation ? ` (${numerator.aggregation})` : ""}`,
    ],
    [
      "Row filters",
      numerator?.rowFilters?.length
        ? numerator.rowFilters
            .map(
              (f) =>
                `${f.column ?? ""} ${f.operator} ${(f.values || []).join(", ")}`,
            )
            .join("; ")
        : "none",
    ],
    ...(metric.denominator
      ? [
          [
            "Denominator",
            `${metric.denominator.column}${metric.denominator.aggregation ? ` (${metric.denominator.aggregation})` : ""}${metric.denominator.aggregateFilter ? `, users where ${metric.denominator.aggregateFilterColumn} ${metric.denominator.aggregateFilter}` : ""}`,
          ] as [string, string],
        ]
      : []),
    [
      "Conversion window",
      window.type
        ? `${window.type}: ${window.windowValue} ${window.windowUnit}${window.delayValue ? `, delay ${window.delayValue} ${window.delayUnit}` : ""}`
        : "none",
    ],
    [
      "Capping",
      metric.cappingSettings.type
        ? `${metric.cappingSettings.type} ${metric.cappingSettings.value}`
        : "none",
    ],
    ["Inverse", metric.inverse ? "yes" : "no"],
  ];
  return (
    <Grid columns="2" gap="5" width="100%">
      <Box minWidth="0" pr="5" className="border-right">
        <Text size="lg" weight="semibold" as="p">
          Legacy metric
        </Text>
        <SettingList settings={legacySettings} />
        <Code language="sql" code={legacy?.sql || ""} showLineNumbers={false} />
      </Box>
      <Box minWidth="0">
        <Text size="lg" weight="semibold" as="p">
          New Fact Metric
        </Text>
        <SettingList settings={settings} />
      </Box>
    </Grid>
  );
}

function SettingList({ settings }: { settings: [string, string][] }) {
  return (
    <>
      {settings.map(([label, value]) => (
        <Flex key={label} gap="2" mb="1">
          <Text size="sm" weight="medium">
            {label}:
          </Text>
          <Text size="sm">{value}</Text>
        </Flex>
      ))}
    </>
  );
}
