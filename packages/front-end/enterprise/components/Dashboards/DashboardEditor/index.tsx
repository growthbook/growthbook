import React, { useContext, useMemo, useState } from "react";
import { PiPencilSimpleFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  getBlockData,
  DashboardEditLevel,
  DashboardInterface,
  DashboardShareLevel,
  DashboardUpdateSchedule,
} from "shared/enterprise";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { withErrorBoundary } from "@sentry/nextjs";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";
import ProjectBadges from "@/components/ProjectBadges";
import Owner from "@/components/Avatar/Owner";
import DashboardModal from "@/enterprise/components/Dashboards/DashboardModal";
import DashboardShareModal from "@/enterprise/components/Dashboards/DashboardShareModal";
import Badge from "@/ui/Badge";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";
import DashboardGlobalControlsBar from "./DashboardGlobalControlsBar";
import DashboardCanvas, { EditBlockProps } from "./DashboardCanvas";

export const DASHBOARD_TOPBAR_HEIGHT = "40px";

interface Props {
  isTabActive: boolean;
  title: string;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  globalControlBlocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  id: string;
  isEditing: boolean;
  projects: string[];
  enableAutoUpdates: boolean;
  updateSchedule: DashboardUpdateSchedule | undefined;
  globalControls?: DashboardInterface["globalControls"];
  ownerId: string;
  initialEditLevel: DashboardEditLevel;
  initialShareLevel: DashboardShareLevel;
  dashboardOwnerId: string;
  nextUpdate: Date | undefined;
  dashboardLastUpdated?: Date;
  setBlock:
    | undefined
    | ((
        index: number,
        block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
      ) => void);
  mutate: () => void;
  onGlobalControlsChange?: (
    globalControls: DashboardInterface["globalControls"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  dashboardComparison?: DashboardInterface["comparison"];
  onDashboardComparisonChange?: (
    comparison: DashboardInterface["comparison"],
  ) => Promise<void>;
  updateTemporaryDashboardResults?: (
    globalControls?: DashboardInterface["globalControls"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  switchToExperimentView?: () => void;
  isGeneralDashboard: boolean;
  setIsEditing?: (v: boolean) => void;
  enterEditModeForBlock?: (blockIndex: number) => void;
  editBlockProps?: EditBlockProps;
}

function DashboardEditor({
  isTabActive,
  title,
  blocks,
  globalControlBlocks,
  isEditing,
  enableAutoUpdates,
  updateSchedule,
  globalControls,
  ownerId,
  initialEditLevel,
  initialShareLevel,
  id,
  dashboardOwnerId,
  nextUpdate,
  dashboardLastUpdated,
  projects,
  setBlock,
  mutate,
  onGlobalControlsChange,
  dashboardComparison,
  onDashboardComparisonChange,
  updateTemporaryDashboardResults,
  switchToExperimentView,
  isGeneralDashboard = false,
  setIsEditing,
  enterEditModeForBlock,
  editBlockProps,
}: Props) {
  const editSidebarDirty = editBlockProps?.editSidebarDirty;

  const [editDashboard, setEditDashboard] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [duplicateDashboard, setDuplicateDashboard] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { allQueries, savedQueriesMap, snapshotError } = useContext(
    DashboardSnapshotContext,
  );
  const isOwner = dashboardOwnerId === userId;
  const isAdmin = permissionsUtil.canManageOrgSettings();
  let canEdit = permissionsUtil.canUpdateGeneralDashboards(
    { projects: projects || [] },
    {},
  );
  const canDelete =
    permissionsUtil.canDeleteGeneralDashboards({
      projects: projects || [],
    }) &&
    (isOwner || isAdmin);
  const canDuplicate = permissionsUtil.canCreateGeneralDashboards({
    projects: projects || [],
  });
  const canManageSharingAndEditLevels = canEdit && (isOwner || isAdmin);

  if (initialEditLevel === "private" && !isOwner && !isAdmin) {
    canEdit = false;
  }
  const savedQueryIds = [...savedQueriesMap.keys()];
  const queryStrings = useMemo(() => {
    return allQueries.map((q) => q.query) ?? [];
  }, [allQueries]);

  const error = snapshotError;
  const count = queryStrings.length + savedQueryIds.length;
  const handleViewQueries = () => {
    setQueriesModalOpen(true);
    setDropdownOpen(false);
  };

  return (
    <>
      {editDashboard && (
        <DashboardModal
          mode="edit"
          type={isGeneralDashboard ? "general" : "experiment"}
          initial={{
            title: title,
            editLevel: initialEditLevel,
            enableAutoUpdates: enableAutoUpdates,
            updateSchedule: updateSchedule || undefined,
            shareLevel: initialShareLevel,
            projects: projects,
            userId: ownerId,
          }}
          close={() => setEditDashboard(false)}
          submit={async (data) => {
            await apiCall(`/dashboards/${id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
            mutate();
          }}
        />
      )}
      {duplicateDashboard && (
        <DashboardModal
          mode="duplicate"
          type={isGeneralDashboard ? "general" : "experiment"}
          initial={{
            title: `Copy of ${title}`,
            editLevel: initialEditLevel,
            enableAutoUpdates: enableAutoUpdates,
            updateSchedule: updateSchedule || undefined,
            shareLevel: initialShareLevel,
            projects,
            userId: ownerId,
            blocks,
          }}
          close={() => setDuplicateDashboard(false)}
          submit={async (data) => {
            const res = await apiCall<{
              status: number;
              dashboard: DashboardInterface;
            }>(`/dashboards`, {
              method: "POST",
              body: JSON.stringify({
                title: data.title,
                editLevel: data.editLevel,
                shareLevel: data.shareLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                experimentId: "",
                updateSchedule: data.updateSchedule,
                projects: data.projects,
                globalControls,
                blocks: (data.blocks ?? []).map(getBlockData),
              }),
            });
            if (res.status === 200) {
              if (typeof window !== "undefined") {
                window.location.href = `/product-analytics/dashboards/${res.dashboard.id}`;
              }
            } else {
              console.error(res);
            }
          }}
        />
      )}
      <DashboardShareModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        onSubmit={async (data) => {
          await apiCall(`/dashboards/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              shareLevel: data.shareLevel,
              editLevel: data.editLevel,
            }),
          });
          await mutate();
        }}
        initialValues={{
          shareLevel: initialShareLevel,
          editLevel: initialEditLevel,
        }}
        isGeneralDashboard={isGeneralDashboard}
        dashboardId={id}
      />
      <Box mt={isEditing ? "1" : undefined} mb="3">
        {/* Viewing, as tall as what's in it, so it starts 24px under the
          header like other pages' title rows; editing, the editor's 40px. */}
        <Flex
          align="center"
          height={isEditing ? DASHBOARD_TOPBAR_HEIGHT : undefined}
          gap="1"
        >
          {switchToExperimentView ? (
            <Button variant="ghost" size="sm" onClick={switchToExperimentView}>
              View Regular Experiment View
            </Button>
          ) : (
            <Flex align="center" gap="2" flexGrow="1" minWidth="0">
              <Text truncate={true} size="xl">
                {title}
              </Text>
              <ShareStatusBadge
                shareLevel={
                  initialShareLevel === "published" ? "organization" : "private"
                }
                editLevel={
                  initialEditLevel === "private" ? "private" : "organization"
                }
                isOwner={dashboardOwnerId === userId}
              />
            </Flex>
          )}
          <DashboardUpdateDisplay
            dashboardId={id}
            enableAutoUpdates={enableAutoUpdates}
            nextUpdate={nextUpdate}
            dashboardLastUpdated={dashboardLastUpdated}
            disabled={!!editSidebarDirty}
            isEditing={isEditing}
            needsUpdate={needsUpdate}
            updateTemporaryDashboardResults={updateTemporaryDashboardResults}
            onUpdated={() => setNeedsUpdate(false)}
          />
          {isGeneralDashboard && setIsEditing && !isEditing ? (
            <Flex align="center" gap="4" ml="4" flexShrink="0">
              {canManageSharingAndEditLevels && (
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => setShareModalOpen(true)}
                >
                  Share...
                </Button>
              )}
              <Button
                variant="solid"
                size="md"
                disabled={!canEdit}
                onClick={() => setIsEditing(true)}
              >
                <PiPencilSimpleFill className="mr-2" />
                Edit Blocks
              </Button>

              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="3"
                    highContrast
                    // Its hover area stays within the title row.
                    style={{ marginTop: 0, marginBottom: 0 }}
                  >
                    <BsThreeDotsVertical size={18} />
                  </IconButton>
                }
                open={dropdownOpen}
                onOpenChange={(o) => {
                  setDropdownOpen(!!o);
                }}
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuGroup>
                  {canEdit && (
                    <DropdownMenuItem
                      onClick={() => {
                        setEditDashboard(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Edit Dashboard Settings
                    </DropdownMenuItem>
                  )}
                  {canDuplicate && (
                    <DropdownMenuItem
                      onClick={() => {
                        setDuplicateDashboard(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  {queryStrings.length > 0 || savedQueryIds.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleViewQueries}>
                        View queries
                        <Badge
                          variant="soft"
                          radius="full"
                          label={String(count)}
                          ml="2"
                          color={error ? "red" : undefined}
                        />
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          confirmationTitle: "Delete Dashboard?",
                          cta: "Delete",
                          submit: async () => {
                            await apiCall(`/dashboards/${id}`, {
                              method: "DELETE",
                            });
                            if (typeof window !== "undefined") {
                              window.location.href =
                                "/product-analytics/dashboards";
                            }
                          },
                          closeDropdown: () => {
                            setDropdownOpen(false);
                          },
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuGroup>
              </DropdownMenu>
              {queriesModalOpen &&
                (queryStrings.length > 0 || savedQueryIds.length > 0) && (
                  <AsyncQueriesModal
                    close={() => setQueriesModalOpen(false)}
                    queries={queryStrings}
                    savedQueries={savedQueryIds}
                    error={error}
                  />
                )}
            </Flex>
          ) : null}
        </Flex>
        {!isEditing && (
          <Flex align="center" gap="3">
            <Flex align="center" gap="1">
              <Text weight="medium">Projects:</Text>
              {projects?.length ? (
                <Tooltip
                  body={
                    <Flex direction="column" gap="1">
                      <ProjectBadges
                        skipMargin
                        resourceType="dashboard"
                        projectIds={projects}
                      />
                    </Flex>
                  }
                >
                  <span role="button">{projects.length}</span>
                </Tooltip>
              ) : (
                <ProjectBadges resourceType="dashboard" />
              )}
            </Flex>
            <Flex align="center" gap="1">
              <Text weight="medium">Owner:</Text>
              <Owner ownerId={dashboardOwnerId} gap="1" />
            </Flex>
          </Flex>
        )}
        {isGeneralDashboard && onGlobalControlsChange ? (
          <DashboardGlobalControlsBar
            blocks={globalControlBlocks ?? blocks}
            globalControls={globalControls}
            canEdit={canEdit}
            onGlobalControlsChange={onGlobalControlsChange}
            dashboardComparison={dashboardComparison}
            onDashboardComparisonChange={onDashboardComparisonChange}
            updateTemporaryDashboardResults={updateTemporaryDashboardResults}
            setNeedsUpdate={setNeedsUpdate}
          />
        ) : null}
      </Box>
      <DashboardCanvas
        blocks={blocks}
        isTabActive={isTabActive}
        isGeneralDashboard={isGeneralDashboard}
        globalControls={globalControls}
        dashboardComparison={dashboardComparison}
        setBlock={setBlock}
        mutate={mutate}
        edit={
          canEdit || isEditing
            ? {
                isEditing,
                canEdit,
                setIsEditing,
                enterEditModeForBlock,
                editBlockProps,
              }
            : undefined
        }
      />
    </>
  );
}

export default withErrorBoundary(DashboardEditor, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
