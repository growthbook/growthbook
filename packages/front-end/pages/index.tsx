import React from "react";
import Head from "next/head";
import Dashboard from "../components/HomePage/Dashboard";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import GetStarted from "../components/HomePage/GetStarted";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../hooks/useApi";

export default function Home(): React.ReactElement {
  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");
  const {
    metrics,
    ready,
    datasources,
    error: definitionsError,
  } = useDefinitions();

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
  const hasMetrics = metrics.length > 0;
  const hasExperiments = data?.experiments?.length > 0;
  const isNew = !(hasMetrics && hasExperiments && hasDataSource);

  return (
    <>
      <Head>
        <title>Growth Book</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {!ready && <LoadingOverlay />}

      {ready && isNew && (
        <div className="container-fluid mt-3 pagecontents getstarted">
          <GetStarted experiments={data.experiments} />
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
