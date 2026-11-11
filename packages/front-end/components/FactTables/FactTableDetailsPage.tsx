import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { hasStartDateFilter, usesBackslashStringEscapes } from "shared/sql";
import { getDataSourceSqlDialect } from "shared/dialects";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Metadata from "@/ui/Metadata";
import SortedTags from "@/components/Tags/SortedTags";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Heading from "@/ui/Heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import {
  getEventColumns,
  getMetricsForEvent,
} from "@/services/factTableEvents";
import { getSqlSummaryTokens } from "@/services/sqlSummary";
import { formatSql } from "@/services/sqlFormatter";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useColumnValueCounts from "@/hooks/useColumnValueCounts";
import useFactTableActions from "@/hooks/useFactTableActions";
import useURLHash from "@/hooks/useURLHash";
import { FactTablePageData } from "@/hooks/useFactTableDetailsPage";
import PageHead from "@/components/Layout/PageHead";
import Markdown from "@/components/Markdown/Markdown";
import Code from "@/components/SyntaxHighlighting/Code";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { usesEventName } from "@/components/Metrics/MetricForm";
import { DocLink } from "@/components/DocLink";
import OpenInExplorerButton from "@/enterprise/components/ProductAnalytics/OpenInExplorerButton";
import FactTableDetailsModal from "./FactTableDetailsModal";
import FactTableColumnsTab from "./FactTableColumnsTab";
import FactTableFiltersTab from "./FactTableFiltersTab";
import FactTableMetricsTab from "./FactTableMetricsTab";
import AggregatedFactTablesCard from "./AggregatedFactTablesCard";
import FactTableEventsTab from "./FactTableEventsTab";
import FactTableSampleRows from "./FactTableSampleRows";
import styles from "./FactTableDetailsPage.module.scss";
import FactTableRowsPerDay from "./FactTableRowsPerDay";

// One line of SQL with SELECT lists shortened, colored like the full SQL view
function SqlSummary({
  sql,
  backslashEscapes,
}: {
  sql: string;
  backslashEscapes: boolean;
}) {
  return (
    <span className={styles.sqlLine}>
      {getSqlSummaryTokens(sql, backslashEscapes).map((t, i) => (
        <span
          key={i}
          className={t.kind === "other" ? undefined : styles[t.kind]}
        >
          {(t.spaceBefore ? " " : "") + t.text}
        </span>
      ))}
    </span>
  );
}

function TabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <>
      {label}
      {count !== undefined ? (
        <Badge label={count + ""} color="violet" ml="1" radius="full" />
      ) : null}
    </>
  );
}

