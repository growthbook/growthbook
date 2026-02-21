import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useUser } from "@/services/UserContext";
import GetStartedAndHomePage from "@/components/GetStarted";
import LoadingOverlay from "@/components/LoadingOverlay";
import { AppFeatures } from "@/types/app-features";
import { isCloud } from "@/services/env";
import useApi from "@/hooks/useApi";

export default function Home(): React.ReactElement {
  const router = useRouter();
  const { data, error } = useApi<{
    hasFeatures: boolean;
    hasExperiments: boolean;
  }>("/organization/feature-exp-usage");

  const { organization } = useUser();

  const gb = useGrowthBook<AppFeatures>();

  useEffect(() => {
    if (!organization) return;
    if (!data) {
      return;
    }

    // has features and experiments that are not demo projects
    const { hasFeatures, hasExperiments } = data;
    const hasFeatureOrExperiment = hasFeatures || hasExperiments;
    const intentToExperiment =
      organization?.demographicData?.ownerUsageIntents?.includes(
        "experiments",
      ) ||
      organization?.demographicData?.ownerUsageIntents?.length === 0 ||
      !organization?.demographicData?.ownerUsageIntents; // If no intents, assume interest in experimentation

    if (!hasFeatureOrExperiment) {
      const useNewOnboarding =
        intentToExperiment &&
        isCloud() &&
        gb.isOn("experimentation-focused-onboarding");
      if (!organization.isVercelIntegration && !useNewOnboarding) {
        router.replace("/setup");
      } else {
        router.replace("/getstarted");
      }
    }
  }, [organization, data?.hasFeatures, data?.hasExperiments]);

  if (error) {
    return (
      <div className="alert alert-danger">
        {error.message || "An error occurred"}
      </div>
    );
  }
  return !data ? <LoadingOverlay /> : <GetStartedAndHomePage />;
}
