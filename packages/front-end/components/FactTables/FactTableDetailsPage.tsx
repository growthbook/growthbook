import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiCaretRightBold } from "react-icons/pi";
import { FactTableInterface } from "shared/types/fact-table";
import { hasStartDateFilter, usesBackslashStringEscapes } from "shared/sql";
import { getFactMetricFactTableIds } from "shared/experiments";
import { getDataSourceSqlDialect } from "shared/dialects";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import {
  getEventColumns,
  getMetricsForEvent,
  getSqlSummaryTokens,
} from "@/services/factTables";
import { formatSql } from "@/services/sqlFormatter";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useColumnValueCounts from "@/hooks/useColumnValueCounts";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Markdown from "@/components/Markdown/Markdown";
import Code from "@/components/SyntaxHighlighting/Code";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HistoryTable from "@/components/HistoryTable";
import OfficialResourceModal from "@/components/OfficialResourceModal";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { usesEventName } from "@/components/Metrics/MetricForm";
import { DocLink } from "@/components/DocLink";
import OpenInExplorerButton from "@/enterprise/components/ProductAnalytics/OpenInExplorerButton";
import FactTableDetailsModal from "./FactTableDetailsModal";
import NewFactTableModal from "./NewFactTableModal";
import FactTableColumnsTab from "./FactTableColumnsTab";
import FactFilterList from "./FactFilterList";
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

