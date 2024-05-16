import Link from "next/link";
import { PiArrowRight } from "react-icons/pi";
import { useState } from "react";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";

interface Props {
  title: string;
  helpText: string | React.ReactNode;
}

const GuidedStepsPage = (): React.ReactElement => {
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

  return (
    <div className="container pagecontents p-4">
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
              <div className="col-sm-auto mt-1">
                <div
                  style={{
                    borderRadius: "50%",
                    borderStyle: "solid",
                    borderWidth: "0.6px",
                    borderColor: "#D3D4DB",
                    width: "15px",
                    height: "15px",
                  }}
                />
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

            <Link
              href="/environments"
              style={{ fontSize: "17px", fontWeight: 600 }}
            >
              Review or Add Environments
            </Link>
            <p className="mt-2">
              By default, GrowthBook comes with one environment—production—but
              you can add as many as you need.
            </p>
            <hr />
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
        <div className="">
          <DocumentationSidebar setUpgradeModal={setUpgradeModal} />
        </div>
      </div>
    </div>
  );
};

export default GuidedStepsPage;
