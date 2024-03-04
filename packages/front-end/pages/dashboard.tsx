import React from "react";
import Head from "next/head";
import { useExperiments } from "@/hooks/useExperiments";
import Dashboard from "@/components/HomePage/Dashboard";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExperimentsGetStarted from "@/components/HomePage/ExperimentsGetStarted";

export default function Analysis(): React.ReactElement {
  const { ready, error: definitionsError, project } = useDefinitions();

  const {
    experiments,
    error: experimentsError,
    loading: experimentsLoading,
  } = useExperiments(project);

  if (experimentsError || definitionsError) {
    return (
      <div className="alert alert-danger">
        An error occurred: {experimentsError?.message || definitionsError}
      </div>
    );
  }

  if (experimentsLoading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments =
    experiments.filter((e) => !e.id.match(/^exp_sample/))?.length > 0;

  return (
    <>
      <Head>
        <title>GrowthBook</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="container pagecontents position-relative">
        {hasExperiments ? (
          <Dashboard experiments={experiments} />
        ) : (
          <div className="getstarted">
            <ExperimentsGetStarted />
          </div>
        )}
      </div>
    </>
  );
}
