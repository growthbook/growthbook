import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import GetStarted from "../components/HomePage/GetStarted";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { useDefinitions } from "../services/DefinitionsContext";

const getStartedPage = (): React.ReactElement => {
  const { data, error } = useApi<{
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
      <div className="container-fluid mt-3 pagecontents getstarted">
        <GetStarted experiments={data.experiments} />
      </div>
    </>
  );
};

export default getStartedPage;
