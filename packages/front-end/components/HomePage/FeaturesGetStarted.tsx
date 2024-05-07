import { useRouter } from "next/router";
import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { FaChrome } from "react-icons/fa";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import FeatureModal from "@/components/Features/FeatureModal";
import { DocLink } from "@/components/DocLink";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import GetStartedStep from "./GetStartedStep";
import DocumentationLinksSidebar from "./DocumentationLinksSidebar";

export interface Props {
  features: FeatureInterface[];
}

export default function FeaturesGetStarted({ features }: Props) {
  const settings = useOrgSettings();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();

  const { organization } = useUser();
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization?.id || "",
  );

  const { data } = useSDKConnections();
  const connections = data?.connections || [];
  const hasActiveConnection =
    connections.some((c) => c.connected) || !!settings?.sdkInstructionsViewed;

  const hasFeatures = features.some((f) => f.project !== demoProjectId);

  let step = -1;
  if (!hasActiveConnection) {
    step = 1;
  } else if (!hasFeatures) {
    step = 2;
  }

  const [modalOpen, setModalOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);

  const { project } = useDefinitions();

  return (
    <div>
      {modalOpen && (
        <FeatureModal
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${hasFeatures ? "" : "?first"}`;
            await router.push(url);
          }}
        />
      )}
      {codeModalOpen && (
        <InitialSDKConnectionForm
          close={() => setCodeModalOpen(false)}
          feature={features[0]}
          includeCheck={true}
          cta="Check Connection"
          goToNextStep={() => {
            setCodeModalOpen(false);
          }}
        />
      )}
      <div className="row getstarted mb-3">
        <div className="col-12 col-lg-8 ">
          <div className={`card gsbox`} style={{ overflow: "hidden" }}>
            <GetStartedStep
              current={step === 1}
              finished={hasActiveConnection}
              className="border-top"
              image="/images/coding-icon.svg"
              title="1. Install our SDK"
              text="Integrate GrowthBook into your Javascript, React, Golang, Ruby, PHP, Python, or Android application. More languages and frameworks coming soon!"
              cta="View instructions"
              finishedCTA="View instructions"
              imageLeft={false}
              permissionsError={!permissionsUtil.canViewFeatureModal(project)}
              onClick={(finished) => {
                setCodeModalOpen(true);
                if (!finished) {
                  track("Viewed Feature Integration Modal", {
                    source: "feature-onboarding",
                  });
                }
              }}
            />
            <GetStartedStep
              current={step === 2}
              finished={hasFeatures}
              className="border-top"
              image="/images/feature-icon.svg"
              title="2. Add your first feature"
              text="Create a feature within GrowthBook. Use features to toggle app behavior, do gradual rollouts, and run A/B tests."
              cta="Add first feature"
              finishedCTA="Add a feature"
              imageLeft={true}
              permissionsError={!permissionsUtil.canViewFeatureModal(project)}
              onClick={(finished) => {
                setModalOpen(true);
                if (!finished) {
                  track("Viewed Feature Modal", {
                    source: "feature-onboarding",
                  });
                }
              }}
            />
            <div className="card-body extra-padding border-top">
              <h3>Next Steps</h3>
              <ul className="mb-0">
                <li className="mb-2">
                  <a
                    href="https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      track("Install DevTools", {
                        type: "chrome",
                        source: "feature-onboarding",
                      });
                    }}
                  >
                    Install our Chrome Extension
                  </a>
                </li>
                <li className="mb-2">
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://slack.growthbook.io?ref=app-features"
                  >
                    Join us on Slack
                  </a>
                </li>
                <li>
                  <DocLink docSection="home">Read our Docs</DocLink>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="d-none d-lg-block col-lg-4">
          <DocumentationLinksSidebar />

          <div className="card gsbox mb-3">
            <div className="card-body">
              <div className="card-title">
                <h4 className="">Chrome DevTools Extension</h4>
              </div>
              <div className="card-text">
                <p>
                  Easily QA and debug features on your site, directly within
                  Chrome DevTools!
                </p>
                <a
                  href="https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline-primary"
                  onClick={() => {
                    track("Install DevTools", {
                      type: "chrome",
                      source: "feature-onboarding",
                    });
                  }}
                >
                  <FaChrome /> Install Extension
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
