import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { getFactMetricFactTableIds } from "shared/experiments";
import { hasStartDateFilter } from "shared/sql";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBEdit } from "@/components/Icons";
import { useAuth } from "@/services/auth";
import Code from "@/components/SyntaxHighlighting/Code";
import ColumnList from "@/components/FactTables/ColumnList";
import AggregatedFactTablesCard from "@/components/FactTables/AggregatedFactTablesCard";
import FactFilterList from "@/components/FactTables/FactFilterList";
import VirtualColumnList from "@/components/FactTables/VirtualColumnList";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import SortedTags from "@/components/Tags/SortedTags";
import FactMetricList from "@/components/FactTables/FactMetricList";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { usesEventName } from "@/components/Metrics/MetricForm";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import { useUser } from "@/services/UserContext";
import OpenInExplorerButton from "@/enterprise/components/ProductAnalytics/OpenInExplorerButton";
import { DocLink } from "@/components/DocLink";
import FactTableDetailsPage from "@/components/FactTables/FactTableDetailsPage";
import useFactTableDetailsPage, {
  FactTablePageData,
} from "@/hooks/useFactTableDetailsPage";
import useFactTableActions from "@/hooks/useFactTableActions";

export function getMetricsForFactTable(
  factMetrics: FactMetricInterface[],
  factTable: string,
) {
  return factMetrics.filter((m) =>
    getFactMetricFactTableIds(m).includes(factTable),
  );
}

export default function FactTablePage() {
  const newPage = useFeatureIsOn("new-fact-table-page");
  const page = useFactTableDetailsPage();

  if (page.status === "loading") return <LoadingOverlay />;
  if (page.status === "missing") {
    return (
      <Callout status="error">
        Could not find the requested Fact Table.{" "}
        <Link href="/fact-tables">Back to all Fact Tables</Link>
      </Callout>
    );
  }
  return newPage ? (
    <FactTableDetailsPage page={page} />
  ) : (
    <LegacyFactTablePage page={page} />
  );
}

