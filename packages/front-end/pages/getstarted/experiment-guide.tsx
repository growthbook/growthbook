import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useRouter } from "next/router";
import { ProjectInterface } from "@back-end/types/project";
import DocumentationDisplay from "@/components/GetStarted/DocumentationDisplay";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useFeaturesList } from "@/services/features";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

const ExperimentGuide = (): React.ReactElement => {
  const { organization, userId } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { data: sdkConnections } = useSDKConnections();
  const { experiments, loading, error, mutateExperiments } = useExperiments();
  const { mutateDefinitions } = useDefinitions();
  const router = useRouter();
  const { apiCall } = useAuth();
  const isSDKIntegrated =
    sdkConnections?.connections.some((c) => c.connected) || false;
  // Ignore the demo datasource
  const hasExperiments = experiments.some(
    (e) =>
      e.project !==
      getDemoDatasourceProjectIdForOrganization(organization.id || "")
  );

  const hasStartedExperiment = experiments.some(
    (e) =>
      e.project !==
        getDemoDatasourceProjectIdForOrganization(organization.id || "") &&
      e.status !== "draft"
  );

  const { projectId: demoDataSourceProjectId, demoExperimentId } =
    useDemoDataSourceProject();

  const openSampleExperiment = async () => {
    if (demoDataSourceProjectId && demoExperimentId) {
      router.push(`/experiment/${demoExperimentId}`);
    } else {
      track("Create Sample Project", {
        source: "experiments-get-started",
      });
      const res = await apiCall<{
        project: ProjectInterface;
        experimentId: string;
      }>("/demo-datasource-project", {
        method: "POST",
      });
      await mutateDefinitions();
      if (res.experimentId) {
        router.push(`/experiment/${res.experimentId}`);
      } else {
        throw new Error("Could not create sample experiment");
      }
    }
  };

  return (
    <div className="container pagecontents p-4">
      <PageHead
        breadcrumb={[
          { display: "Get Started", href: "/getstarted" },
          { display: "Run an Experiment" },
        ]}
      />
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="get-started-experiment-guide"
        />
      )}
      <h1 className="mb-3">Run an Experiment</h1>
      <div className="d-flex align-middle">
        <span>
          Ran experiments on another platform?{" "}
          <Link href="/importing/launchdarkly">
            View migration instructions
          </Link>{" "}
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
                {isSDKIntegrated ? (
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
                  href="/sdks"
                  style={{ fontSize: "17px", fontWeight: 600 }}
                >
                  Integrate the GrowthBook SDK into your app
                </Link>
                <p className="mt-2">
                  Allow GrowthBook to communicate with your app.
                </p>
                <hr />
              </div>
            </div>

            <div className="row">
              <div className="col-sm-auto">
                {!isSDKIntegrated ? (
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
                  href="/environments"
                  style={{ fontSize: "17px", fontWeight: 600 }}
                >
                  Review or Add Environments
                </Link>
                <p className="mt-2">
                  By default, GrowthBook comes with one
                  environment—production—but you can add as many as you need.
                </p>
                <hr />
              </div>
            </div>

            <div className="row">
              <div className="col-sm-auto">
                {!isSDKIntegrated ? (
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
                  href="/attributes"
                  style={{ fontSize: "17px", fontWeight: 600 }}
                >
                  Set up User Attributes
                </Link>
                <p className="mt-2">
                  Add metrics to define how experiments will be measured and
                  analyzed in GrowthBook.
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
                  style={{ fontSize: "17px", fontWeight: 600 }}
                >
                  Design Your Organization’s First Experiment
                </Link>
                <p className="mt-2">
                  Create an experiment and add changes to variations. Choose
                  from URL Redirect, Feature Flag or Visual Editor (Pro).
                </p>
              </div>
              <hr />
            </div>

            <div className="row">
              <div className="col-sm-auto">
                {hasStartedExperiment ? (
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
                  style={{ fontSize: "17px", fontWeight: 600 }}
                >
                  <Tooltip
                    body={
                      <div>
                        <img
                          className="mb-3"
                          src="/images/get-started/start-experiment.png"
                          width={"260px"}
                          height={"96px"}
                        />
                        <h4>Start the Test</h4>
                        <p className="text-muted">
                          Experiments {">"} [selected experiment]
                        </p>

                        <p style={{ fontSize: "15px" }}>
                          Click the “Start Experiment” button in the top right
                          corner of the selected experiment.
                        </p>
                      </div>
                    }
                    popperStyle={{ maxWidth: "300px" }}
                  >
                    Start the Test
                  </Tooltip>
                </Link>
                <p className="mt-2">
                  Define any additional settings, rules and targeting as
                  desired. Then, click “Run experiment.”
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="">
          <DocumentationDisplay
            setUpgradeModal={setUpgradeModal}
            type="experiments"
          />
        </div>
      </div>
    </div>
  );
};

export default ExperimentGuide;
function mutateDefinitions() {
  throw new Error("Function not implemented.");
}