export default function FactTableDetailsPage({
  page,
}: {
  page: FactTablePageData;
}) {
  const { factTable, datasource, canEdit, canOpenInExplorer } = page;
  // Archived metrics are hidden everywhere on this page, so event metric
  // buttons and "+N more" always land on a visible row
  const metrics = page.metrics.filter((m) => !m.archived);
  const actions = useFactTableActions(page);
  const [editOpen, setEditOpen] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const permissionsUtil = usePermissionsUtil();
  const { getOwnerDisplay } = useUser();
  const { getProjectById, projects } = useDefinitions();

  const valueCounts = useColumnValueCounts(factTable.id);
  // The tab lives in the URL hash so links like #metrics keep working
  const [hash, setTab] = useURLHash();
  // Set by an event's "+N more" link; narrows the Metrics tab to that event
  const [metricsEvent, setMetricsEvent] = useState<{
    column: string;
    value: string;
  } | null>(null);
  // Set by an event's metric button; marks that row on the Metrics tab
  const [highlightMetric, setHighlightMetric] = useState<string | null>(null);

  // `?filter=<id>` links to one Saved Filter, which that tab highlights
  const router = useRouter();
  const linkedFilter = router.query.filter;
  useEffect(() => {
    if (typeof linkedFilter === "string") setTab("filters");
  }, [linkedFilter, setTab]);

  const eventColumns = getEventColumns(factTable);
  const tabs = [
    ...(eventColumns.length > 0 ? ["events"] : []),
    "columns",
    "sample",
    "filters",
    "metrics",
  ];
  // The legacy page has its own Virtual Columns tab; here they're on Columns
  const linkedTab = hash === "virtual-columns" ? "columns" : hash;
  const tab = linkedTab && tabs.includes(linkedTab) ? linkedTab : tabs[0];
  const dialect = datasource ? getDataSourceSqlDialect(datasource.type) : null;
  // The top-values endpoint behind row counts checks the column permission
  const canLoadCounts = page.canEditColumns && canOpenInExplorer;

  const numColumns = factTable.columns.filter((c) => !c.deleted).length;

  return (
    <div className={`pagecontents ${styles.page}`}>
      {editOpen && (
        <FactTableDetailsModal
          close={() => setEditOpen(false)}
          factTable={factTable}
        />
      )}
      {actions.modals}
      <PageHead
        breadcrumb={[
          { display: "Fact Tables", href: "/fact-tables" },
          { display: factTable.name },
        ]}
      />

      {factTable.archived && (
        <Callout status="info" mb="3">
          <strong>This Fact Table is archived.</strong> Existing metrics keep
          working, but they can&apos;t be added to new experiments.
        </Callout>
      )}

      <Flex align="start" justify="between" gap="3" mb="2">
        <Heading size="xl" as="h1" overflowWrap="anywhere" mb="0">
          {factTable.name}
          <OfficialBadge
            ml="2"
            type="Fact Table"
            managedBy={factTable.managedBy}
          />
        </Heading>
        <Flex align="center" gap="3">
          {canOpenInExplorer && (
            <OpenInExplorerButton
              enabled
              href={`/product-analytics/explore/fact-table?factTableId=${encodeURIComponent(
                factTable.id,
              )}`}
              tooltip="Open this Fact Table in the Product Analytics Explorer and view trends, compare time periods, and slice/dice your data."
            />
          )}
          {actions.menu}
        </Flex>
      </Flex>

      {factTable.description ? (
        <Box mb="3">
          <Markdown>{factTable.description}</Markdown>
        </Box>
      ) : null}

      <Flex gap="4" align="center" wrap="wrap" mb="4">
        <Metadata
          label="Data source"
          value={
            <Link href={`/datasources/${factTable.datasource}`}>
              {datasource?.name || "Unknown data source"}
            </Link>
          }
        />
        {eventColumns.length > 0 && (
          <Text color="text-mid">
            Event stream, typed by{" "}
            {eventColumns.map((c, i) => (
              <span key={c.column}>
                {i > 0 ? ", " : ""}
                <span className={styles.mono}>{c.column}</span>
              </span>
            ))}
          </Text>
        )}
        {projects.length > 0 && (
          <Metadata
            label="Projects"
            value={
              factTable.projects.length > 0
                ? factTable.projects
                    .map((p) => getProjectById(p)?.name || p)
                    .join(", ")
                : "All Projects"
            }
          />
        )}
        <Metadata
          label="Owner"
          value={getOwnerDisplay(factTable.owner) || "None"}
        />
        {factTable.tags?.length ? (
          <Metadata
            label="Tags"
            value={<SortedTags tags={factTable.tags} useFlex />}
          />
        ) : null}
        {canEdit && <Link onClick={() => setEditOpen(true)}>Edit details</Link>}
      </Flex>

      <Frame px="3" py="2" mb="4">
        <CollapseTrigger
          open={showSql}
          onOpenChange={setShowSql}
          caret="start"
          action={
            canEdit ? (
              <Button
                variant="outline"
                size="sm"
                style={{ whiteSpace: "nowrap" }}
                onClick={actions.openEditSql}
              >
                Edit SQL
              </Button>
            ) : undefined
          }
        >
          <SqlSummary
            sql={factTable.sql}
            backslashEscapes={!!dialect && usesBackslashStringEscapes(dialect)}
          />
        </CollapseTrigger>
        <Collapse open={showSql}>
          <Box mt="3">
            <Code
              // Display only: the saved SQL keeps its own formatting
              code={
                formatSql(factTable.sql, datasource?.type).formattedSql ??
                factTable.sql
              }
              language="sql"
              maxHeight="405px"
              wrapLongLines
            />
          </Box>
        </Collapse>
        {usesEventName(factTable.sql) && (
          <Text as="div" mt="2" color="text-mid">
            <strong>eventName</strong> = <code>{factTable.eventName}</code>
          </Text>
        )}
        {!hasStartDateFilter(factTable.sql) && (
          <Callout
            status="warning"
            mt="3"
            action={
              <DocLink docSection="queryOptimization" useRadix>
                Learn more
              </DocLink>
            }
          >
            This SQL has no <code>{"{{startDate}}"}</code> filter, so queries
            may scan the whole table.
          </Callout>
        )}
      </Frame>

      {datasource &&
        permissionsUtil.canRunProductAnalyticsExplorationQueries(
          datasource,
          "fact_table",
        ) && <FactTableRowsPerDay factTable={factTable} />}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          if (value !== "metrics") {
            setMetricsEvent(null);
            setHighlightMetric(null);
          }
        }}
      >
        <TabsList>
          {eventColumns.length > 0 && (
            <TabsTrigger value="events">
              <TabLabel label="Events" />
            </TabsTrigger>
          )}
          <TabsTrigger value="columns">
            <TabLabel label="Columns" count={numColumns} />
          </TabsTrigger>
          <TabsTrigger value="sample">
            <TabLabel label="Sample rows" />
          </TabsTrigger>
          <TabsTrigger value="filters">
            <TabLabel label="Saved Filters" count={factTable.filters.length} />
          </TabsTrigger>
          <TabsTrigger value="metrics">
            <TabLabel label="Metrics" count={metrics.length} />
          </TabsTrigger>
        </TabsList>

        {/* A full viewport of height keeps a short or loading tab from
            shrinking the page, which made the browser scroll to the top */}
        <Box pt="4" minHeight="100vh">
          {eventColumns.length > 0 && (
            <TabsContent value="events">
              <FactTableEventsTab
                factTable={factTable}
                eventColumns={eventColumns}
                metrics={metrics}
                valueCounts={valueCounts}
                canRefresh={canLoadCounts}
                onShowMetrics={(column, value) => {
                  setMetricsEvent({ column, value });
                  setHighlightMetric(null);
                  setTab("metrics");
                }}
                onSelectMetric={(id) => {
                  setMetricsEvent(null);
                  setHighlightMetric(id);
                  setTab("metrics");
                }}
              />
            </TabsContent>
          )}

          <TabsContent value="columns">
            <FactTableColumnsTab
              factTable={factTable}
              canEdit={page.canEditColumns}
              canLoadCounts={canLoadCounts}
              valueCounts={valueCounts}
            />
          </TabsContent>

          <TabsContent value="sample">
            <FactTableSampleRows factTableId={factTable.id} />
          </TabsContent>

          <TabsContent value="filters">
            <FactTableFiltersTab factTable={factTable} />
          </TabsContent>

          <TabsContent value="metrics">
            {metricsEvent ? (
              <Flex align="center" gap="3" mb="3">
                <Text color="text-mid">
                  Showing Fact Metrics that use{" "}
                  <code>{metricsEvent.value}</code>
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMetricsEvent(null)}
                >
                  Show all
                </Button>
              </Flex>
            ) : null}
            <FactTableMetricsTab
              factTable={factTable}
              eventColumns={eventColumns}
              highlightId={highlightMetric}
              metrics={
                metricsEvent
                  ? getMetricsForEvent(
                      metrics,
                      factTable.id,
                      metricsEvent.column,
                      metricsEvent.value,
                    )
                  : metrics
              }
            />
          </TabsContent>
        </Box>
      </Tabs>

      <AggregatedFactTablesCard factTable={factTable} />
    </div>
  );
}
