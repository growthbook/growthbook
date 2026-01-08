import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  FactTableInterface,
  FactMetricInterface,
} from "back-end/types/fact-table";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBEdit } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import FactTableModal from "@/components/FactTables/FactTableModal";
import Code from "@/components/SyntaxHighlighting/Code";
import ColumnList from "@/components/FactTables/ColumnList";
import FactFilterList from "@/components/FactTables/FactFilterList";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import SortedTags from "@/components/Tags/SortedTags";
import FactMetricList from "@/components/FactTables/FactMetricList";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { usesEventName } from "@/components/Metrics/MetricForm";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import OfficialResourceModal from "@/components/OfficialResourceModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import EditFactTableSQLModal from "@/components/FactTables/EditFactTableSQLModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import { useUser } from "@/services/UserContext";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import Callout from "@/ui/Callout";
import ApprovalFlowList from "@/components/ApprovalFlow/ApprovalFlowList";
import { useApprovalFlowsEntityId } from "@/hooks/useApprovalFlows";

export function getMetricsForFactTable(
  factMetrics: FactMetricInterface[],
  factTable: string,
) {
  return factMetrics.filter(
    (m) =>
      m.numerator.factTableId === factTable ||
      (m.denominator && m.denominator.factTableId === factTable),
  );
}

