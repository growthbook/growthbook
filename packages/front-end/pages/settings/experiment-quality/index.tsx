import React from "react";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { SettingsNoAccess } from "@/components/Layout/SettingsPage";
import ExperimentQualityPage from "@/components/Settings/ExperimentQuality/ExperimentQualityPage";

const ExperimentQualitySettingsPage: React.FC = () => {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  if (!hasCommercialFeature("experiment-quality-score")) {
    return (
      <div className="container pagecontents">
        <Box mt="4">
          <PremiumEmptyState
            title="Experiment Quality"
            description="Score every experiment 0–100 on how well it's documented and run."
            commercialFeature="experiment-quality-score"
            learnMoreLink="https://docs.growthbook.io/app/experiment-configuration"
          />
        </Box>
      </div>
    );
  }

  if (
    !permissionsUtil.canManageOrgSettings() &&
    !permissionsUtil.canManageSomeProjects()
  ) {
    return <SettingsNoAccess title="Experiment Quality" />;
  }

  return <ExperimentQualityPage />;
};

export default ExperimentQualitySettingsPage;
