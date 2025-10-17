import React, { Fragment, ReactElement, useEffect, useState } from "react";
import {
  PiCaretDownFill,
  PiPlus,
  PiTableDuotone,
  PiChartLineDuotone,
  PiFileSqlDuotone,
  PiListDashesDuotone,
  PiArticleMediumDuotone,
  PiPencilSimpleFill,
  PiCheck,
  PiLink,
} from "react-icons/pi";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import { Container, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import clsx from "clsx";
import { withErrorBoundary } from "@sentry/react";
import { isPersistedDashboardBlock } from "shared/enterprise";
import {
  DashboardEditLevel,
  DashboardInterface,
  DashboardShareLevel,
} from "back-end/src/enterprise/validators/dashboard";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";
import ProjectBadges from "@/components/ProjectBadges";
import UserAvatar from "@/components/Avatar/UserAvatar";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/ui/HelperText";
import DashboardModal from "../DashboardModal";
import DashboardBlock from "./DashboardBlock";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";
import DashboardViewQueriesButton from "./DashboardViewQueriesButton";

export const DASHBOARD_TOPBAR_HEIGHT = "40px";
export const BLOCK_TYPE_INFO: Record<
  DashboardBlockType,
  { name: string; icon: ReactElement }
> = {
  markdown: {
    name: "Markdown",
    icon: <PiArticleMediumDuotone />,
  },
  "experiment-metadata": {
    name: "Experiment Metadata",
    icon: <PiListDashesDuotone />,
  },
  "experiment-metric": {
    name: "Metric Results",
    icon: <PiTableDuotone />,
  },
  "experiment-dimension": {
    name: "Dimension Results",
    icon: <PiTableDuotone />,
  },
  "experiment-time-series": {
    name: "Time Series",
    icon: <PiChartLineDuotone />,
  },
  "experiment-traffic": {
    name: "Experiment Traffic",
    icon: <PiChartLineDuotone />,
  },
  "sql-explorer": {
    name: "SQL Query",
    icon: <PiFileSqlDuotone />,
  },
  "metric-explorer": {
    name: "Metric",
    icon: <PiFileSqlDuotone />,
  },
};

export const BLOCK_SUBGROUPS: [string, DashboardBlockType[]][] = [
  [
    "Metric Results",
    ["experiment-metric", "experiment-dimension", "experiment-time-series"],
  ],
  ["Experiment Info", ["experiment-metadata", "experiment-traffic"]],
  ["Other", ["markdown", "sql-explorer", "metric-explorer"]],
];

// Block types that are allowed in general dashboards (non-experiment specific)
const GENERAL_DASHBOARD_BLOCK_TYPES: DashboardBlockType[] = [
  "markdown",
  "sql-explorer",
  "metric-explorer",
];

// Helper function to check if a block type is allowed for the given dashboard type
const isBlockTypeAllowed = (
  blockType: DashboardBlockType,
  isGeneralDashboard: boolean,
): boolean => {
  if (isGeneralDashboard) {
    return GENERAL_DASHBOARD_BLOCK_TYPES.includes(blockType);
  } else {
    return true; // All block types are allowed for experiment dashboards
  }
};

function AddBlockDropdown({
  trigger,
  addBlockType,
  onDropdownOpen,
  onDropdownClose,
  isGeneralDashboard = false,
}: {
  trigger: React.ReactNode;
  addBlockType: (bType: DashboardBlockType) => void;
  onDropdownOpen?: () => void;
  onDropdownClose?: () => void;
  isGeneralDashboard?: boolean;
}) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  useEffect(() => {
    if (dropdownOpen) {
      onDropdownOpen && onDropdownOpen();
    } else {
      onDropdownClose && onDropdownClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropdownOpen]);

  return (
    <DropdownMenu
      variant="solid"
      open={dropdownOpen}
      onOpenChange={(o) => {
        setDropdownOpen(!!o);
      }}
      trigger={trigger}
    >
      {BLOCK_SUBGROUPS.map(([subgroup, blockTypes], i) => {
        // Filter block types based on dashboard type
        const allowedBlockTypes = blockTypes.filter((bType) =>
          isBlockTypeAllowed(bType, isGeneralDashboard),
        );

        // Don't render the subgroup if no block types are allowed
        if (allowedBlockTypes.length === 0) {
          return null;
        }

        return (
          <Fragment key={`${subgroup}-${i}`}>
            {!isGeneralDashboard && (
              <DropdownMenuLabel className="font-weight-bold">
                <Text style={{ color: "var(--color-text-high)" }}>
                  {subgroup}
                </Text>
              </DropdownMenuLabel>
            )}
            {allowedBlockTypes.map((bType) => (
              <DropdownMenuItem
                key={bType}
                onClick={() => {
                  setDropdownOpen(false);
                  addBlockType(bType);
                }}
              >
                {BLOCK_TYPE_INFO[bType].name}
              </DropdownMenuItem>
            ))}
            {i < BLOCK_SUBGROUPS.length - 1 && <DropdownMenuSeparator />}
          </Fragment>
        );
      })}
    </DropdownMenu>
  );
}

interface EditBlockProps {
  scrollAreaRef: null | React.MutableRefObject<HTMLDivElement | null>;
  editSidebarDirty: boolean;
  focusedBlockIndex: number | undefined;
  stagedBlockIndex: number | undefined;
  addBlockType: (bType: DashboardBlockType, i?: number) => void;
  moveBlock: (index: number, direction: -1 | 1) => void;
  editBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  deleteBlock: (index: number) => void;
}

interface Props {
  isTabActive: boolean;
  title: string;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  id: string;
  isEditing: boolean;
  projects: string[];
  enableAutoUpdates: boolean;
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
  switchToExperimentView?: () => void;
  isGeneralDashboard: boolean;
  setIsEditing?: (v: boolean) => void;
  editBlockProps?: EditBlockProps;
}

function DashboardEditor({
  isTabActive,
  title,
  blocks,
  isEditing,
  enableAutoUpdates,
  initialEditLevel,
  initialShareLevel,
  id,
  dashboardOwnerId,
  nextUpdate,
  dashboardLastUpdated,
  projects,
  setBlock,
  mutate,
  switchToExperimentView,
  isGeneralDashboard = false,
  setIsEditing,
  editBlockProps,
}: Props) {
  const {
    editSidebarDirty,
    focusedBlockIndex,
    stagedBlockIndex,
    scrollAreaRef,
    moveBlock,
    addBlockType,
    editBlock,
    duplicateBlock,
    deleteBlock,
  } = editBlockProps ?? {};

  const [editDashboard, setEditDashboard] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [duplicateDashboard, setDuplicateDashboard] = useState(false);
  const [shareLevel, setShareLevel] =
    useState<DashboardShareLevel>(initialShareLevel);
  const [editLevel, setEditLevel] =
    useState<DashboardEditLevel>(initialEditLevel);
  console.log("initialEditLevel", initialEditLevel);
  console.log("editLevel", editLevel);
  const [saveShareLevelStatus, setSaveShareLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);
  const [saveEditLevelStatus, setSaveEditLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);
  const { apiCall } = useAuth();
  const { userId, getUserDisplay, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  let canEdit = permissionsUtil.canUpdateGeneralDashboards(
    { projects: projects || [] },
    {},
  );
  let canDelete = permissionsUtil.canDeleteGeneralDashboards({
    projects: projects || [],
  });
  if (editLevel === "private" && dashboardOwnerId !== userId) {
    canEdit = false;
    canDelete = false;
  }
  const ownerName = getUserDisplay(dashboardOwnerId, false) || "";

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 1500,
  });

  // Handle shareLevel changes
  useEffect(() => {
    if (initialShareLevel !== shareLevel) {
      setSaveShareLevelStatus("loading");
      apiCall(`/dashboards/${id}`, {
        method: "PUT",
        body: JSON.stringify({ shareLevel }),
      })
        .then(() => {
          mutate?.();
          setSaveShareLevelStatus("success");
          setTimeout(() => setSaveShareLevelStatus(null), 3000);
        })
        .catch(() => {
          setSaveShareLevelStatus("fail");
          setTimeout(() => setSaveShareLevelStatus(null), 3000);
        });
    }
  }, [shareLevel, initialShareLevel, id, apiCall, mutate]);

  // Handle editLevel changes
  useEffect(() => {
    if (initialEditLevel !== editLevel) {
      setSaveEditLevelStatus("loading");
      apiCall(`/dashboards/${id}`, {
        method: "PUT",
        body: JSON.stringify({ editLevel }),
      })
        .then(() => {
          mutate?.();
          setSaveEditLevelStatus("success");
          setTimeout(() => setSaveEditLevelStatus(null), 3000);
        })
        .catch(() => {
          setSaveEditLevelStatus("fail");
          setTimeout(() => setSaveEditLevelStatus(null), 3000);
        });
    }
  }, [editLevel, initialEditLevel, id, apiCall, mutate]);

  const renderSingleBlock = ({
    i,
    key,
    block,
    isFocused,
    setBlock,
    isEditingBlock,
    isLastBlock,
  }: {
    i: number;
    key: number | string;
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
    isFocused: boolean;
    setBlock:
      | undefined
      | React.Dispatch<DashboardBlockInterfaceOrData<DashboardBlockInterface>>;
    isEditingBlock: boolean;
    isLastBlock: boolean;
  }) => {
    return (
      <Flex direction="column" key={key}>
        <DashboardBlock
          isTabActive={isTabActive}
          block={block}
          isEditing={isEditing}
          isFocused={isFocused}
          editingBlock={isEditingBlock}
          disableBlock={
            editSidebarDirty && !isEditingBlock
              ? "full"
              : isDefined(stagedBlockIndex)
                ? "partial"
                : "none"
          }
          isFirstBlock={i === 0}
          isLastBlock={i === blocks.length - 1}
          scrollAreaRef={scrollAreaRef ?? null}
          setBlock={setBlock}
          editBlock={editBlock ? () => editBlock(i) : () => {}}
          duplicateBlock={duplicateBlock ? () => duplicateBlock(i) : () => {}}
          deleteBlock={deleteBlock ? () => deleteBlock(i) : () => {}}
          moveBlock={
            moveBlock ? (direction) => moveBlock(i, direction) : () => {}
          }
          mutate={mutate}
        />
        <Container
          py="2px"
          className={clsx({
            "dashboard-disabled": editSidebarDirty,
          })}
          mb={!isEditing ? "4" : "0"}
        >
          {isEditing && (
            <Flex
              justify="center"
              position="relative"
              mt={isLastBlock ? "2" : "0"}
              className="hover-show"
              style={!editSidebarDirty ? {} : { visibility: "hidden" }}
            >
              {isDefined(i) && (
                <div
                  style={{
                    pointerEvents: "none",
                    position: "absolute",
                    top: "0",
                    width: "100%",
                    height: "50%",
                    borderBottom: "1px solid var(--violet-a9)",
                  }}
                  className={"show-target"}
                />
              )}
              <AddBlockDropdown
                trigger={
                  <IconButton
                    className={isLastBlock ? "" : "show-target"}
                    size="1"
                    style={{ zIndex: 10 }}
                  >
                    <Flex height="16px" align="center">
                      <PiPlus size="10" />
                    </Flex>
                  </IconButton>
                }
                addBlockType={(bType: DashboardBlockType) => {
                  if (isDefined(i) && addBlockType) {
                    addBlockType(bType, i + 1);
                  }
                }}
                isGeneralDashboard={isGeneralDashboard}
              />
            </Flex>
          )}
        </Container>
      </Flex>
    );
  };

  const shareLinkButton = copySuccess ? (
    <Button style={{ width: 130 }} icon={<PiCheck />}>
      Link copied
    </Button>
  ) : (
    <Button
      disabled={shareLevel === "private"}
      onClick={() => {
        const url = window.location.href.replace(/[?#].*/, `#dashboards/${id}`);
        performCopy(url);
      }}
      style={{
        width: 130,
      }}
      icon={<PiLink />}
    >
      Copy Link
    </Button>
  );

  return (
    <div>
      {editDashboard && (
        <DashboardModal
          mode="edit"
          type={isGeneralDashboard ? "general" : "experiment"}
          initial={{
            title: title,
            editLevel: initialEditLevel,
            enableAutoUpdates: enableAutoUpdates,
            shareLevel: initialShareLevel,
            projects: projects,
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
            shareLevel: initialShareLevel,
            projects: projects,
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
                enableAutoUpdates: data.enableAutoUpdates,
                blocks: data.blocks || [],
              }),
            });
            if (res.status === 200) {
              if (typeof window !== "undefined") {
                window.location.href = `/dashboards/${res.dashboard.id}`;
              }
            } else {
              console.error(res);
            }
          }}
        />
      )}
      {shareModalOpen && (
        <Modal
          open={true}
          trackingEventModalType="product-analytics-dashboard-share"
          header="Update Dashboard Access Settings"
          close={() => setShareModalOpen(false)}
          closeCta="Close"
          useRadixButton={true}
          secondaryCTA={shareLinkButton}
        >
          <Flex direction="column" gap="1">
            <div className="mb-1">
              {shareLevel === "private" ? (
                <Callout status="info" size="sm">
                  Currently only you can view or edit this dashboard.
                </Callout>
              ) : (
                <Callout status="warning" size="sm">
                  {`This report is discoverable within your organization. ${editLevel === "private" ? "Only you can edit it." : "Anybody in your organization with permissions can edit it."}`}
                </Callout>
              )}
            </div>
            <div>
              <SelectField
                label="View access"
                disabled={
                  !hasCommercialFeature("share-product-analytics-dashboards")
                }
                options={[
                  { label: "Organization members", value: "published" },
                  { label: "Only me", value: "private" },
                  // { label: "Anyone with the link", value: "public" }, //TODO: Need to build this logic
                ]}
                value={shareLevel}
                onChange={(value: DashboardShareLevel) => setShareLevel(value)}
              />
              <div className="mb-1" style={{ height: 24 }}>
                {saveShareLevelStatus === "loading" ? (
                  <div className="position-relative" style={{ top: -6 }}>
                    <LoadingSpinner />
                  </div>
                ) : saveShareLevelStatus === "success" ? (
                  <HelperText status="success" size="sm">
                    Sharing status has been updated
                  </HelperText>
                ) : saveShareLevelStatus === "fail" ? (
                  <HelperText status="error" size="sm">
                    Unable to update sharing status
                  </HelperText>
                ) : null}
              </div>
            </div>
            <div>
              <SelectField
                label="Edit access"
                disabled={
                  !hasCommercialFeature("share-product-analytics-dashboards") ||
                  shareLevel === "private"
                }
                options={[
                  {
                    label: "Any organization members with editing permission",
                    value: "published",
                  },
                  { label: "Only me", value: "private" },
                ]}
                value={editLevel}
                onChange={(value: DashboardEditLevel) => setEditLevel(value)}
              />
              <div className="mb-1" style={{ height: 24 }}>
                {saveEditLevelStatus === "loading" ? (
                  <div className="position-relative" style={{ top: -6 }}>
                    <LoadingSpinner />
                  </div>
                ) : saveEditLevelStatus === "success" ? (
                  <HelperText status="success" size="sm">
                    Edit access has been updated
                  </HelperText>
                ) : saveEditLevelStatus === "fail" ? (
                  <HelperText status="error" size="sm">
                    Unable to update edit access
                  </HelperText>
                ) : null}
              </div>
            </div>
          </Flex>
        </Modal>
      )}
      <div className="mb-3">
        <Flex align="center" height={DASHBOARD_TOPBAR_HEIGHT} gap="1">
          {switchToExperimentView ? (
            <Button variant="ghost" size="xs" onClick={switchToExperimentView}>
              View Regular Experiment View
            </Button>
          ) : (
            <Text
              weight="medium"
              size="5"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 1,
              }}
            >
              <Flex align="center" gap="2">
                {title}
                {isGeneralDashboard && (
                  <ShareStatusBadge
                    shareLevel={
                      shareLevel === "published" ? "organization" : "private"
                    }
                    editLevel={
                      editLevel === "private" ? "private" : "organization"
                    }
                    isOwner={dashboardOwnerId === userId}
                  />
                )}
              </Flex>
            </Text>
          )}
          <div style={{ flexGrow: 1 }} />
          <DashboardUpdateDisplay
            enableAutoUpdates={enableAutoUpdates}
            nextUpdate={nextUpdate}
            dashboardLastUpdated={dashboardLastUpdated}
            disabled={!!editSidebarDirty}
            isEditing={isEditing}
          />
          {isGeneralDashboard && setIsEditing && !isEditing && canEdit ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShareModalOpen(true)}
              >
                Share...
              </Button>
              <Button
                variant="solid"
                size="sm"
                className="mx-4"
                disabled={!canEdit}
                onClick={() => setIsEditing(true)}
              >
                <PiPencilSimpleFill className="mr-2" />
                Edit Blocks
              </Button>

              <MoreMenu>
                {canEdit && (
                  <Button
                    className="dropdown-item"
                    onClick={() => setEditDashboard(true)}
                  >
                    <Text weight="regular">Edit Dashboard Settings</Text>
                  </Button>
                )}
                <Button
                  className="dropdown-item"
                  onClick={() => setDuplicateDashboard(true)}
                >
                  <Text weight="regular">Duplicate</Text>
                </Button>
                <DropdownMenuSeparator />
                <DashboardViewQueriesButton
                  className="dropdown-item text-capitalize"
                  weight="regular"
                  size="2"
                />
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DeleteButton
                      displayName="Dashboard"
                      className="dropdown-item text-danger"
                      useIcon={false}
                      text="Delete"
                      title="Delete Dashboard"
                      onClick={async () => {
                        await apiCall(`/dashboards/${id}`, {
                          method: "DELETE",
                        });
                        if (typeof window !== "undefined") {
                          window.location.href = "/dashboards";
                        }
                      }}
                    />
                  </>
                )}
              </MoreMenu>
            </>
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
              {ownerName ? (
                <>
                  <UserAvatar name={ownerName} size="sm" variant="soft" />
                  <Text>{ownerName}</Text>
                </>
              ) : (
                "None"
              )}
            </Flex>
          </Flex>
        )}
      </div>
      <div>
        <div>
          {blocks.length === 0 ? (
            <Flex
              direction="column"
              align="center"
              justify="center"
              px="80px"
              pt="60px"
              pb="70px"
              className="appbox"
              gap="5"
            >
              <Flex direction="column">
                <Heading weight="medium" align="center">
                  Add Content Blocks
                </Heading>
                <Text align="center">
                  {addBlockType
                    ? "Choose a block type to get started."
                    : "Add some blocks to get started"}
                </Text>
              </Flex>
              {addBlockType ? (
                <AddBlockDropdown
                  addBlockType={addBlockType}
                  isGeneralDashboard={isGeneralDashboard}
                  trigger={
                    <Button
                      size="sm"
                      icon={<PiCaretDownFill />}
                      iconPosition="right"
                    >
                      Add Block
                    </Button>
                  }
                />
              ) : canEdit && setIsEditing ? (
                <Button size="md" onClick={() => setIsEditing(true)}>
                  Add Block
                </Button>
              ) : null}
            </Flex>
          ) : (
            blocks.map((block, i) =>
              renderSingleBlock({
                i,
                key: isPersistedDashboardBlock(block)
                  ? block.id
                  : `${block.type}-${i}`,
                block: block,
                isFocused: focusedBlockIndex === i,
                setBlock: setBlock ? (block) => setBlock(i, block) : undefined,
                isEditingBlock: stagedBlockIndex === i,
                isLastBlock: i === blocks.length - 1,
              }),
            )
          )}
          {/* Add padding at the bottom so there's room to scroll the selected block to the middle/top of the page */}
          {isEditing && <div style={{ height: 350 }} />}
        </div>
      </div>
    </div>
  );
}

export default withErrorBoundary(DashboardEditor, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
