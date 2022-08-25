import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { useFeaturesList } from "../services/features";
import GetStarted from "../components/HomePage/GetStarted";
import { useDefinitions } from "../services/DefinitionsContext";
import GuidedGetStarted from "../components/GuidedGetStarted";
import { MetricInterface } from "back-end/types/metric";
import { useFeature } from "@growthbook/growthbook-react";

const GetStartedPage = (): React.ReactElement => {
  const guidedOnboarding = useFeature("guided-onboarding-test-august-2022").on;

  const { ready, error: definitionsError } = useDefinitions();

  const {
    data: experiments,
    error: experimentsError,
    mutate: mutateExperiments,
  } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments`);

  const { data } = useApi<{ metrics: MetricInterface[] }>(`/metrics`);

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

  if (!experiments || !features || !ready) {
    return <LoadingOverlay />;
  }

  if (guidedOnboarding) {
    return (
      <GuidedGetStarted
        experiments={experiments}
        features={features}
        data={data}
      />
    );
  } else {
    return (
      <>
        <div className="container pagecontents position-relative">
          <GetStarted
            experiments={experiments?.experiments || []}
            features={features}
            mutateExperiments={mutateExperiments}
            onboardingType={null}
          />
        </div>
      </>
    );
  }
};

export default GetStartedPage;
