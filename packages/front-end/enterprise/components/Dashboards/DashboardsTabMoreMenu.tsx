import { useState, useContext, useCallback, useMemo } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DashboardInterface } from "shared/enterprise";
import { ExperimentUpdateSchedule } from "shared/types/organization";
import { Flex, IconButton } from "@radix-ui/themes";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import Badge from "@/ui/Badge";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import { useAuth } from "@/services/auth";
import { DashboardSnapshotContext } from "./DashboardSnapshotProvider";
import { autoUpdateDisabledMessage } from "./DashboardsTab";

interface DashboardsTabMoreMenuProps {
  dashboard: DashboardInterface;
  experiment: ExperimentInterfaceStringDates;
  dashboardId: string;
  canEdit: boolean;
  canUpdateExperiment: boolean;
  canCreate: boolean;
  canDelete: boolean;
  updateSchedule?: ExperimentUpdateSchedule;
  copySupported: boolean;
  mutateExperiment?: () => void;
  setIsEditing: (value: boolean) => void;
  setShowEditModal: (value: boolean) => void;
  setShowDuplicateModal: (value: boolean) => void;
  toggleAutoUpdates: () => Promise<void>;
  performCopy: (text: string) => void;
  mutateDashboards: () => void;
  setDashboardId: (id: string) => void;
}

export default function DashboardsTabMoreMenu({
  dashboard,
  experiment,
  dashboardId,
  canEdit,
  canUpdateExperiment,
  canCreate,
  canDelete,
  updateSchedule,
  copySupported,
  mutateExperiment,
  setIsEditing,
  setShowEditModal,
  setShowDuplicateModal,
  toggleAutoUpdates,
  performCopy,
  mutateDashboards,
  setDashboardId,
}: DashboardsTabMoreMenuProps) {
  const { apiCall } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);

  const { allQueries, savedQueriesMap, snapshotError } = useContext(
    DashboardSnapshotContext,
  );

  const savedQueryIds = [...savedQueriesMap.keys()];
  const queryStrings = useMemo(() => {
    return allQueries.map((q) => q.query) ?? [];
  }, [allQueries]);

  const error = snapshotError;
  const count = queryStrings.length + savedQueryIds.length;

  // View Queries: Opens modal showing all async queries for this dashboard
  const handleViewQueries = useCallback(() => {
    setQueriesModalOpen(true);
    setDropdownOpen(false);
  }, []);

  return (
    <>
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            size="3"
            highContrast
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
            <>
              <DropdownMenuItem
                onClick={() => {
                  setIsEditing(true);
                  setDropdownOpen(false);
                }}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setShowEditModal(true);
                  setDropdownOpen(false);
                }}
              >
                Edit Dashboard Settings
              </DropdownMenuItem>
              {mutateExperiment && canUpdateExperiment && (
                <Tooltip
                  body={
                    dashboard.shareLevel !== "published"
                      ? "Only published dashboards can be set as the default view"
                      : experiment.defaultDashboardId === dashboard.id
                        ? "Remove this dashboard as the default view for the experiment"
                        : "Set this dashboard as the default view for the experiment"
                  }
                >
                  <DropdownMenuItem
                    disabled={dashboard.shareLevel !== "published"}
                    onClick={async () => {
                      await apiCall(`/experiment/${experiment.id}`, {
                        method: "POST",
                        body: JSON.stringify({
                          defaultDashboardId:
                            experiment.defaultDashboardId === dashboard.id
                              ? ""
                              : dashboard.id,
                        }),
                      });
                      mutateExperiment();
                      setDropdownOpen(false);
                    }}
                  >
                    {experiment.defaultDashboardId === dashboard.id
                      ? "Remove as Default View"
                      : "Set as Default View"}
                  </DropdownMenuItem>
                </Tooltip>
              )}

              <DropdownMenuSeparator />
            </>
          )}
          {canEdit && (
            <Tooltip
              body={autoUpdateDisabledMessage}
              shouldDisplay={updateSchedule?.type === "never"}
            >
              <DropdownMenuItem
                disabled={updateSchedule?.type === "never"}
                onClick={async () => {
                  await toggleAutoUpdates();
                  setDropdownOpen(false);
                }}
              >
                {dashboard.enableAutoUpdates ? "Disable" : "Enable"} Auto-update
              </DropdownMenuItem>
            </Tooltip>
          )}
          {queryStrings.length > 0 || savedQueryIds.length > 0 ? (
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
          ) : null}
          <DropdownMenuSeparator />
          {copySupported && (
            <DropdownMenuItem
              onClick={() => {
                const url = window.location.href.replace(
                  /[?#].*/,
                  `#dashboards/${dashboardId}`,
                );
                performCopy(url);
                setDropdownOpen(false);
              }}
            >
              Share
            </DropdownMenuItem>
          )}
          {canCreate && (
            <DropdownMenuItem
              onClick={() => {
                setShowDuplicateModal(true);
                setDropdownOpen(false);
              }}
            >
              <Flex align="center" gap="2">
                Duplicate
                <PaidFeatureBadge commercialFeature="dashboards" />
              </Flex>
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              color="red"
              confirmation={{
                confirmationTitle: (
                  <>
                    Delete Dashboard <i>{dashboard.title}</i>?
                  </>
                ),
                cta: "Delete",
                submit: async () => {
                  await apiCall(`/dashboards/${dashboard.id}`, {
                    method: "DELETE",
                  });
                  mutateDashboards();
                  setDashboardId("");
                },
                closeDropdown: () => {
                  setDropdownOpen(false);
                },
              }}
            >
              Delete
            </DropdownMenuItem>
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
    </>
  );
}
