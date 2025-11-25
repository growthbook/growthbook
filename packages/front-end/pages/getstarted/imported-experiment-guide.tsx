import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState, useEffect } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { Box, Separator } from "@radix-ui/themes";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useGetStarted } from "@/services/GetStartedProvider";

const ImportedExperimentGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { experiments, loading: experimentsLoading, error } = useExperiments();
  const {
    factTables,
    datasources,
    ready: definitionsReady,
    project,
  } = useDefinitions();
  const { setStep, clearStep } = useGetStarted();

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || "",
  );

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

  const loading = experimentsLoading && !definitionsReady;

  if (loading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  // Ignore the demo datasource
  const hasExperiments = project
    ? experiments.some(
        (e) => e.project !== demoProjectId && e.project === project,
      )
    : experiments.some((e) => e.project !== demoProjectId);

  const hasFactTables = factTables.length > 0;
  // Ignore the demo datasource
  const hasDatasource = datasources.some(
    (d) => !d.projects?.includes(demoProjectId),
  );

  return (
    <div className="container pagecontents p-4">
      <PageHead
        breadcrumb={[
          { display: "Get Started", href: "/getstarted" },
          { display: "Analyze Imported Experiments" },
        ]}
      />
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="get-started-experiment-guide"
          commercialFeature={null}
        />
      )}
      <h1 className="mb-3">Analyze Imported Experiments</h1>
      <div className="d-flex align-middle">
        <span>
          Want to run a new experiment?{" "}
          <Link href="/getstarted/experiment-guide">View instructions</Link>{" "}
          <PiArrowRight />
        </span>
      </div>
      <div className="row mt-4">
        <div className="col mr-auto" style={{ minWidth: 500 }}>
          <div className="appbox p-4">
            <div className="row">
              <div className="col-sm-auto">
                {hasDatasource ? (
                  <PiCheckCircleFill
                    className="mt-1"
                    style={{
                      fill: "#56BA9F",
                      width: "18.5px",
                      height: "18.5px",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      borderRadius: "50%",
                      borderStyle: "solid",
                      borderWidth: "0.6px",
                      borderColor: "#D3D4DB",
                      width: "15px",
                      height: "15px",
                      margin: "2px",
                    }}
                  />
                )}
              </div>
              <div className="col">
                <Link
                  href="/datasources"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasDatasource ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: "Connect to Your Data Warehouse",
                      source: "importedExperimentGuide",
                      stepKey: "connectDataWarehouse",
                    })
                  }
                >
                  Connect to Your Data Warehouse
                </Link>
                <Box mt="2">
                  Allow GrowthBook to query your warehouse to compute traffic
                  totals and metric results.
                </Box>
                <Separator size="4" my="4" />
              </div>
            </div>

            <div className="row">
              <div className="col-sm-auto">
                {hasFactTables ? (
                  <PiCheckCircleFill
                    className="mt-1"
                    style={{
                      fill: "#56BA9F",
                      width: "18.5px",
                      height: "18.5px",
                    }}
                  />
                ) : (
                  <div
                    className="mt-1"
                    style={{
                      borderRadius: "50%",
                      borderStyle: "solid",
                      borderWidth: "0.6px",
                      borderColor: "#D3D4DB",
                      width: "15px",
                      height: "15px",
                      margin: "2px",
                    }}
                  />
                )}
              </div>
              <div className="col">
                <Link
                  href="/fact-tables"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasFactTables ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: "Define Fact Tables and Metrics",
                      source: "importedExperimentGuide",
                      stepKey: "createFactTables",
                    })
                  }
                >
                  Define Fact Tables and Metrics
                </Link>
                <Box mt="2">
                  Define fact tables for the main events in your data warehouse
                  and build metrics based on those events.
                </Box>
                <Separator size="4" my="4" />
              </div>
            </div>

            <div className="row">
              <div className="col-sm-auto">
                {hasExperiments ? (
                  <PiCheckCircleFill
                    className="mt-1"
                    style={{
                      fill: "#56BA9F",
                      width: "18.5px",
                      height: "18.5px",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      borderRadius: "50%",
                      borderStyle: "solid",
                      borderWidth: "0.6px",
                      borderColor: "#D3D4DB",
                      width: "15px",
                      height: "15px",
                      margin: "2px",
                    }}
                  />
                )}
              </div>
              <div className="col">
                <Link
                  href="/experiments?analyzeExisting=true"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasExperiments ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: `Import Your First Experiment${
                        project && " in this Project"
                      } &
                      View Results`,
                      source: "importedExperimentGuide",
                      stepKey: "importExperiment",
                    })
                  }
                >
                  Import Your First Experiment{project && " in this Project"} &
                  View Results
                </Link>
                <Box mt="2">
                  Navigate to Experiments {">"} Add Experiment. In the popup,
                  select “Analyze an Existing Experiment”
                </Box>
              </div>
            </div>
          </div>
        </div>
        <div className="col-auto">
          <DocumentationSidebar
            setUpgradeModal={setUpgradeModal}
            type="imports"
          />
        </div>
      </div>
    </div>
  );
};

export default ImportedExperimentGuide;
