import { useState } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiLink } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { stripExplorerDraftFields } from "@/enterprise/components/ProductAnalytics/util";
import SaveToDashboardModal from "@/enterprise/components/ProductAnalytics/SaveToDashboardModal";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import ShareUrlPopover from "@/ui/ShareUrlPopover";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import UpgradeModal from "@/components/Settings/UpgradeModal";

export default function ExplorerPageActions() {
  const [showSaveToDashboardModal, setShowSaveToDashboardModal] =
    useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const {
    draftExploreState,
    exploration,
    compareEnabled,
    comparisonMode,
    comparisonExploration,
    loading,
    isSubmittable,
    isStale,
    needsFetch,
    trackingSource,
  } = useExplorerContext();
  const { project } = useDefinitions();
  const { hasCommercialFeature, permissionsUtil } = useUser();
  const canCreateDashboards = permissionsUtil.canCreateGeneralDashboards({
    projects: [project],
  });
  const canEditDashboards = permissionsUtil.canUpdateGeneralDashboards(
    { projects: [project] },
    {},
  );
  const hasDashboardsFeature = hasCommercialFeature(
    "product-analytics-dashboards",
  );
  const saveToDashboardDisabledReason =
    !canEditDashboards && !canCreateDashboards
      ? "You do not have permission to create or edit dashboards in this project."
      : !isSubmittable
        ? "Configure a valid exploration before saving."
        : loading || isStale || needsFetch
          ? "Run the updated exploration before saving to a dashboard."
          : undefined;

  return (
    <>
      {showSaveToDashboardModal && (
        <SaveToDashboardModal
          close={() => setShowSaveToDashboardModal(false)}
          config={stripExplorerDraftFields(draftExploreState)}
          exploration={exploration}
          compareEnabled={compareEnabled}
          previousTimeFrame={draftExploreState.previousTimeFrame ?? null}
          comparisonMode={comparisonMode}
          comparisonExplorationId={comparisonExploration?.id ?? null}
          trackingSource={trackingSource}
        />
      )}
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="product-analytics-explorer"
          commercialFeature="product-analytics-dashboards"
        />
      )}
      <Flex align="center" gap="2">
        <Tooltip
          body={saveToDashboardDisabledReason || ""}
          shouldDisplay={!!saveToDashboardDisabledReason}
        >
          <Button
            size="md"
            disabled={!!saveToDashboardDisabledReason}
            onClick={() => {
              if (!hasDashboardsFeature) {
                setShowUpgradeModal(true);
              } else {
                setShowSaveToDashboardModal(true);
              }
            }}
          >
            <Flex align="center" justify="center" gap="2">
              <PaidFeatureBadge
                commercialFeature="product-analytics-dashboards"
                useTip={false}
                inheritColor
              />
              Save to Dashboard
            </Flex>
          </Button>
        </Tooltip>
        <ShareUrlPopover
          title="Share this exploration"
          description="Anyone in your organization with read access to the Data Source this exploration uses, can open this exploration."
          trigger={
            <IconButton
              size="2"
              variant="solid"
              color="violet"
              aria-label="Share exploration link"
              style={{ height: 32, width: 32 }}
            >
              <PiLink size={20} />
            </IconButton>
          }
          side="bottom"
          align="end"
          onCopy={
            trackingSource
              ? () => {
                  track("Product Analytics Explorer: Copy Link Clicked", {
                    source: trackingSource,
                    type: draftExploreState.type,
                    chart_type: draftExploreState.chartType,
                  });
                }
              : undefined
          }
        />
      </Flex>
    </>
  );
}
