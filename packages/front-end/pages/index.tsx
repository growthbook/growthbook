import React from "react";
import Head from "next/head";
import Dashboard from "../components/HomePage/Dashboard";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import GetStarted from "../components/HomePage/GetStarted";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../hooks/useApi";
import { FeatureInterface } from "back-end/types/feature";
import FeaturesList from "../components/Features/FeaturesList";
import useUser from "../hooks/useUser";
import Link from "next/link";

export default function Home(): React.ReactElement {
  const { ready, error: definitionsError, project } = useDefinitions();
  const { name } = useUser();
  const {
    data: experiments,
    error: experimentsError,
    mutate: mutateExperiments,
  } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project}`);

  const { data: features, error: featuresError } = useApi<{
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
        {hasFeatures ? (
          <div className="">
            <h1>Hello {name}</h1>
            <h2>
              Features{" "}
              <Link href="/features">
                <a className="ml-3 h6">(see all)</a>
              </Link>
            </h2>
            <FeaturesList />
          </div>
        ) : hasExperiments ? (
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
          />
        )}
      </div>
    </>
  );
}
