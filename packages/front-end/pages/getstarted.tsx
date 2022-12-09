import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useFeature } from "@growthbook/growthbook-react";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { useFeaturesList } from "../services/features";
import GetStarted from "../components/HomePage/GetStarted";
import { useDefinitions } from "../services/DefinitionsContext";
import usePermissions from "../hooks/usePermissions";
import GuidedGetStarted from "../components/GuidedGetStarted/GuidedGetStarted";

const GetStartedPage = (): React.ReactElement => {
  const permissions = usePermissions();
  const guidedOnboarding = useFeature("guided-onboarding-test-august-2022").on;

  const { ready, error: definitionsError } = useDefinitions();

  const {
    data: experiments,
    error: experimentsError,
    mutate: mutateExperiments,
  } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments`);

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

  if (permissions.organizationSettings && guidedOnboarding) {
    return (
      <>
        <div className="container pagecontents position-relative">
          <GuidedGetStarted
            experiments={experiments?.experiments || []}
            features={features}
            mutate={mutateExperiments}
          />
        </div>
      </>
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
