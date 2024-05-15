import { PiArrowRight, PiCheckCircle, PiCheckCircleFill } from "react-icons/pi";
import { useState } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import DocumentationDisplay from "@/components/GetStarted/DocumentationDisplay";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useFeaturesList } from "@/services/features";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";

const CreateFeatureFlagsGuide = (): React.ReactElement => {
  const { organization, name } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { data: sdkConnections } = useSDKConnections();
  const { features, loading, error, mutate } = useFeaturesList();
  const isSDKIntegrated =
    sdkConnections?.connections.some((c) => c.connected) || false;
  // Ignore the demo datasource
  const hasFeatures = features.some(
    (f) =>
      f.project !==
        getDemoDatasourceProjectIdForOrganization(organization.id || "") &&
      f.owner === name
  );

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
      <div className="d-flex align-middle">
        <span>
          Have feature flags in LaunchDarkly?{" "}
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
                  Customize Targeting Attributes
                </Link>
                <p className="mt-2">
                  Define user attributes to use for targeting a specific feature
                  value to a subset of your users.
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
                  style={{ fontSize: "17px", fontWeight: 600 }}
                >
                  Test Your First Feature Flag
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
