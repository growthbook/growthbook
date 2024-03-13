import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useExperiments } from "@front-end/hooks/useExperiments";
import { useUser } from "@front-end/services/UserContext";
import LoadingOverlay from "@front-end/components/LoadingOverlay";
import { useFeaturesList } from "@front-end/services/features";

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
      router.replace("/getstarted");
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
