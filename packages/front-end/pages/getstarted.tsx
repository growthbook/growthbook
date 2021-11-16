import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import GetStarted from "../components/HomePage/GetStarted";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { useDefinitions } from "../services/DefinitionsContext";

const getStartedPage = (): React.ReactElement => {
  const { data, mutate, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");
  const { ready, error: definitionsError } = useDefinitions();

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

  return (
    <>
      <div className="container-fluid pagecontents getstarted">
        <GetStarted experiments={data.experiments} mutate={mutate} />
      </div>
    </>
  );
};

export default getStartedPage;
