import React from "react";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Callout from "@/ui/Callout";
import ExperimentationHealthPage from "@/components/Settings/ExperimentationHealth/ExperimentationHealthPage";

const ExperimentationHealthSettingsPage: React.FC = () => {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  if (!hasCommercialFeature("experiment-quality-score")) {
    return (
      <div className="container pagecontents">
        <Box mt="4">
          <PremiumEmptyState
            title="Experimentation Health"
            description="Score every experiment 0–100 on completeness and trustworthiness — hypothesis, documented decisions and learnings, health checks, and optional AI review."
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
    return (
      <div className="container pagecontents">
        <Callout status="error" mt="4">
          You do not have permission to manage Experimentation Health settings.
        </Callout>
      </div>
    );
  }

  return (
    <div className="container pagecontents">
      <Box pt="4" pb="6" style={{ maxWidth: 980, margin: "0 auto" }}>
        <ExperimentationHealthPage />
      </Box>
    </div>
  );
};

export default ExperimentationHealthSettingsPage;