function LegacyFactTablePage({ page }: { page: FactTablePageData }) {
  const {
    factTable,
    metrics,
    datasource,
    canEdit,
    canOpenInExplorer,
    canEditColumns,
  } = page;
  const actions = useFactTableActions(page);

  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { getOwnerDisplay } = useUser();
  const { mutateDefinitions, getProjectById, projects } = useDefinitions();

  const numMetrics = metrics.length;
  const numFilters = factTable.filters.length;
  const numVirtualColumns = factTable.columns.filter(
    (c) => c.isVirtual && !c.deleted,
  ).length;

  return (
    <div className="pagecontents container-fluid">
      {actions.modals}
      {editOwnerModal && (
        <EditOwnerModal
          cancel={() => setEditOwnerModal(false)}
          owner={factTable.owner}
          save={async (owner) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
          }}
          mutate={mutateDefinitions}
        />
      )}
      {editProjectsOpen && (
        <EditProjectsForm
          label={
            <>
              Projects{" "}
              <Tooltip
                body={
                  "The dropdown below has been filtered to only include projects where you have permission to update Fact Tables"
                }
              />
            </>
          }
          value={factTable.projects}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateFactTable({ projects: [project] }, {})
          }
          cancel={() => setEditProjectsOpen(false)}
          save={async (projects) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
          }}
          mutate={mutateDefinitions}
          entityName="Fact Table"
        />
      )}
      {editTagsModal && (
        <EditTagsForm
          tags={factTable.tags}
          save={async (tags) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({ tags }),
            });
          }}
          cancel={() => setEditTagsModal(false)}
          mutate={mutateDefinitions}
          source="ftid"
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Fact Tables", href: "/fact-tables" },
          { display: factTable.name },
        ]}
      />

      {factTable.archived && (
        <Callout status="info" mb="2">
          <strong>This Fact Table is archived.</strong> Existing references will
          continue working, but you will be unable to add metrics from this Fact
          Table to new experiments.
        </Callout>
      )}
      <Flex align="start" justify="between" gap="2" mb="2">
        <Flex align="center" gap="3" style={{ marginTop: "-4px" }}>
          <Heading size="xl" as="h1" overflowWrap="anywhere" mb="0">
            {factTable.name}
            <OfficialBadge
              ml="2"
              type="Fact Table"
              managedBy={factTable.managedBy}
            />
          </Heading>
        </Flex>
        <Flex align="center" gap="2" pr="2">
          <OpenInExplorerButton
            enabled={canOpenInExplorer}
            href={`/product-analytics/explore/fact-table?factTableId=${encodeURIComponent(
              factTable.id,
            )}`}
            tooltip="Open this Fact Table in the Product Analytics Explorer and view trends, compare time periods, and slice/dice your data."
          />
          {actions.menu}
        </Flex>
      </Flex>
      <Flex gap="4" align="center" wrap="wrap">
        {projects.length > 0 && (
          <Metadata
            label="Projects"
            value={
              <Flex gap="1" align="center">
                {factTable.projects.length > 0 ? (
                  <Text weight="regular" color="text-mid">
                    {factTable.projects
                      .map((p) => getProjectById(p)?.name || p)
                      .join(", ")}
                  </Text>
                ) : (
                  <Text weight="regular" color="text-mid" fontStyle="italic">
                    All Projects
                  </Text>
                )}
                {canEdit && (
                  <Link
                    onClick={(e) => {
                      e.preventDefault();
                      setEditProjectsOpen(true);
                    }}
                  >
                    <GBEdit />
                  </Link>
                )}
              </Flex>
            }
          />
        )}
        {(factTable.owner || canEdit) && (
          <Metadata
            label="Owner"
            value={
              <Flex gap="1" align="center">
                <Text weight="regular" color="text-mid">
                  {getOwnerDisplay(factTable.owner) || "None"}
                </Text>
                {canEdit && (
                  <Link onClick={() => setEditOwnerModal(true)}>
                    <GBEdit />
                  </Link>
                )}
              </Flex>
            }
          />
        )}
        <Metadata
          label="Data source"
          value={
            <Link
              href={`/datasources/${factTable.datasource}`}
              className="font-weight-bold"
            >
              {datasource?.name || "Unknown"}
            </Link>
          }
        />
      </Flex>
      <Box mt="3" mb="3">
        {factTable.tags?.length || canEdit ? (
          <Flex align="center" gap="1">
            <Text weight="medium">Tags:</Text>
            {factTable.tags?.length ? (
              <SortedTags
                tags={factTable.tags}
                useFlex
                shouldShowEllipsis={false}
              />
            ) : null}
            {canEdit && (
              <Link onClick={() => setEditTagsModal(true)}>
                <GBEdit />
              </Link>
            )}
          </Flex>
        ) : null}
      </Box>

      <Frame px="5" pt="3" pb="4">
        <MarkdownInlineEdit
          canEdit={canEdit}
          canCreate={canEdit}
          value={factTable.description}
          save={async (description) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({
                description,
              }),
            });
            mutateDefinitions();
          }}
        />
      </Frame>

      <div className="row mb-4">
        <div className="col col-md-6 d-flex flex-column">
          <h3>SQL Definition</h3>
          <Code
            code={factTable.sql}
            language="sql"
            containerClassName="m-0 flex-1"
            className="flex-1"
            maxHeight="405px"
            filename={
              canEdit ? (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    actions.openEditSql();
                  }}
                >
                  Edit SQL <GBEdit />
                </a>
              ) : (
                "SQL"
              )
            }
          />
          {usesEventName(factTable.sql) && (
            <div className="p-2 bg-light border border-top-0">
              <strong>eventName</strong> = <code>{factTable.eventName}</code>
            </div>
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
        </div>
        <div className="col col-md-6 d-flex flex-column">
          <h3>Columns</h3>
          <div className="appbox p-3 flex-1 mb-0">
            <ColumnList factTable={factTable} canEdit={canEditColumns} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="metrics" persistInURL>
        <TabsList>
          <TabsTrigger value="metrics">
            Metrics{" "}
            <Badge
              label={numMetrics + ""}
              color="violet"
              ml="1"
              radius="full"
            />
          </TabsTrigger>
          <TabsTrigger value="filters">
            Saved Filters{" "}
            <Badge
              label={numFilters + ""}
              color="violet"
              ml="1"
              radius="full"
            />
          </TabsTrigger>
          <TabsTrigger value="virtual-columns">
            Virtual Columns{" "}
            <Badge
              label={numVirtualColumns + ""}
              color="violet"
              ml="1"
              radius="full"
            />
          </TabsTrigger>
        </TabsList>

        <Box pt="4">
          <TabsContent value="metrics">
            <h3>Metrics</h3>
            <div className="mb-5">
              <Text as="div" mb="2" color="text-mid">
                Metrics are built on top of Columns and Filters. These are what
                you use as Goals and Guardrails in experiments. This page only
                shows metrics tied to this Fact Table.{" "}
                <Link href="/metrics">View all Metrics</Link>
              </Text>
              <div className="appbox p-3">
                <FactMetricList factTable={factTable} metrics={metrics} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="filters">
            <h3>Saved Filters</h3>
            <Text as="div" mb="2" color="text-mid">
              Saved Filters let you write SQL to limit the rows that are
              included in a metric. Save commonly used filters here and reuse
              them across multiple metrics.
            </Text>
            <div className="appbox p-3 flex-1">
              <FactFilterList factTable={factTable} />
            </div>
          </TabsContent>

          <TabsContent value="virtual-columns">
            <h3>Virtual Columns</h3>
            <Text as="div" mb="2" color="text-mid">
              Virtual Columns let you define computed columns from your existing
              fact table columns — arithmetic on numbers, concatenation on
              strings, date math, or any expression that can be computed from a
              single row. Once created, a virtual column can be used in Fact
              Metrics, row filters, and slices.
            </Text>
            <div className="appbox p-3 flex-1">
              <VirtualColumnList factTable={factTable} />
            </div>
          </TabsContent>
        </Box>
      </Tabs>

      <AggregatedFactTablesCard factTable={factTable} />
    </div>
  );
}
