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
import { useAuth } from "@/services/auth";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import Button from "@/components/Button";
import { useGetStarted } from "@/services/GetStartedProvider";

const CreateFeatureFlagsGuide = (): React.ReactElement => {
  const { organization, name } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { data: sdkConnections } = useSDKConnections();
  const { features, loading, error, mutate } = useFeaturesList();
  const { mutateDefinitions, project } = useDefinitions();
  const router = useRouter();
  const { apiCall } = useAuth();
  const { setStep } = useGetStarted();

  const manualChecks = organization.getStartedChecklists?.features;
  const environmentsReviewed = manualChecks?.find(
    (c) => c.step === "environments"
  );
  const attributesSet = manualChecks?.find((c) => c.step === "attributes");
  const isSDKIntegrated =
    sdkConnections?.connections.some((c) => c.connected) || false;
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || ""
  );

  // Ignore the demo datasource
  const hasFeatures = project
    ? features.some((f) => f.project !== demoProjectId && f.project === project)
    : features.some((f) => f.project !== demoProjectId);

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
          { display: "Create Feature Flags" },
        ]}
      />
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="get-started"
        />
      )}
      <h1 className="mb-3">Create Feature Flags</h1>
      <div className="d-flex align-middle justify-content-between mb-4">
        <span>
          Have feature flags in LaunchDarkly?{" "}
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
                      source: "features",
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
                      source: "features",
                      stepKey: "attributes",
                    })
                  }
                >
                  Customize Targeting Attributes
                </Link>
                <p className="mt-2">
                  Define user attributes used to target specific feature values
                  to subsets of users.
                </p>
                <hr />
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
                >
                  Create a Test Feature Flag{project && " in this Project"}
                </Link>
                <p className="mt-2">
                  Add first feature flag to test that everything is connected
                  properly
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="">
          <DocumentationDisplay
            setUpgradeModal={setUpgradeModal}
            type="features"
          />
        </div>
      </div>
    </div>
  );
};

export default CreateFeatureFlagsGuide;
