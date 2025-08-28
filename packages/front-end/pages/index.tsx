import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import { useFeaturesList } from "@/services/features";
import GetStartedAndHomePage from "@/components/GetStarted";
import LoadingOverlay from "@/components/LoadingOverlay";

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

  const gb = useGrowthBook();

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
    if (!hasFeatureOrExperiment) {
      if (
        gb.isOn("use-new-setup-flow-2") &&
        !organization.isVercelIntegration
      ) {
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
