import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState, useEffect } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { Box, Separator } from "@radix-ui/themes";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useFeaturesList } from "@/services/features";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useGetStarted } from "@/services/GetStartedProvider";
import LoadingOverlay from "@/components/LoadingOverlay";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";

const CreateFeatureFlagsGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const { data: sdkConnections } = useSDKConnections();
  const { features, loading: featuresLoading, error } = useFeaturesList();
  const { project, ready: definitionsReady } = useDefinitions();
  const { setStep, clearStep } = useGetStarted();

  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

  const loading = featuresLoading && !sdkConnections && !definitionsReady;

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

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
  const hasFeatures = project
    ? features.some((f) => f.project !== demoProjectId && f.project === project)
    : features.some((f) => f.project !== demoProjectId);

  return (
    <div className="container pagecontents p-4">
      <PageHead
        breadcrumb={[
          { display: "Get Started", href: "/getstarted" },
          { display: "Create Feature Flags" },
        ]}
      />
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="get-started"
          commercialFeature={null}
        />
      )}
      <h1 className="mb-3">Create Feature Flags</h1>
      <div className="d-flex align-middle justify-content-between mb-4">
        <span className="mr-3">
          Have feature flags in LaunchDarkly?{" "}
          <Link href="/importing/launchdarkly">
            View migration instructions
          </Link>{" "}
          <PiArrowRight />
        </span>
        <ViewSampleDataButton resource="feature" />
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
                      source: "featureFlagGuide",
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

            <div className="row">
              <div className="col-sm-auto">
                {hasFeatures ? (
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
                  href="/features"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasFeatures ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: `Create a Test Feature Flag${
                        project && " in this Project"
                      }`,
                      source: "featureFlagGuide",
                      stepKey: "createFeatureFlag",
                    })
                  }
                >
                  Create a Test Feature Flag{project && " in this Project"}
                </Link>
                <Box mt="2">
                  Add your first feature flag to test your setup.
                </Box>
              </div>
            </div>
          </div>
        </div>
        <div className="col-auto">
          <DocumentationSidebar
            setUpgradeModal={setUpgradeModal}
            type="features"
          />
        </div>
      </div>
    </div>
  );
};

export default CreateFeatureFlagsGuide;
