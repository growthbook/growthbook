import { ago } from "shared/dates";
import { useCallback, useEffect, useState } from "react";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { FaArrowRight } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import Link from "next/link";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDashboards } from "@/hooks/useDashboards";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import DashboardModal from "@/enterprise/components/Dashboards/DashboardModal";
import {
  CreateDashboardArgs,
  SubmitDashboard,
  UpdateDashboardArgs,
} from "@/enterprise/components/Dashboards/DashboardsTab";
import { useAuth } from "@/services/auth";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import { DocLink } from "@/components/DocLink";
import EmptyState from "@/components/EmptyState";
import ProjectBadges from "@/components/ProjectBadges";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { useUser } from "@/services/UserContext";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Tooltip from "@/components/Tooltip/Tooltip";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";

export default function DashboardsPage() {
  const permissionsUtil = usePermissionsUtil();
  const { getUserDisplay, hasCommercialFeature, userId } = useUser();
  const { project } = useDefinitions();
  const { apiCall } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dashboardId, setDashboardId] = useState<string | undefined>(undefined);
  const [showEditModal, setShowEditModal] = useState<
    DashboardInterface | undefined
  >(undefined);
  const [showDuplicateModal, setShowDuplicateModal] = useState<
    DashboardInterface | undefined
  >(undefined);
  const [_blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  const { dashboards, loading, error, mutateDashboards } = useDashboards(false);
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: dashboards,
    localStorageKey: "dashboards",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["title"],
  });

  // We prevent orgs without the feature from viewing dashboards
  const canViewDashboards = hasCommercialFeature(
    "product-analytics-dashboards",
  );

  const canCreate =
    permissionsUtil.canCreateGeneralDashboards({
      projects: [project],
    }) && hasCommercialFeature("product-analytics-dashboards");

  const dashboard = dashboards.find((d) => d.id === dashboardId);

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 1500,
  });

  const HOST = globalThis?.window?.location?.origin;

  useEffect(() => {
    if (dashboard) {
      setBlocks(dashboard.blocks);
    } else {
      setBlocks([]);
    }
  }, [dashboard]);

  const submitDashboard = useCallback<
    SubmitDashboard<CreateDashboardArgs | UpdateDashboardArgs>
  >(
    async ({ method, dashboardId, data }) => {
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInterface;
      }>(`/dashboards/${method === "PUT" ? dashboardId : ""}`, {
        method: method,
        body: JSON.stringify(
          method === "PUT"
            ? {
                blocks: data.blocks,
                title: data.title,
                editLevel: data.editLevel,
                shareLevel: data.shareLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                updateSchedule: data.updateSchedule,
                projects: data.projects,
              }
            : {
                blocks: data.blocks ?? [],
                title: data.title,
                editLevel: data.editLevel,
                shareLevel: data.shareLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                experimentId: "",
                updateSchedule: data.updateSchedule,
                projects: data.projects,
              },
        ),
      });
      if (res.status === 200) {
        mutateDashboards();
        setDashboardId(res.dashboard.id);
        setBlocks(res.dashboard.blocks);
      } else {
        console.error(res);
      }
    },
    [apiCall, mutateDashboards],
  );

  if (loading) return <LoadingOverlay />;

  return (
    <>
      {isEditing && dashboard && (
        <DashboardWorkspace
          experiment={null}
          dashboard={dashboard}
          submitDashboard={submitDashboard}
          mutate={mutateDashboards}
          close={() => setIsEditing(false)}
          isTabActive={true}
        />
      )}
      {showEditModal && (
        <DashboardModal
          mode="edit"
          type="general"
          initial={{
            title: showEditModal.title,
            editLevel: showEditModal.editLevel,
            shareLevel: showEditModal.shareLevel,
            enableAutoUpdates: showEditModal.enableAutoUpdates,
            projects: showEditModal.projects || [],
            updateSchedule: showEditModal.updateSchedule,
          }}
          close={() => setShowEditModal(undefined)}
          submit={async (data) => {
            await submitDashboard({
              method: "PUT",
              dashboardId: showEditModal.id,
              data,
            });
            setDashboardId(undefined);
          }}
        />
      )}
      {showDuplicateModal && (
        <DashboardModal
          mode="duplicate"
          type="general"
          close={() => setShowDuplicateModal(undefined)}
          initial={{
            title: `Copy of ${showDuplicateModal.title}`,
            editLevel: showDuplicateModal.editLevel,
            shareLevel: showDuplicateModal.shareLevel,
            enableAutoUpdates: showDuplicateModal.enableAutoUpdates,
            projects: showDuplicateModal.projects || [],
          }}
          submit={async (data) => {
            await submitDashboard({ method: "POST", data });
            setIsEditing(true);
          }}
        />
      )}
      {showCreateModal && (
        <DashboardModal
          mode="create"
          type="general"
          close={() => setShowCreateModal(false)}
          submit={async (data) => {
            console.log("data", data);
            await submitDashboard({ method: "POST", data });
            setIsEditing(true);
          }}
        />
      )}
      <div className="p-3 container-fluid pagecontents">
        <Flex justify="between" align="center">
          <h1>Product Analytics Dashboards</h1>
          {dashboards.length ? (
            <Button
              onClick={() => setShowCreateModal(true)}
              disabled={!canCreate}
            >
              Create Dashboard
            </Button>
          ) : null}
        </Flex>
        {!dashboards.length ? (
          <div className="mt-4">
            {!hasCommercialFeature("product-analytics-dashboards") ? (
              <PremiumEmptyState
                title="Explore & Share Custom Analyses"
                description="Create curated dashboards to visualize key metrics and track performance."
                commercialFeature="product-analytics-dashboards"
              />
            ) : (
              <EmptyState
                title="Explore & Share Custom Analyses"
                description="Create curated dashboards to visualize key metrics and track performance."
                leftButton={
                  <Button onClick={() => setShowCreateModal(true)}>
                    Create Dashboard
                  </Button>
                }
                rightButton={null}
              />
            )}
          </div>
        ) : (
          <>
            <p>
              Create curated dashboards to visualize key metrics and track
              performance.{" "}
              <DocLink docSection="productAnalytics" useRadix={true}>
                View Docs <FaArrowRight size={10} />
              </DocLink>
            </p>

            {error ? (
              <div className="alert alert-danger">
                There was an error loading the list of dashboards.
              </div>
            ) : (
              <>
                <Flex
                  gap="4"
                  align="start"
                  justify="between"
                  mb="4"
                  wrap="wrap"
                >
                  <Box flexBasis="300px" flexShrink="0">
                    <Field
                      placeholder="Search..."
                      type="search"
                      {...searchInputProps}
                    />
                  </Box>
                </Flex>
                <div className="row mb-0">
                  <div className="col-12">
                    <table className="table gbtable">
                      <thead>
                        <tr>
                          <SortableTH field={"title"}>
                            Dashboard Name
                          </SortableTH>
                          <SortableTH field={"shareLevel"}>Status</SortableTH>
                          <th>Projects</th>
                          <SortableTH field={"userId"}>Owner</SortableTH>
                          <SortableTH field={"dateUpdated"}>
                            Last Updated
                          </SortableTH>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((d) => {
                          const ownerName = getUserDisplay(d.userId);
                          let canEdit =
                            permissionsUtil.canUpdateGeneralDashboards(d, {});
                          let canDelete =
                            permissionsUtil.canDeleteGeneralDashboards(d);
                          let canDuplicate =
                            permissionsUtil.canCreateGeneralDashboards(d);

                          // If the dashboard is private, and the currentUser isn't the owner, they don't have edit/delete rights, regardless of their permissions
                          if (
                            d.editLevel === "private" &&
                            d.userId !== userId
                          ) {
                            canEdit = false;
                            canDelete = false;
                            canDuplicate = false;
                          }

                          return (
                            <tr key={d.id}>
                              <td>
                                {canViewDashboards ? (
                                  <Link href={`/dashboards/${d.id}`}>
                                    <span
                                      style={{
                                        color: "var(--color-text-high)",
                                      }}
                                    >
                                      {d.title}
                                    </span>
                                  </Link>
                                ) : (
                                  <Tooltip body="Your plan does not support viewing/editing Product Analytics Dashboards.">
                                    <Text>{d.title}</Text>
                                  </Tooltip>
                                )}
                              </td>
                              <td>
                                <ShareStatusBadge
                                  shareLevel={
                                    d.shareLevel === "published"
                                      ? "organization"
                                      : "private"
                                  }
                                  editLevel={
                                    d.editLevel === "private"
                                      ? "private"
                                      : "organization"
                                  }
                                  isOwner={d.userId === userId}
                                />
                              </td>
                              <td>
                                {d && (d.projects || []).length > 0 ? (
                                  <ProjectBadges
                                    resourceType="dashboard"
                                    projectIds={d.projects || []}
                                  />
                                ) : (
                                  <ProjectBadges resourceType="dashboard" />
                                )}
                              </td>
                              <td>
                                <>
                                  {ownerName !== "" && (
                                    <UserAvatar
                                      name={ownerName}
                                      size="sm"
                                      variant="soft"
                                    />
                                  )}
                                  <Text ml="1">
                                    {ownerName === "" ? "None" : ownerName}
                                  </Text>
                                </>
                              </td>
                              <td>{ago(d.dateUpdated)}</td>
                              <td style={{ width: 30 }}>
                                {canViewDashboards ? (
                                  <Flex align="center">
                                    <DropdownMenu
                                      trigger={
                                        <IconButton
                                          variant="ghost"
                                          color="gray"
                                          radius="full"
                                          size="3"
                                          highContrast
                                        >
                                          <BsThreeDotsVertical />
                                        </IconButton>
                                      }
                                    >
                                      <DropdownMenuItem
                                        disabled={!canEdit}
                                        onClick={() => setShowEditModal(d)}
                                      >
                                        Edit Dashboard Settings
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={!canDuplicate}
                                        onClick={() => setShowDuplicateModal(d)}
                                      >
                                        Duplicate
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          performCopy(
                                            `${HOST}/dashboards/${d.id}`,
                                          );
                                        }}
                                      >
                                        <Tooltip
                                          state={copySuccess}
                                          ignoreMouseEvents
                                          delay={0}
                                          tipPosition="left"
                                          body="URL copied to clipboard"
                                          innerClassName="px-2 py-1"
                                        >
                                          Copy link
                                        </Tooltip>
                                      </DropdownMenuItem>

                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        disabled={!canDelete}
                                        color="red"
                                        onClick={async () => {
                                          await apiCall(`/dashboards/${d.id}`, {
                                            method: "DELETE",
                                          });
                                          mutateDashboards();
                                        }}
                                      >
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenu>
                                  </Flex>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                        {!items.length && isFiltered && (
                          <tr>
                            <td colSpan={5} align={"center"}>
                              No matching dashboards
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
