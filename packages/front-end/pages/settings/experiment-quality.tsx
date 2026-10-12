import React from "react";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Callout from "@/ui/Callout";
import ExperimentQualityScoreSettings from "@/components/Settings/ExperimentQuality/ExperimentQualityScoreSettings";

const ExperimentQualityPage: React.FC = () => {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  if (!hasCommercialFeature("experiment-quality-score")) {
    return (
      <div className="container pagecontents">
        <Box mt="4">
          <PremiumEmptyState
            title="Experiment Quality Scoring"
            description="Score every experiment 0–100 on completeness and trustworthiness — hypothesis, documented decisions and learnings, health checks, and optional AI review."
            commercialFeature="experiment-quality-score"
            learnMoreLink="https://docs.growthbook.io/app/experiment-configuration"
          />
        </Box>
      </div>
    );
  }

  if (!permissionsUtil.canManageOrgSettings()) {
    return (
      <div className="container pagecontents">
        <Callout status="error" mt="4">
          You do not have permission to manage Experiment Quality settings.
        </Callout>
      </div>
    );
  }

  return (
    <div className="container pagecontents">
      <Box pt="4" pb="6" style={{ maxWidth: 920, margin: "0 auto" }}>
        <ExperimentQualityScoreSettings />
      </Box>
    </div>
  );
};

export default ExperimentQualityPage;