export default function FactTablePage() {
  const router = useRouter();
  const { ftid, tab: queryTab } = router.query;

  const [editOpen, setEditOpen] = useState(false);
  const [editSQLOpen, setEditSQLOpen] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [showConvertToOfficialModal, setShowConvertToOfficialModal] =
    useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);

  const [duplicateFactTable, setDuplicateFactTable] = useState<
    FactTableInterface | undefined
  >();

  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature, organization } = useUser();

  const {
    getFactTableById,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    _factMetricsIncludingArchived: factMetrics,
    getDatasourceById,
  } = useDefinitions();
  const factTable = getFactTableById(ftid as string);

  const metrics = getMetricsForFactTable(factMetrics, factTable?.id || "");

  // Fetch approval flows for this fact table
  const {
    approvalFlows,
    isLoading: approvalFlowsLoading,
    mutate: mutateApprovalFlows,
  } = useApprovalFlowsEntityId("fact-table", ftid as string);

  if (!ready) return <LoadingOverlay />;

  if (!factTable) {
    return (
      <div className="alert alert-danger">
        Could not find the requested fact table.{" "}
        <Link href="/fact-tables">Back to all fact tables</Link>
      </div>
    );
  }
  const canDuplicate = permissionsUtil.canCreateFactTable({
    projects: factTable.projects,
  });

  let canEdit = permissionsUtil.canUpdateFactTable(factTable, factTable);
  let canDelete = permissionsUtil.canDeleteFactTable(factTable);

  if (factTable.managedBy && ["api", "config"].includes(factTable.managedBy)) {
    canEdit = false;
    canDelete = false;
  }

  // Editing columns is less restrictive than editing the whole fact table
  const canEditColumns = permissionsUtil.canUpdateFactTable(factTable, {
    columns: [],
  });

  const numMetrics = metrics.length;
  const numFilters = factTable.filters.length;

  return (
    <div className="pagecontents container-fluid">
      {editOpen && (
        <FactTableModal close={() => setEditOpen(false)} existing={factTable} />
      )}
      {duplicateFactTable && (
        <FactTableModal
          close={() => setDuplicateFactTable(undefined)}
          existing={duplicateFactTable}
          duplicate
        />
      )}
      {editSQLOpen && (
        <EditFactTableSQLModal
          close={() => setEditSQLOpen(false)}
          factTable={factTable}
          save={async (data) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
            await mutateDefinitions();
          }}
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          resourceType="factTable"
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
      <PageHead
        breadcrumb={[
          { display: "Fact Tables", href: "/fact-tables" },
          { display: factTable.name },
        ]}
      />

      {factTable.projects?.includes(
        getDemoDatasourceProjectIdForOrganization(organization.id),
      ) && (
        <Callout status="info" contentsAs="div" mb="2">
          <Flex align="center" justify="between">
            <Text>
              This Fact Table is part of our sample dataset. You can safely
              delete this once you are done exploring.
            </Text>
            <Box ml="auto">
              <DeleteDemoDatasourceButton
                onDelete={() => router.push("/fact-tables")}
                source="fact-table"
              />
            </Box>
          </Flex>
        </Callout>
      )}

      {factTable.archived && (
        <div className="alert alert-secondary mb-2">
          <strong>This Fact Table is archived.</strong> Existing references will
          continue working, but you will be unable to add metrics from this Fact
          Table to new experiments.
        </div>
      )}
      <div className="row mb-3">
        <div className="col-auto">
          <h1 className="mb-0">
            {factTable.name}{" "}
            <OfficialBadge type="Fact Table" managedBy={factTable.managedBy} />
          </h1>
        </div>
        <div className="ml-auto">
          <MoreMenu>
            {canEdit && (
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setEditOpen(true);
                }}
              >
                Edit Fact Table
              </button>
            )}
            {!factTable.managedBy &&
            canEdit &&
            permissionsUtil.canCreateOfficialResources(factTable) &&
            hasCommercialFeature("manage-official-resources") ? (
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setShowConvertToOfficialModal(true);
                }}
              >
                Convert to Official Fact Table
              </button>
            ) : null}
            {canDuplicate && (
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setDuplicateFactTable({
                    ...factTable,
                    name: `${factTable.name} (Copy)`,
                    managedBy:
                      factTable.managedBy === "admin" &&
                      permissionsUtil.canCreateOfficialResources(factTable)
                        ? "admin"
                        : "",
                  });
                }}
              >
                Duplicate Fact Table
              </button>
            )}
            {canEdit && (
              <button
                className="dropdown-item"
                onClick={async () => {
                  await apiCall(
                    `/fact-tables/${factTable.id}/${
                      factTable.archived ? "unarchive" : "archive"
                    }`,
                    {
                      method: "POST",
                    },
                  );
                  mutateDefinitions();
                }}
              >
                {factTable.archived ? "Unarchive" : "Archive"} Fact Table
              </button>
            )}
            {canDelete && (
              <DeleteButton
                className="dropdown-item"
                displayName="Fact Table"
                useIcon={false}
                text="Delete Fact Table"
                onClick={async () => {
                  await apiCall(`/fact-tables/${factTable.id}`, {
                    method: "DELETE",
                  });
                  mutateDefinitions();
                  router.push("/fact-tables");
                }}
              />
            )}
          </MoreMenu>
        </div>
      </div>
      <div className="row mb-3">
        {projects.length > 0 ? (
          <div className="col-auto">
            Projects:{" "}
            {factTable.projects.length > 0 ? (
              factTable.projects.map((p) => (
                <span className="badge badge-secondary mr-1" key={p}>
                  {getProjectById(p)?.name || p}
                </span>
              ))
            ) : (
              <em className="mr-1">All Projects</em>
            )}
            {canEdit && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setEditProjectsOpen(true);
                }}
              >
                <GBEdit />
              </a>
            )}
          </div>
        ) : null}
        <div className="col-auto">
          Tags: <SortedTags tags={factTable.tags} />
          {canEdit && (
            <a
              className="ml-1 cursor-pointer"
              onClick={() => setEditTagsModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </div>
        {(factTable.owner || canEdit) && (
          <div className="col-auto">
            Owner: {factTable.owner}
            {canEdit && (
              <a
                className="ml-1 cursor-pointer"
                onClick={() => setEditOwnerModal(true)}
              >
                <GBEdit />
              </a>
            )}
          </div>
        )}
        <div className="col-auto">
          Data source:{" "}
          <Link
            href={`/datasources/${factTable.datasource}`}
            className="font-weight-bold"
          >
            {getDatasourceById(factTable.datasource)?.name || "Unknown"}
          </Link>
        </div>
      </div>

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
                    setEditSQLOpen(true);
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
        </div>
        <div className="col col-md-6 d-flex flex-column">
          <h3>Columns</h3>
          <div className="appbox p-3 flex-1 mb-0">
            <ColumnList factTable={factTable} canEdit={canEditColumns} />
          </div>
        </div>
      </div>

      <Tabs defaultValue={(queryTab as string) || "metrics"}>
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
          <TabsTrigger value="approvals">
            Approvals
            {approvalFlows.length > 0 && (
              <Badge
                label={approvalFlows.length + ""}
                color="red"
                ml="1"
                radius="full"
              />
            )}
          </TabsTrigger>
        </TabsList>

        <Box pt="4">
          <TabsContent value="metrics">
            <h3>Metrics</h3>
            <div className="mb-5">
              <Text as="div" mb="2" color="gray">
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
            <h3>Row Filters</h3>
            <Text as="div" mb="2" color="gray">
              Row Filters let you write SQL to limit the rows that are included
              in a metric. Save commonly used filters here and reuse them across
              multiple metrics.
            </Text>
            <div className="appbox p-3 flex-1">
              <FactFilterList factTable={factTable} />
            </div>
          </TabsContent>

          <TabsContent value="approvals">
            <ApprovalFlowList
              approvalFlows={approvalFlows}
              onUpdate={() => {
                mutateApprovalFlows();
                mutateDefinitions();
              }}
              loading={approvalFlowsLoading}
            />
          </TabsContent>
        </Box>
      </Tabs>
    </div>
  );
}
