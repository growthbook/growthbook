import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import DocumentationDisplay from "@/components/GetStarted/DocumentationDisplay";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useFeaturesList } from "@/services/features";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";

const ImportedExperimentGuide = (): React.ReactElement => {
  const { organization, userId } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { data: sdkConnections } = useSDKConnections();
  const { experiments, loading, error, mutateExperiments } = useExperiments();
  const { factTables, datasources, ready } = useDefinitions();
  const isSDKIntegrated =
    sdkConnections?.connections.some((c) => c.connected) || false;
  const demoDatasourceProject = getDemoDatasourceProjectIdForOrganization(
    organization.id || ""
  );
  // Ignore the demo datasource
  const hasExperiments = experiments.some(
    (e) => e.project !== demoDatasourceProject
  );

  const hasFactTables = factTables.length > 0;
  // Ignore the demo datasource
  const hasDatasource = datasources.some(
    (d) => !d.projects?.includes(demoDatasourceProject)
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
      <div className="d-flex mt-5">
        <div className="flex-fill mr-5">
          <div
            className="p-4"
            style={{
              background: "#FFFFFF",
              border: "1px solid",
              borderRadius: "4px",
              borderColor: "#F5F2FF",
            }}
          >
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
                  Allow GrowthBook to communicate with your data warehouse.
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
                  Define Fact Tables
                </Link>
                <p className="mt-2">
                  Define fact tables for the main events you want to report on
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
                  Import Your First Experiment & View Results
                </Link>
                <p className="mt-2">
                  Navigate to Experiments {">"} Add Experiment. In the popup,
                  select “Analyze an Existing Experiment”
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="">
          <DocumentationDisplay
            setUpgradeModal={setUpgradeModal}
            type="imports"
          />
        </div>
      </div>
    </div>
  );
};

export default ImportedExperimentGuide;
