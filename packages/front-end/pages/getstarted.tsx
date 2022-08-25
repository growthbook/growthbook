import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { useFeaturesList } from "../services/features";
import GetStarted from "../components/HomePage/GetStarted";
import { DimensionInterface } from "back-end/types/dimension";
import { useDefinitions } from "../services/DefinitionsContext";
import { useGrowthBook } from "@growthbook/growthbook-react";
import GuidedGetStarted from "../components/GuidedGetStarted";
import { MetricInterface } from "back-end/types/metric";

export type Task = {
  title: string;
  text: string;
  cta: string;
  learnMoreLink?: string;
  link?: string;
  completed: boolean;
  onClick: (
    value: boolean | null
  ) =>
    | void
    | Promise<void>
    | ((value: null | Partial<DimensionInterface>) => void);
};

export type HelpLink = {
  title: string;
  helpText: string;
  url: string;
};

const GetStartedPage = (): React.ReactElement => {
  const growthbook = useGrowthBook();
  const guidedOnboarding = growthbook.feature(
    "guided-onboarding-test-august-2022"
  );
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
