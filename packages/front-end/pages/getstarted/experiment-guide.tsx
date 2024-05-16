import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useRouter } from "next/router";
import { ProjectInterface } from "@back-end/types/project";
import DocumentationDisplay from "@/components/GetStarted/DocumentationDisplay";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Button";
import { useGetStarted } from "@/services/GetStartedProvider";

const ExperimentGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { data: sdkConnections } = useSDKConnections();
  const { experiments, loading, error, mutateExperiments } = useExperiments();
  const { mutateDefinitions, project } = useDefinitions();
  const { setStep } = useGetStarted();
  const router = useRouter();
  const { apiCall } = useAuth();
  const isSDKIntegrated =
    sdkConnections?.connections.some((c) => c.connected) || false;
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || ""
  );
  // Ignore the demo datasource
  const hasExperiments = project
    ? experiments.some(
        (e) => e.project !== demoProjectId && e.project === project
      )
    : experiments.some((e) => e.project !== demoProjectId);

  const manualChecks = organization.getStartedChecklists?.experiments;
  const environmentsReviewed = manualChecks?.find(
    (c) => c.step === "environments"
  );
  const attributesSet = manualChecks?.find((c) => c.step === "attributes");

  const hasStartedExperiment = project
    ? experiments.some(
        (e) =>
          e.project !== demoProjectId &&
          e.status !== "draft" &&
          e.project === project
      )
    : experiments.some(
        (e) => e.project !== demoProjectId && e.status !== "draft"
      );

  const { demoExperimentId } = useDemoDataSourceProject();

  const openSampleExperiment = async () => {
    if (demoProjectId && demoExperimentId) {
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
      <div className="d-flex align-middle justify-content-between mb-4">
        <span>
          Ran experiments on another platform?{" "}
          <Link href="/importing/launchdarkly">
            View migration instructions
          </Link>{" "}
          <PiArrowRight />
        </span>
        <Button
          style={{
            width: "250px",
            background: "#EDE9FE",
            color: "#5746AF",
            fontWeight: 400,
            border: "1px solid #C4B8F3",
          }}
          onClick={openSampleExperiment}
        >
          View Sample Data
        </Button>
      </div>
      <div className="d-flex">
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
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: isSDKIntegrated ? "line-through" : "none",
                  }}
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
                {environmentsReviewed ? (
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
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: environmentsReviewed
                      ? "line-through"
                      : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: "Review or Add Environments",
                      source: "experiments",
                      stepKey: "environments",
                    })
                  }
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
                {attributesSet ? (
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
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: attributesSet ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: "Customize Targeting Attributes",
                      source: "experiments",
                      stepKey: "attributes",
                    })
                  }
                >
                  Customize Targeting Attributes
                </Link>
                <p className="mt-2">
                  Define user attributes to use for targeting experiments and
                  for use in randomization
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
                  {project
                    ? "Design the First Experiment for this Project"
                    : "Design Your Organization’s First Experiment"}
                </Link>
                <p className="mt-2">
                  Create an experiment and change variations. Choose from
                  Feature Flags, URL Redirects, or the Visual Editor (Pro).
                </p>
                <hr />
              </div>
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
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasStartedExperiment
                      ? "line-through"
                      : "none",
                  }}
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
