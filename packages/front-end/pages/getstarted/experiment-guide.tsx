import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState, useEffect } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { Box, Separator } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { GeneratedHypothesisInterface } from "shared/types/generated-hypothesis";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useGetStarted } from "@/services/GetStartedProvider";
import LoadingOverlay from "@/components/LoadingOverlay";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";

const ExperimentGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { data: sdkConnections } = useSDKConnections();
  const { experiments, loading: experimentsLoading, error } = useExperiments();
  const { project, ready: definitionsReady, datasources } = useDefinitions();
  const { setStep, clearStep } = useGetStarted();

  const router = useRouter();
  const params = router.query;
  const { apiCall } = useAuth();
  const [generatedHypothesis, setGeneratedHypothesis] =
    useState<GeneratedHypothesisInterface | null>(null);
  const [loadingHypothesis, setLoadingHypothesis] = useState(false);

  useEffect(() => {
    if (!params.hypId) return;
    // if there is a hypId query param provided, block page until things are
    // loaded
    const load = async () => {
      try {
        setLoadingHypothesis(true);
        const { generatedHypothesis } = await apiCall<{
          generatedHypothesis: GeneratedHypothesisInterface;
        }>(`/generated-hypothesis/${params.hypId}`);
        setGeneratedHypothesis(generatedHypothesis);
      } catch (e) {
        console.error("Error loading generated hypothesis", {
          hypId: params.hypId,
          error: e,
        });
        setGeneratedHypothesis(null);
      } finally {
        setLoadingHypothesis(false);
      }
    };
    load();
  }, [apiCall, params.hypId]);

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
    organization.id || "",
  );
  // Ignore the demo datasource
  const hasExperiments = project
    ? experiments.some(
        (e) => e.project !== demoProjectId && e.project === project,
      )
    : experiments.some((e) => e.project !== demoProjectId);

  // Ignore the demo datasource
  const hasDatasource = datasources.some(
    (d) => !d.projects?.includes(demoProjectId),
  );

  const hasStartedExperiment = project
    ? experiments.some(
        (e) =>
          e.project !== demoProjectId &&
          e.status !== "draft" &&
          e.project === project,
      )
    : experiments.some(
        (e) => e.project !== demoProjectId && e.status !== "draft",
      );

  // if coming from hypothesis generator, show slightly different UI
  const title = generatedHypothesis
    ? "Run an Auto-generated Website Experiment"
    : "Run an Experiment";
  const generatedExp = experiments.find(
    (e) => e.id === generatedHypothesis?.experiment,
  );
  const hasStartedGeneratedExp =
    generatedHypothesis && generatedExp
      ? generatedExp.status !== "draft"
      : false;

  return (
    <div className="container pagecontents p-4">
      <PageHead
        breadcrumb={[
          { display: "Get Started", href: "/getstarted" },
          { display: title },
        ]}
      />
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="get-started-experiment-guide"
          commercialFeature={null}
        />
      )}
      <h1 className="mb-3">{title}</h1>
      <div className="d-flex align-middle justify-content-between mb-4">
        <span className="mr-3">
          Ran experiments on another platform?{" "}
          <Link href="/getstarted/imported-experiment-guide">
            View import instructions
          </Link>{" "}
          <PiArrowRight />
        </span>
        <ViewSampleDataButton />
      </div>
      <div className="row">
        <div className="col mr-auto" style={{ minWidth: 500 }}>
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
                      source: "experimentGuide",
                      sourceParams: params.hypId ? `hypId=${params.hypId}` : "",
                      stepKey: "sdk",
                    })
                  }
                >
                  Integrate the GrowthBook SDK into your app
                </Link>
                <Box mt="2">Allow GrowthBook to communicate with your app.</Box>
                <Separator size="4" my="4" />
              </div>
            </div>

            {generatedHypothesis && generatedHypothesis.experiment ? (
              <div className="row">
                <div className="col-sm-auto">
                  {hasStartedGeneratedExp ? (
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
                    href={`/experiment/${generatedHypothesis.experiment}`}
                    style={{
                      fontSize: "17px",
                      fontWeight: 600,
                      textDecoration: hasStartedGeneratedExp
                        ? "line-through"
                        : "none",
                    }}
                    onClick={() =>
                      setStep({
                        step: "Editing Your Auto-generated Experiment",
                        source: "experimentGuide",
                        sourceParams: params.hypId
                          ? `hypId=${params.hypId}`
                          : "",
                        stepKey: "createExperiment",
                      })
                    }
                  >
                    Configure Your Auto-generated Experiment
                  </Link>
                  <p className="mt-2">
                    Define any additional settings, rules and targeting as
                    desired. Then, click “Run experiment.”
                  </p>
                </div>
              </div>
            ) : (
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
                        source: "experimentGuide",
                        stepKey: "createExperiment",
                      })
                    }
                  >
                    {project
                      ? "Design the First Experiment for this Project"
                      : "Design Your Organization’s First Experiment"}
                  </Link>
                  <Box mt="2">
                    Create an experiment and change variations. Choose from
                    Feature Flags, URL Redirects, or the Visual Editor (Pro).
                  </Box>
                  <Separator size="4" my="4" />
                </div>
              </div>
            )}

            {!generatedHypothesis && (
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
                        source: "experimentGuide",
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
                  <Box mt="2">
                    Define any additional settings, rules and targeting as
                    desired. Then, click “Run experiment.”
                  </Box>
                  <Separator size="4" my="4" />
                </div>
              </div>
            )}

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
                      source: "experimentGuide",
                      sourceParams: params.hypId ? `hypId=${params.hypId}` : "",
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
              </div>
            </div>
          </div>
        </div>
        {loadingHypothesis && <LoadingOverlay />}
        <div className="col-auto">
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
