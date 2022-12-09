import React from "react";
import Head from "next/head";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Dashboard from "../components/HomePage/Dashboard";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import useApi from "../hooks/useApi";
import ExperimentsGetStarted from "../components/HomePage/ExperimentsGetStarted";

export default function Analysis(): React.ReactElement {
  const { ready, error: definitionsError, project } = useDefinitions();

  const {
    data: experiments,
    error: experimentsError,
    mutate: mutateExperiments,
  } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project}`);

  if (experimentsError || definitionsError) {
    return (
      <div className="alert alert-danger">
        An error occurred: {experimentsError?.message || definitionsError}
      </div>
    );
  }

  if (!experiments || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments =
    experiments?.experiments?.filter((e) => !e.id.match(/^exp_sample/))
      ?.length > 0;

  return (
    <>
      <Head>
        <title>GrowthBook</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="container pagecontents position-relative">
        {hasExperiments ? (
          <Dashboard experiments={experiments?.experiments || []} />
        ) : (
          <div className="getstarted">
            <h1>Experiment Analysis</h1>
            <p>
              GrowthBook can pull experiment results directly from your data
              source and analyze it with our statistics engine. Start by
              connecting to your data source and defining metrics.
            </p>
            <ExperimentsGetStarted
              experiments={experiments?.experiments || []}
              mutate={mutateExperiments}
            />
          </div>
        )}
      </div>
    </>
  );
}
