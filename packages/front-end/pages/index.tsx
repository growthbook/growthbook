import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useFeaturesList } from "@/services/features";

export default function Home(): React.ReactElement {
  const router = useRouter();
  const {
    experiments,
    loading: experimentsLoading,
    error: experimentsError,
  } = useExperiments();

invalid code

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
      organization.id || ""
    );

    const hasFeatures = features.some((f) => f.project !== demoProjectId);
    const hasExperiments = experiments.some((e) => e.project !== demoProjectId);

    if (hasFeatures) {
      router.replace("/features");
    } else if (hasExperiments) {
      router.replace("/experiments");
    } else {
      if (gb.isOn("use-new-setup-flow-2")) {
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

  return <LoadingOverlay />;
}
