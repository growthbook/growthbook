import React from "react";
import { useExperiments } from "@/hooks/useExperiments";
import LoadingOverlay from "../components/LoadingOverlay";
import { useFeaturesList } from "../services/features";
import { useDefinitions } from "../services/DefinitionsContext";
import GuidedGetStarted from "../components/GuidedGetStarted/GuidedGetStarted";

const GetStartedPage = (): React.ReactElement => {
  const { ready, error: definitionsError } = useDefinitions();

  const {
    experiments,
    error: experimentsError,
    mutateExperiments,
    loading: experimentsLoading,
  } = useExperiments();

  const { features, error: featuresError } = useFeaturesList();

  if (featuresError || experimentsError || definitionsError) {
    return (
      <div className="alert alert-danger">
        An error occurred:{" "}
        {featuresError?.message ||
          experimentsError?.message ||
          definitionsError}
      </div>
    );
  }

  if (experimentsLoading || !features || !ready) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container pagecontents position-relative">
      <GuidedGetStarted
        experiments={experiments}
        features={features}
        mutate={mutateExperiments}
      />
    </div>
  );
};

export default GetStartedPage;
