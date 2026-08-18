import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import SaveFunnelMetricModal from "@/enterprise/components/ProductAnalytics/SaveFunnelMetricModal";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";

export default function SaveFunnelMetricAction() {
  const {
    draftExploreState,
    linkedFunnelMetricId,
    setLinkedFunnelMetricId,
    isSubmittable,
    trackingSource,
  } = useExplorerContext();
  const { getFactTableById, project } = useDefinitions();
  const { hasCommercialFeature, permissionsUtil } = useUser();

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const dataset =
    draftExploreState.dataset?.type === "funnel"
      ? draftExploreState.dataset
      : null;

  const hasFunnelMetricsFeature = hasCommercialFeature("funnel-metrics");
  const primaryFactTable = getFactTableById(
    dataset?.steps[0]?.factTableId ?? "",
  );
  const defaultProjects = primaryFactTable?.projects?.length
    ? primaryFactTable.projects
    : project
      ? [project]
      : [];
  const canCreateFactMetric = permissionsUtil.canCreateFactMetric({
    projects: defaultProjects,
  });

  const disabledReason = linkedFunnelMetricId
    ? // Saving a loaded funnel as a *new* metric quietly creates a near
      // duplicate. Update-vs-save-as-new is Phase 3's job; until then a linked
      // funnel isn't a save candidate.
      'Loaded from a saved metric. Choose "None — build a new funnel" to save a new one.'
    : !canCreateFactMetric
      ? "You do not have permission to create Fact Metrics in this Project."
      : !isSubmittable
        ? "Finish configuring the funnel before saving it as a metric."
        : "";

  if (!dataset) return null;

  return (
    <>
      <Tooltip body={disabledReason} shouldDisplay={!!disabledReason}>
        <Button
          size="md"
          variant="soft"
          disabled={!!disabledReason}
          onClick={() => {
            if (!hasFunnelMetricsFeature) {
              setShowUpgradeModal(true);
            } else {
              setShowSaveModal(true);
            }
          }}
        >
          <Flex align="center" justify="center" gap="2">
            <PaidFeatureBadge
              commercialFeature="funnel-metrics"
              useTip={false}
              inheritColor
            />
            Save as funnel metric
          </Flex>
        </Button>
      </Tooltip>

      {showSaveModal && (
        <SaveFunnelMetricModal
          close={() => setShowSaveModal(false)}
          dataset={dataset}
          datasourceId={draftExploreState.datasource}
          onSaved={(metric) => setLinkedFunnelMetricId(metric.id)}
          trackingSource={trackingSource}
        />
      )}
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="funnel-builder-save-metric"
          commercialFeature="funnel-metrics"
        />
      )}
    </>
  );
}
