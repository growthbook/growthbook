import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState, useEffect } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import clsx from "clsx";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useGetStarted } from "@/services/GetStartedProvider";
import LoadingOverlay from "@/components/LoadingOverlay";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";
import styles from "@/components/GetStarted/GetStarted.module.scss";

const ExperimentGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { data: sdkConnections } = useSDKConnections();
  const { experiments, loading: experimentsLoading, error } = useExperiments();
  const { project, ready: definitionsReady } = useDefinitions();
  const { setStep, clearStep } = useGetStarted();

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

  const loading = experimentsLoading && !sdkConnections && !definitionsReady;

  if (loading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

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

  return (
    <div className={clsx(styles.getStartedPage, "container pagecontents p-4")}>
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
          <Link href="/getstarted/imported-experiment-guide">
            View import instructions
          </Link>{" "}
          <PiArrowRight />
        </span>
        <ViewSampleDataButton />
      </div>
      <div className="d-flex">
        <div className="flex-fill mr-5">
          <div className="appbox p-4">
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
                  onClick={() =>
                    setStep({
                      step: "Integrate the GrowthBook SDK into your app",
                      source: "experiments",
                      stepKey: "sdk",
                    })
                  }
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
                  onClick={() =>
                    setStep({
                      step: project
                        ? "Design the First Experiment for this Project"
                        : "Design Your Organization’s First Experiment",
                      source: "experiments",
                      stepKey: "createExperiment",
                    })
                  }
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
                  onClick={() =>
                    setStep({
                      step: "Start the Test",
                      source: "experiments",
                      stepKey: "startExperiment",
                    })
                  }
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
          <DocumentationSidebar
            setUpgradeModal={setUpgradeModal}
            type="experiments"
          />
        </div>
      </div>
    </div>
  );
};

export default ExperimentGuide;