export default function FactTableDetailsPage() {
  const router = useRouter();
  const { ftid } = router.query;

  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editSQLOpen, setEditSQLOpen] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [showConvertToOfficialModal, setShowConvertToOfficialModal] =
    useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [duplicateFactTable, setDuplicateFactTable] = useState<
    FactTableInterface | undefined
  >();

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature, getOwnerDisplay } = useUser();
  const {
    getFactTableById,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    _factMetricsIncludingArchived: factMetrics,
    getDatasourceById,
  } = useDefinitions();

  // Definitions only contain a slimmed fact table (no sql or per-column
  // jsonFields), so fetch the full version for this page
  const factTableDefinition = getFactTableById(ftid as string);
  const {
    data,
    error: factTableError,
    mutate: mutateFactTable,
  } = useApi<{ factTable: FactTableInterface }>(`/fact-tables/${ftid}`, {
    shouldRun: () => !!ftid,
  });
  const factTable = data?.factTable;

  // Child modals refresh definitions after saving; cascade that to the full
  // fact table fetch. Keyed off the whole definition because background column
  // refreshes update columns without bumping dateUpdated.
  useEffect(() => {
    mutateFactTable();
  }, [factTableDefinition, mutateFactTable]);

  const valueCounts = useColumnValueCounts(factTable?.id || "");
  const [tab, setTab] = useState<string | null>(null);
  // Set by an event's "+N more" link; narrows the Metrics tab to that event
  const [metricsEvent, setMetricsEvent] = useState<{
    column: string;
    value: string;
  } | null>(null);

  if (!ready || (!data && !factTableError)) return <LoadingOverlay />;

  if (!factTable) {
    return (
      <Callout status="error">
        Could not find the requested Fact Table.{" "}
        <Link href="/fact-tables">Back to all Fact Tables</Link>
      </Callout>
    );
  }

  const metrics = factMetrics.filter((m) =>
    getFactMetricFactTableIds(m).includes(factTable.id),
  );
  const eventColumns = getEventColumns(factTable);
  const datasource = getDatasourceById(factTable.datasource);
  const dialect = datasource ? getDataSourceSqlDialect(datasource.type) : null;
  const canOpenInExplorer = datasource
    ? permissionsUtil.canRunFactQueries(datasource)
    : false;
  const canDuplicate = permissionsUtil.canCreateFactTable({
    projects: factTable.projects,
  });
  let canEdit = permissionsUtil.canUpdateFactTable(factTable, factTable);
  let canDelete = permissionsUtil.canDeleteFactTable(factTable);
  if (factTable.managedBy && ["api", "config"].includes(factTable.managedBy)) {
    canEdit = false;
    canDelete = false;
  }
  // Editing columns is less restrictive than editing the whole fact table.
  // The top-values endpoint behind row counts checks the same permission.
  const canEditColumns = permissionsUtil.canUpdateFactTable(factTable, {
    columns: [],
  });
  const canLoadCounts = canEditColumns && canOpenInExplorer;

  const numColumns = factTable.columns.filter((c) => !c.deleted).length;
  const closeMenu = () => setDropdownOpen(false);

  return (
    <div className={`pagecontents container-fluid ${styles.page}`}>
      {editOpen && (
        <FactTableDetailsModal
          close={() => setEditOpen(false)}
          factTable={factTable}
        />
      )}
      {settingsOpen && (
        <NewFactTableModal
          close={() => setSettingsOpen(false)}
          existing={factTable}
        />
      )}
      {duplicateFactTable && (
        <NewFactTableModal
          close={() => setDuplicateFactTable(undefined)}
          existing={duplicateFactTable}
          duplicate
        />
      )}
      {editSQLOpen && (
        <NewFactTableModal
          close={() => setEditSQLOpen(false)}
          existing={factTable}
          editSql
        />
      )}
      {showConvertToOfficialModal && (
        <OfficialResourceModal
          close={() => setShowConvertToOfficialModal(false)}
          resourceType="Fact Table"
          onSubmit={async () => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({ managedBy: "admin" }),
            });
            await mutateDefinitions();
          }}
          source="fact-table-page"
        />
      )}
      {auditModal && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="factTable" id={factTable.id} />
        </ModalStandard>
      )}
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
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
                aria-label="More actions"
              >
                <BsThreeDotsVertical size={16} />
              </IconButton>
            }
            open={dropdownOpen}
            onOpenChange={setDropdownOpen}
            menuPlacement="end"
          >
            <DropdownMenuGroup>
              {canEdit && (
                <DropdownMenuItem
                  onClick={() => {
                    setEditSQLOpen(true);
                    closeMenu();
                  }}
                >
                  Edit SQL
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem
                  onClick={() => {
                    setSettingsOpen(true);
                    closeMenu();
                  }}
                >
                  Edit settings
                </DropdownMenuItem>
              )}
              {!factTable.managedBy &&
                canEdit &&
                permissionsUtil.canCreateOfficialResources(factTable) &&
                hasCommercialFeature("manage-official-resources") && (
                  <DropdownMenuItem
                    onClick={() => {
                      setShowConvertToOfficialModal(true);
                      closeMenu();
                    }}
                  >
                    Convert to Official Fact Table
                  </DropdownMenuItem>
                )}
              {canDuplicate && (
                <DropdownMenuItem
                  onClick={() => {
                    setDuplicateFactTable({
                      ...factTable,
                      name: `${factTable.name} (Copy)`,
                      managedBy:
                        factTable.managedBy === "admin" &&
                        permissionsUtil.canCreateOfficialResources(factTable)
                          ? "admin"
                          : "",
                    });
                    closeMenu();
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  setAuditModal(true);
                  closeMenu();
                }}
              >
                Audit log
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {canEdit || canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {canEdit && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await apiCall(
                          `/fact-tables/${factTable.id}/${
                            factTable.archived ? "unarchive" : "archive"
                          }`,
                          { method: "POST" },
                        );
                        mutateDefinitions();
                        closeMenu();
                      }}
                    >
                      {factTable.archived ? "Unarchive" : "Archive"}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      color="red"
                      confirmation={{
                        confirmationTitle: "Delete Fact Table",
                        cta: "Delete",
                        submit: async () => {
                          await apiCall(`/fact-tables/${factTable.id}`, {
                            method: "DELETE",
                          });
                          mutateDefinitions();
                          router.push("/fact-tables");
                        },
                        closeDropdown: closeMenu,
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenu>
        </Flex>
      </Flex>

      {factTable.description ? (
        <Box mb="3">
          <Markdown>{factTable.description}</Markdown>
        </Box>
      ) : null}

      <Flex gap="4" align="center" wrap="wrap" mb="4">
        <Link href={`/datasources/${factTable.datasource}`}>
          {datasource?.name || "Unknown data source"}
        </Link>
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
          <Text color="text-mid">
            Projects:{" "}
            {factTable.projects.length > 0
              ? factTable.projects
                  .map((p) => getProjectById(p)?.name || p)
                  .join(", ")
              : "All Projects"}
          </Text>
        )}
        <Text color="text-mid">
          Owner: {getOwnerDisplay(factTable.owner) || "None"}
        </Text>
        {factTable.tags?.length ? (
          <Text color="text-mid">Tags: {factTable.tags.join(", ")}</Text>
        ) : null}
        {canEdit && <Link onClick={() => setEditOpen(true)}>Edit details</Link>}
      </Flex>

      <Frame px="3" py="2" mb="4">
        <Flex align="center" gap="3">
          <button
            type="button"
            className={styles.sqlBar}
            onClick={() => setShowSql(!showSql)}
            aria-expanded={showSql}
            aria-label={showSql ? "Collapse SQL" : "Expand SQL"}
          >
            <PiCaretRightBold
              className={styles.caret}
              style={{ transform: showSql ? "rotate(90deg)" : undefined }}
            />
            <SqlSummary
              sql={factTable.sql}
              backslashEscapes={
                !!dialect && usesBackslashStringEscapes(dialect)
              }
            />
          </button>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              style={{ flexShrink: 0, whiteSpace: "nowrap" }}
              onClick={() => setEditSQLOpen(true)}
            >
              Edit SQL
            </Button>
          )}
        </Flex>
        {showSql && (
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
        )}
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
        value={tab ?? (eventColumns.length > 0 ? "events" : "columns")}
        onValueChange={(value) => {
          setTab(value);
          if (value !== "metrics") setMetricsEvent(null);
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
                  setTab("metrics");
                }}
              />
            </TabsContent>
          )}

          <TabsContent value="columns">
            <FactTableColumnsTab
              factTable={factTable}
              canEdit={canEditColumns}
              canLoadCounts={canLoadCounts}
              valueCounts={valueCounts}
            />
          </TabsContent>

          <TabsContent value="sample">
            <FactTableSampleRows factTableId={factTable.id} />
          </TabsContent>

          <TabsContent value="filters">
            <FactFilterList factTable={factTable} hideSearch />
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
