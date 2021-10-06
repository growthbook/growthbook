import React from "react";
import Head from "next/head";
import Dashboard from "../components/HomePage/Dashboard";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import GetStarted from "../components/HomePage/GetStarted";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../hooks/useApi";

export default function Home(): React.ReactElement {
  const {
    metrics,
    ready,
    datasources,
    project,
    error: definitionsError,
  } = useDefinitions();

  const { data, error, mutate } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project || ""}`);

  if (error || definitionsError) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error?.message || definitionsError}
      </div>
    );
  }

  if (!data || !ready) {
    return <LoadingOverlay />;
  }

  const hasDataSource = datasources.length > 0;
  const hasMetrics =
    metrics.filter((m) => !m.id.match(/^met_sample/)).length > 0;
  const hasExperiments =
    data?.experiments?.filter((e) => !e.id.match(/^exp_sample/))?.length > 0;
  const isNew = !project && !(hasMetrics && hasExperiments && hasDataSource);

  return (
    <>
      <Head>
        <title>GrowthBook</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {!ready && <LoadingOverlay />}

      {ready && isNew && (
        <div className="container-fluid mt-3 pagecontents getstarted">
          <GetStarted experiments={data.experiments} mutate={mutate} />
        </div>
      )}

      {ready && !isNew && (
        <>
          <Dashboard />
        </>
      )}
    </>
  );
}
