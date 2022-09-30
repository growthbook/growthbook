import React, { useEffect } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../hooks/useApi";
import { useFeaturesList } from "../services/features";
import { useRouter } from "next/router";

export default function Home(): React.ReactElement {
  const router = useRouter();
  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments`);

  const { features, loading, error: featuresError } = useFeaturesList(false);

  useEffect(() => {
    if (loading || !data) {
      return;
    }

    if (features.length) {
      router.replace("/features");
    } else if (data.experiments?.length) {
      router.replace("/experiments");
    } else {
      router.replace("/getstarted");
    }
  }, [features, data, loading]);

  if (error || featuresError) {
    return (
      <div className="alert alert-danger">
        {error?.message || featuresError?.message || "An error occurred"}
      </div>
    );
  }

  return <LoadingOverlay />;
}
