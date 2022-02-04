import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import track from "../../services/track";
import CodeSnippetModal from "../Features/CodeSnippetModal";
import EditAttributesModal from "../Features/EditAttributesModal";
import FeatureModal from "../Features/FeatureModal";
import DocumentationLinksSidebar from "./DocumentationLinksSidebar";
import EnvironmentToggle from "../Features/EnvironmentToggle";
import ValueDisplay from "../Features/ValueDisplay";
import GetStartedStep from "./GetStartedStep";
import useUser from "../../hooks/useUser";
import { FaChrome } from "react-icons/fa";
import { useAuth } from "../../services/auth";
import clsx from "clsx";
import { FiArrowRight } from "react-icons/fi";

export interface Props {
  features: FeatureInterface[];
  mutateFeatures: () => void;
}

export default function FeaturesGetStarted({
  features,
  mutateFeatures,
}: Props) {
  const { settings, update } = useUser();

  let step = -1;
  if (!features.length) {
    step = 0;
  } else if (!settings?.sdkInstructionsViewed) {
    step = 1;
  } else if (!settings?.sdkIntegrationWorking) {
    step = 2;
  }

  const [modalOpen, setModalOpen] = useState(false);
  const [attributeModalOpen, setAttributeModalOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [language, setLanguage] = useState("");
  const { apiCall } = useAuth();

  return (
    <div>
      {modalOpen && (
        <FeatureModal
          close={() => setModalOpen(false)}
          onSuccess={async () => {
            await mutateFeatures();
          }}
          simple
        />
      )}
      {attributeModalOpen && (
        <EditAttributesModal close={() => setAttributeModalOpen(false)} />
      )}
      {codeModalOpen && (
        <CodeSnippetModal
          close={() => setCodeModalOpen(false)}
          feature={features[0]}
          setLanguage={(l) => setLanguage(l)}
        />
      )}
      <div className="row getstarted mb-3">
        <div className="col-12 col-lg-8 ">
          <div className={`card gsbox`} style={{ overflow: "hidden" }}>
            <GetStartedStep
              current={step === 0}
              finished={features.length > 0}
              className="border-top"
              image="/images/feature-icon.svg"
              title="1. Add your first feature"
              text="Features let you remotely control parts of your application. Turn things on/off in production, gradually roll out new functionality, run A/B tests, and so much more!"
              cta="Add first feature"
              finishedCTA="Add a feature"
              imageLeft={false}
              onClick={(finished) => {
                if (!settings.attributeSchema) {
                  apiCall(`/organization`, {
                    method: "PUT",
                    body: JSON.stringify({
                      settings: {
                        attributeSchema: [
                          {
                            property: "id",
                            datatype: "string",
                            hashAttribute: true,
                          },
                          { property: "admin", datatype: "boolean" },
                          { property: "country", datatype: "string" },
                          { property: "browser", datatype: "string" },
                          { property: "url", datatype: "string" },
                        ],
                      },
                    }),
                  }).then(() => {
                    update();
                  });
                }
                setModalOpen(true);
                if (!finished) {
                  track("Viewed Feature Modal", {
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
              title="2. Install the GrowthBook SDK"
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
              finished={!!settings?.sdkIntegrationWorking}
              className="border-top"
              title="3. Test your integration"
              text="Toggle your feature below, wait a few seconds, and see how it changes within your application!"
              action={
                <div>
                  {features?.[0] ? (
                    <div>
                      <table className="table gbtable mb-3">
                        <thead>
                          <tr>
                            <th>Feature</th>
                            <th>Dev</th>
                            <th>Prod</th>
                            <th>Value When Enabled</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{features[0].id}</td>
                            <td>
                              <EnvironmentToggle
                                feature={features[0]}
                                environment="dev"
                                mutate={mutateFeatures}
                                id="dev_gs_toggle"
                              />
                            </td>
                            <td>
                              <EnvironmentToggle
                                feature={features[0]}
                                environment="production"
                                mutate={mutateFeatures}
                                id="production_gs_toggle"
                              />
                            </td>
                            <td>
                              <ValueDisplay
                                type={features[0].valueType}
                                value={features[0]?.defaultValue}
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="row">
                        <div className="col-auto">
                          <a
                            className={clsx(`action-link mr-3`, {
                              "btn btn-outline-primary": step < 0,
                              "btn btn-primary": step === 2,
                              "non-active-step": step < 2 && step >= 0,
                            })}
                            href="#"
                            onClick={async (e) => {
                              e.preventDefault();
                              if (settings?.sdkIntegrationWorking) return;
                              await apiCall(`/organization`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  settings: {
                                    sdkIntegrationWorking:
                                      language || "unknown",
                                  },
                                }),
                              });
                              track("Verified SDK", {
                                sdk: language,
                              });
                              await update();
                            }}
                          >
                            It Works! <FiArrowRight />
                          </a>
                        </div>
                        <div className="col-auto">
                          <a
                            className={clsx(`mr-3 btn btn-link text-danger`)}
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                            }}
                          >
                            Something&apos;s broken, I need help.
                          </a>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <em>No features to test yet...</em>
                  )}
                </div>
              }
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
