import { useRouter } from "next/router";
import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  FactTableInterface,
  FactMetricInterface,
} from "shared/types/fact-table";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBEdit } from "@/components/Icons";
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
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import Callout from "@/ui/Callout";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";

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
  const { ftid } = router.query;

  const [editOpen, setEditOpen] = useState(false);
  const [editSQLOpen, setEditSQLOpen] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [showConvertToOfficialModal, setShowConvertToOfficialModal] =
    useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);

  const [duplicateFactTable, setDuplicateFactTable] = useState<
    FactTableInterface | undefined
  >();

  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature, organization, getOwnerDisplay } = useUser();

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
      {auditModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="factTable" id={factTable.id} />
        </Modal>
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
        <Callout status="info" mb="4">
          <Flex align="center" justify="between" gap="3">
            <div>
              This Fact Table is part of our sample dataset. You can safely
              delete this once you are done exploring.
            </div>
            <DeleteDemoDatasourceButton
              onDelete={() => router.push("/fact-tables")}
              source="fact-table"
              asLink
            />
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
      <Flex align="start" justify="between" gap="2" mb="2">
        <Flex align="center" gap="3" style={{ marginTop: "-4px" }}>
          <Heading size="x-large" as="h1" mb="0">
            {factTable.name}
            <OfficialBadge
              ml="2"
              type="Fact Table"
              managedBy={factTable.managedBy}
            />
          </Heading>
        </Flex>
        <Flex align="center" pr="2">
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
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
                    setEditOpen(true);
                    setDropdownOpen(false);
                  }}
                >
                  Edit Fact Table
                </DropdownMenuItem>
              )}
              {!factTable.managedBy &&
                canEdit &&
                permissionsUtil.canCreateOfficialResources(factTable) &&
                hasCommercialFeature("manage-official-resources") && (
                  <DropdownMenuItem
                    onClick={() => {
                      setShowConvertToOfficialModal(true);
                      setDropdownOpen(false);
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
                    setDropdownOpen(false);
                  }}
                >
                  Duplicate Fact Table
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  setAuditModal(true);
                  setDropdownOpen(false);
                }}
              >
                Audit log
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem
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
                    setDropdownOpen(false);
                  }}
                >
                  {factTable.archived ? "Unarchive" : "Archive"} Fact Table
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
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
                      closeDropdown: () => setDropdownOpen(false),
                    }}
                  >
                    Delete Fact Table
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenu>
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
              {getDatasourceById(factTable.datasource)?.name || "Unknown"}
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

      <Tabs defaultValue="metrics">
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
            <h3>Row Filters</h3>
            <Text as="div" mb="2" color="text-mid">
              Row Filters let you write SQL to limit the rows that are included
              in a metric. Save commonly used filters here and reuse them across
              multiple metrics.
            </Text>
            <div className="appbox p-3 flex-1">
              <FactFilterList factTable={factTable} />
            </div>
          </TabsContent>
        </Box>
      </Tabs>
    </div>
  );
}
