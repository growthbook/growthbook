import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import { useFeaturesList } from "@/services/features";
import GetStartedAndHomePage from "@/components/GetStarted";
import LoadingOverlay from "@/components/LoadingOverlay";
import { AppFeatures } from "@/types/app-features";
import { isCloud } from "@/services/env";

export default function Home(): React.ReactElement {
  const router = useRouter();
  const {
    experiments,
    loading: experimentsLoading,
    error: experimentsError,
  } = useExperiments();

  const {
    features,
    loading: featuresLoading,
    error: featuresError,
  } = useFeaturesList(false);

  const { organization } = useUser();

  const gb = useGrowthBook<AppFeatures>();

  useEffect(() => {
    if (!organization) return;
    if (featuresLoading || experimentsLoading) {
      return;
    }

    const demoProjectId = getDemoDatasourceProjectIdForOrganization(
      organization.id || "",
    );

    // has features and experiments that are not demo projects
    const hasFeatures = features.some((f) => f.project !== demoProjectId);
    const hasExperiments = experiments.some((e) => e.project !== demoProjectId);
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
  }, [
    organization,
    features.length,
    experiments.length,
    featuresLoading,
    experimentsLoading,
  ]);

  if (experimentsError || featuresError) {
    return (
      <div className="alert alert-danger">
        {experimentsError?.message ||
          featuresError?.message ||
          "An error occurred"}
      </div>
    );
  }
  return featuresLoading || experimentsLoading ? (
    <LoadingOverlay />
  ) : (
    <GetStartedAndHomePage />
  );
}
