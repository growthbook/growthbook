import React from "react";
import Head from "next/head";
import Dashboard from "../components/HomePage/Dashboard";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import GetStarted from "../components/HomePage/GetStarted";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../hooks/useApi";
import { FeatureInterface } from "back-end/types/feature";

export default function Home(): React.ReactElement {
  const { ready, error: definitionsError, project } = useDefinitions();

  const {
    data: experiments,
    error: experimentsError,
    mutate: mutateExperiments,
  } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project}`);

  const {
    data: features,
    error: featuresError,
    mutate: mutateFeatures,
  } = useApi<{
    features: FeatureInterface[];
  }>(`/feature?project=${project}`);

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

  const hasExperiments =
    experiments?.experiments?.filter((e) => !e.id.match(/^exp_sample/))
      ?.length > 0;

  const hasFeatures = features?.features?.length > 0;

  return (
    <>
      <Head>
        <title>GrowthBook</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="container pagecontents position-relative">
        {hasExperiments || hasFeatures ? (
          <Dashboard
            features={features?.features || []}
            experiments={experiments?.experiments || []}
          />
        ) : (
          <GetStarted
            experiments={experiments?.experiments || []}
            features={features?.features || []}
            mutateExperiments={mutateExperiments}
            onboardingType={"features"}
            mutateFeatures={mutateFeatures}
          />
        )}
      </div>
    </>
  );
}
