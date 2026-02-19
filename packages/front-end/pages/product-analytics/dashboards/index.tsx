import { ago } from "shared/dates";
import { useCallback, useEffect, useState } from "react";
import {
  DashboardInterface,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  getBlockData,
} from "shared/enterprise";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { FaArrowRight } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import Link from "next/link";
import { useRouter } from "next/router";
import { isProjectListValidForProject } from "shared/util";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDashboards } from "@/hooks/useDashboards";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import DashboardModal from "@/enterprise/components/Dashboards/DashboardModal";
import DashboardShareModal from "@/enterprise/components/Dashboards/DashboardShareModal";
import {
  CreateDashboardArgs,
  SubmitDashboard,
  UpdateDashboardArgs,
} from "@/enterprise/components/Dashboards/DashboardsTab";
import { useAuth } from "@/services/auth";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import DashboardSeriesDisplayProvider from "@/enterprise/components/Dashboards/DashboardSeriesDisplayProvider";
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
import Tooltip from "@/components/Tooltip/Tooltip";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";
import LinkButton from "@/ui/LinkButton";

export default function DashboardsPage() {
  const permissionsUtil = usePermissionsUtil();
  const { getUserDisplay, hasCommercialFeature, userId } = useUser();
  const { project } = useDefinitions();
  const { apiCall } = useAuth();
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedDashboard, setSelectedDashboard] = useState<
    DashboardInterface | undefined
  >(undefined);
  const [dashboardId, setDashboardId] = useState<string | undefined>(undefined);
  const [showEditModal, setShowEditModal] = useState<
    DashboardInterface | undefined
  >(undefined);
  const [showDuplicateModal, setShowDuplicateModal] = useState<
    DashboardInterface | undefined
  >(undefined);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [_blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  const { dashboards, loading, error, mutateDashboards } = useDashboards(false);

  // Filter dashboards by project
  const filteredDashboards = project
    ? dashboards.filter((dashboard) =>
        isProjectListValidForProject(dashboard.projects, project),
      )
    : dashboards;

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: filteredDashboards,
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

  const dashboard = filteredDashboards.find((d) => d.id === dashboardId);

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
                userId: data.userId,
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
        return { dashboardId: res.dashboard.id };
      } else {
        console.error(res);
        throw new Error("Failed to save dashboard");
      }
    },
    [apiCall, mutateDashboards],
  );

  if (loading || saving) return <LoadingOverlay />;

  return (
    <>
      {isEditing && dashboard && (
        <DashboardSeriesDisplayProvider
          dashboard={dashboard}
          onSave={async (updatedSettings) => {
            if (dashboard?.id) {
              await submitDashboard({
                method: "PUT",
                dashboardId: dashboard.id,
                data: {
                  seriesDisplaySettings: updatedSettings,
                },
              });
            }
          }}
        >
          <DashboardWorkspace
            experiment={null}
            dashboard={dashboard}
            submitDashboard={submitDashboard}
            mutate={mutateDashboards}
            close={() => {
              setSaving(true);
              router.push(`/product-analytics/dashboards/${dashboard.id}`);
            }}
            isTabActive={true}
          />
        </DashboardSeriesDisplayProvider>
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
            updateSchedule: showEditModal.updateSchedule || undefined,
            userId: showEditModal.userId,
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
            updateSchedule: showDuplicateModal.updateSchedule || undefined,
            userId: userId || "",
            projects: showDuplicateModal.projects || [],
            blocks: (showDuplicateModal.blocks ?? []).map(getBlockData),
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
            await submitDashboard({ method: "POST", data });
            setIsEditing(true);
          }}
        />
      )}
      {shareModalOpen && selectedDashboard && (
        <DashboardShareModal
          isOpen={shareModalOpen}
          onClose={() => {
            setShareModalOpen(false);
            setSelectedDashboard(undefined);
          }}
          onSubmit={async (data) => {
            await apiCall(`/dashboards/${selectedDashboard.id}`, {
              method: "PUT",
              body: JSON.stringify({
                shareLevel: data.shareLevel,
                editLevel: data.editLevel,
              }),
            });
            mutateDashboards();
          }}
          initialValues={{
            shareLevel: selectedDashboard.shareLevel,
            editLevel: selectedDashboard.editLevel,
          }}
          isGeneralDashboard={true}
          dashboardId={selectedDashboard.id}
        />
      )}
      <div className="p-3 container-fluid pagecontents">
        <Flex justify="between" align="center">
          <Flex align="center">
            <h1>Product Analytics Dashboards</h1>
            <span className="badge badge-purple text-uppercase ml-2">Beta</span>
          </Flex>
          {filteredDashboards.length ? (
            <LinkButton
              href="/product-analytics/dashboards/new"
              disabled={!canCreate}
            >
              Create Dashboard
            </LinkButton>
          ) : null}
        </Flex>
        {!filteredDashboards.length ? (
          <div className="mt-4">
            {!hasCommercialFeature("product-analytics-dashboards") ? (
              <PremiumEmptyState
                title="Explore Your Data"
                description="Turn your data and metrics into actionable product insights, share with your team, and make smarter decisions about what to build next."
                commercialFeature="product-analytics-dashboards"
              />
            ) : (
              <EmptyState
                title="Explore Your Data"
                description="Turn your data and metrics into actionable product insights, share with your team, and make smarter decisions about what to build next."
                leftButton={
                  <Button
                    onClick={() =>
                      router.push("/product-analytics/dashboards/new")
                    }
                  >
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
                          const isOwner = d.userId === userId;
                          const isAdmin =
                            permissionsUtil.canManageOrgSettings();
                          const ownerName = getUserDisplay(d.userId);
                          let canEdit =
                            permissionsUtil.canUpdateGeneralDashboards(d, {});
                          let canDelete =
                            permissionsUtil.canDeleteGeneralDashboards(d) &&
                            (isOwner || isAdmin);
                          const canDuplicate =
                            permissionsUtil.canCreateGeneralDashboards(d);
                          const canManageSharingAndEditLevels =
                            canEdit && (isOwner || isAdmin);

                          // If the dashboard is private, and the currentUser isn't the owner, they don't have edit/delete rights, regardless of their permissions
                          if (
                            d.editLevel === "private" &&
                            !isOwner &&
                            !isAdmin
                          ) {
                            canEdit = false;
                            canDelete = false;
                          }

                          return (
                            <tr key={d.id}>
                              <td>
                                {canViewDashboards ? (
                                  <Link
                                    href={`/product-analytics/dashboards/${d.id}`}
                                  >
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
                                      menuPlacement="end"
                                      variant="soft"
                                      open={openDropdownId === d.id}
                                      onOpenChange={(o) => {
                                        setOpenDropdownId(o ? d.id : null);
                                      }}
                                    >
                                      {canEdit && (
                                        <DropdownMenuItem
                                          onClick={() => setShowEditModal(d)}
                                        >
                                          Edit Dashboard Settings
                                        </DropdownMenuItem>
                                      )}
                                      {canDuplicate && (
                                        <DropdownMenuItem
                                          onClick={() =>
                                            setShowDuplicateModal(d)
                                          }
                                        >
                                          Duplicate
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem
                                        disabled={
                                          !canManageSharingAndEditLevels
                                        }
                                        onClick={() => {
                                          setSelectedDashboard(d);
                                          setShareModalOpen(true);
                                        }}
                                      >
                                        Share...
                                      </DropdownMenuItem>

                                      {canDelete && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            color="red"
                                            confirmation={{
                                              confirmationTitle: (
                                                <>
                                                  Delete Dashboard{" "}
                                                  <i>{d.title}</i>?
                                                </>
                                              ),
                                              cta: "Delete",
                                              submit: async () => {
                                                await apiCall(
                                                  `/dashboards/${d.id}`,
                                                  {
                                                    method: "DELETE",
                                                  },
                                                );
                                                mutateDashboards();
                                              },
                                              closeDropdown: () => {
                                                setOpenDropdownId(null);
                                              },
                                            }}
                                          >
                                            Delete
                                          </DropdownMenuItem>
                                        </>
                                      )}
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
