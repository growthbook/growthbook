import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import clsx from "clsx";
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
import styles from "@/components/GetStarted/GetStarted.module.scss";

const CreateFeatureFlagsGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const { data: sdkConnections } = useSDKConnections();
  const { features, loading: featuresLoading, error } = useFeaturesList();
  const { project, ready: definitionsReady } = useDefinitions();
  const { setStep } = useGetStarted();

  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

  const loading = featuresLoading && !sdkConnections && !definitionsReady;

  if (loading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

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

  return (
    <div className={clsx(styles.getStartedPage, "container pagecontents p-4")}>
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
                      source: "features",
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
                  onClick={() =>
                    setStep({
                      step: `Create a Test Feature Flag${
                        project && " in this Project"
                      }`,
                      source: "features",
                      stepKey: "createFeatureFlag",
                    })
                  }
                >
                  Create a Test Feature Flag{project && " in this Project"}
                </Link>
                <p className="mt-2">
                  Add your first feature flag to test your setup.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="">
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
