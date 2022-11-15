import React, { useEffect } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { useFeaturesList } from "../services/features";
import { useRouter } from "next/router";
import { useExperiments } from "../hooks/useExperiments";

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

  useEffect(() => {
    if (featuresLoading || experimentsLoading) {
      return;
    }

    if (features.length) {
      router.replace("/features");
    } else if (experiments.length) {
      router.replace("/experiments");
    } else {
      router.replace("/getstarted");
    }
  }, [features, experiments, experimentsLoading, featuresLoading]);

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
