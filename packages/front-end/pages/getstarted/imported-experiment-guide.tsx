import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import clsx from "clsx";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import styles from "@/components/GetStarted/GetStarted.module.scss";

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
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || ""
  );

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
        (e) => e.project !== demoProjectId && e.project === project
      )
    : experiments.some((e) => e.project !== demoProjectId);

  const hasFactTables = factTables.length > 0;
  // Ignore the demo datasource
  const hasDatasource = datasources.some(
    (d) => !d.projects?.includes(demoProjectId)
  );

  return (
    <div className={clsx(styles.getStartedPage, "container pagecontents p-4")}>
      <PageHead
        breadcrumb={[
          { display: "Get Started", href: "/getstarted" },
          { display: "Analyze Imported Experiments" },
        ]}
      />
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="get-started-experiment-guide"
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
      <div className="d-flex mt-4">
        <div className="flex-fill mr-5">
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
                >
                  Connect to Your Data Warehouse
                </Link>
                <p className="mt-2">
                  Allow GrowthBook to query your warehouse to compute traffic
                  totals and metric results.
                </p>
                <hr />
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
                >
                  Define Fact Tables and Metrics
                </Link>
                <p className="mt-2">
                  Define fact tables for the main events in your data warehouse
                  and build metrics based on those events.
                </p>
                <hr />
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
                  href="/experiments"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasExperiments ? "line-through" : "none",
                  }}
                >
                  Import Your First Experiment{project && " in this Project"} &
                  View Results
                </Link>
                <p className="mt-2">
                  Navigate to Experiments {">"} Add Experiment. In the popup,
                  select “Analyze an Existing Experiment”
                </p>
              </div>
            </div>
          </div>
        </div>
        <div>
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
