import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { useExperiments } from "@/hooks/useExperiments";
import LoadingOverlay from "../components/LoadingOverlay";
import { useFeaturesList } from "../services/features";

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
  }, [
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
