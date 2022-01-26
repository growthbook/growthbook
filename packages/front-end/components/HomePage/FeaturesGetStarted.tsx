import { useRouter } from "next/router";
import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import track from "../../services/track";
import CodeSnippetModal from "../Features/CodeSnippetModal";
import EditAttributesModal from "../Features/EditAttributesModal";
import FeatureModal from "../Features/FeatureModal";
import DocumentationLinksSidebar from "./DocumentationLinksSidebar";
import GetStartedStep from "./GetStartedStep";
import useOrgSettings from "../../hooks/useOrgSettings";
import { FaChrome } from "react-icons/fa";

export interface Props {
  features: FeatureInterface[];
  mutate: (data?: { features: FeatureInterface[] }) => void;
}

export default function FeaturesGetStarted({ features, mutate }: Props) {
  const settings = useOrgSettings();
  const router = useRouter();

  let step = -1;
  if (!settings?.attributeSchema?.length) {
    step = 0;
  } else if (!settings?.sdkInstructionsViewed) {
    step = 1;
  } else if (!features.length) {
    step = 2;
  }

  const [modalOpen, setModalOpen] = useState(false);
  const [attributeModalOpen, setAttributeModalOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);

  return (
    <div>
      {modalOpen && (
        <FeatureModal
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            router.push(`/features/${feature.id}`);
            mutate({
              features: [...features, feature],
            });
          }}
        />
      )}
      {attributeModalOpen && (
        <EditAttributesModal close={() => setAttributeModalOpen(false)} />
      )}
      {codeModalOpen && (
        <CodeSnippetModal close={() => setCodeModalOpen(false)} />
      )}
      <div className="row getstarted mb-3">
        <div className="col-12 col-lg-8 ">
          <div className={`card gsbox`} style={{ overflow: "hidden" }}>
            <GetStartedStep
              current={step === 0}
              finished={settings?.attributeSchema?.length > 0}
              image="/images/attributes-icon.svg"
              title="1. Choose targeting attributes"
              text="Pick which user properties you want to pass into our SDKs. This enables you to use complex targeting rules and run experiments with your features."
              cta="Choose attributes"
              finishedCTA="Edit attributes"
              imageLeft={true}
              onClick={(finished) => {
                setAttributeModalOpen(true);
                if (!finished) {
                  track("Viewed Attributes Modal", {
                    source: "feature-onboarding",
                  });
                }
              }}
            />
            <GetStartedStep
              current={step === 1}
              finished={settings?.sdkInstructionsViewed}
              className="border-top"
              image="/images/coding-icon.svg"
              title="2. Install our SDK"
              text="Integrate GrowthBook into your Javascript, React, Golang, or Android application. More languages and frameworks coming soon!"
              cta="View instructions"
              finishedCTA="View instructions"
              imageLeft={false}
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
              finished={features.length > 0}
              className="border-top"
              image="/images/feature-icon.svg"
              title="3. Add your first feature"
              text="Create a feature within GrowthBook. It could be a simple ON/OFF flag or a configurable property like a color or copy for a headline."
              cta="Add first feature"
              finishedCTA="Add a feature"
              imageLeft={true}
              onClick={(finished) => {
                setModalOpen(true);
                if (!finished) {
                  track("Viewed Feature Modal", {
                    source: "feature-onboarding",
                  });
                }
              }}
            />
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
