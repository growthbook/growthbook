import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { FeatureInterface } from "back-end/types/feature";
import GetStarted from "../components/HomePage/GetStarted";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { useDefinitions } from "../services/DefinitionsContext";

const getStartedPage = (): React.ReactElement => {
  const { ready, error: definitionsError } = useDefinitions();

  const {
    data: experiments,
    error: experimentsError,
    mutate: mutateExperiments,
  } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments`);

  const {
    data: features,
    error: featuresError,
    mutate: mutateFeatures,
  } = useApi<{
    features: FeatureInterface[];
  }>(`/feature`);

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

  if (!experiments || !features || !ready) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <div className="container pagecontents position-relative">
        <GetStarted
          experiments={experiments?.experiments || []}
          features={features?.features || []}
          mutateExperiments={mutateExperiments}
          mutateFeatures={mutateFeatures}
          onboardingType={null}
        />
      </div>
    </>
  );
};

export default getStartedPage;
