import { useState } from "react";
import Link from "next/link";
import {
  PiArrowCircleRight,
  PiArrowFatLineRight,
  PiChartScatter,
  PiFolders,
  PiGoogleChromeLogo,
  PiPlugs,
  PiTable,
  PiUsersThree,
  PiWebhooksLogo,
} from "react-icons/pi";
import clsx from "clsx";
import { useAuth } from "@/services/auth";
import DocumentationDisplay from "@/components/GetStarted/DocumentationDisplay";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import styles from "@/components/GetStarted/GetStarted.module.scss";
import YouTubeLightBox from "@/components/GetStarted/YoutubeLightbox";

const NewGetStartedPage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { apiCall } = useAuth();

  return (
    <div className="container pagecontents pl-4 py-5">
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="get-started"
        />
      )}
      {showVideoId && (
        <YouTubeLightBox
          close={() => setShowVideoId("")}
          videoId={showVideoId}
        />
      )}
      <h1 className="mb-3">Get Started</h1>
      <div className="container-fluid mx-0 mb-3">
        <div className="row justify-content-between">
          <div className="col pl-0">
            <button
              className={clsx(styles.animatedCard, "px-0 py-4 mr-3 text-left")}
            >
              <div className="px-3 mb-5">
                <div className="d-flex text-left align-middle">
                  <h2>Create Feature Flags from Scratch</h2>
                  <PiArrowCircleRight
                    className="ml-auto"
                    style={{
                      width: "30px",
                      height: "30px",
                      color: "#05054926",
                    }}
                  />
                </div>

                <strong>Explore a guided setup & sample feature flag</strong>
              </div>
              <img
                className="float-right"
                src="/images/get-started/feature-flag-active.svg"
                width={"384px"}
                height={"80px"}
              />{" "}
              <img
                className={clsx(styles.imgTop, "float-right")}
                src="/images/get-started/feature-flag-inactive.svg"
                width={"384px"}
                height={"80px"}
              />
            </button>
            <button
              className={clsx(styles.animatedCard, "px-0 py-4 text-left")}
            >
              <div className="px-3 mb-5">
                <div className="d-flex text-left align-middle">
                  <h2>Run an Experiment</h2>
                  <PiArrowCircleRight
                    className="ml-auto"
                    style={{
                      width: "30px",
                      height: "30px",
                      color: "#05054926",
                    }}
                  />
                </div>
                <strong>Explore a guided setup & sample results</strong>
              </div>

              <img
                className="float-right"
                src="/images/get-started/traffic-split-inactive.svg"
                width={"384px"}
                height={"80px"}
              />
            </button>

            <div className="d-flex flex-row mt-4 mb-4">
              <button
                className="p-3 mr-3 text-left align-middle"
                style={{
                  width: "415px",
                  height: "83px",
                  backgroundColor: "#FFFFFF",
                  borderColor: "#F5F2FF",
                  borderStyle: "solid",
                  borderRadius: "6px",
                }}
              >
                <PiArrowFatLineRight
                  className="mr-4"
                  style={{
                    width: "35px",
                    height: "35px",
                    color: "#050549A6",
                  }}
                />
                <span style={{ fontSize: "17px", fontWeight: 600 }}>
                  Migrate Feature Flags
                </span>

                <PiArrowCircleRight
                  className="float-right"
                  style={{
                    width: "30px",
                    height: "30px",
                    color: "#05054926",
                  }}
                />
              </button>
              <button
                className="p-3 text-left align-middle"
                style={{
                  width: "415px",
                  height: "83px",
                  backgroundColor: "#FFFFFF",
                  borderColor: "#F5F2FF",
                  borderStyle: "solid",
                  borderRadius: "6px",
                }}
              >
                <h3>
                  <PiChartScatter
                    className="mr-4"
                    style={{
                      width: "35px",
                      height: "35px",
                      color: "#050549A6",
                    }}
                  />
                  <span style={{ fontSize: "17px", fontWeight: 600 }}>
                    Analyze Imported Experiments
                  </span>
                  <PiArrowCircleRight
                    className="float-right"
                    style={{
                      width: "30px",
                      height: "30px",
                      color: "#05054926",
                    }}
                  />
                </h3>
              </button>
            </div>

            <hr />

            <div className="mt-4 mb-4">
              <h6 className="text-muted mb-3">PRODUCT OVERVIEW</h6>
              <div className="container-fluid">
                <div className="row">
                  <button
                    className="border-0 rounded mr-3"
                    style={{
                      width: "268px",
                      height: "151px",
                      background:
                        'url("/images/get-started/thumbnails/intro-to-growthbook.png")',
                    }}
                    onClick={() => setShowVideoId("b4xUnDGRKRQ")}
                  />
                  <button
                    className="border-0 rounded mr-3"
                    style={{
                      width: "268px",
                      height: "151px",
                      background:
                        'url("/images/get-started/thumbnails/intro-to-feature-flags.png")',
                    }}
                    onClick={() => setShowVideoId("b4xUnDGRKRQ")}
                  />
                  <button
                    className="border-0 rounded"
                    style={{
                      width: "268px",
                      height: "151px",
                      background:
                        'url("/images/get-started/thumbnails/new-release.png")',
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="mr-2">
              <h6 className="text-muted mb-3">SET UP YOUR WORKSPACE</h6>
              <div
                className="d-flex px-4 py-4 mr-6 w-100"
                style={{
                  background: "#FFFFFF",
                  borderRadius: "5px",
                }}
              >
                <div className="col mt-2">
                  <div className="mr-3 w-100">
                    <PiUsersThree
                      style={{
                        width: "20px",
                        height: "20px",
                        color: "#050549A6",
                      }}
                    />{" "}
                    <Link
                      href="/settings/team"
                      className={clsx(
                        styles.workspaceSetupLink,
                        "align-middle"
                      )}
                    >
                      <span style={{ fontSize: "15px" }}>
                        Teams & Permissions
                      </span>
                    </Link>
                    <hr />
                  </div>
                  <div className="mr-3 w-100">
                    <PiFolders
                      style={{
                        width: "20px",
                        height: "20px",
                        color: "#050549A6",
                      }}
                    />{" "}
                    <Link
                      href="/projects"
                      className={clsx(
                        styles.workspaceSetupLink,
                        "align-middle"
                      )}
                    >
                      <span style={{ fontSize: "15px" }}>Create Projects</span>
                    </Link>
                    <hr />
                  </div>
                  <div>
                    <PiTable
                      style={{
                        width: "20px",
                        height: "20px",
                        color: "#050549A6",
                      }}
                    />{" "}
                    <Link
                      href="/metrics"
                      className={clsx(
                        styles.workspaceSetupLink,
                        "align-middle"
                      )}
                    >
                      <span style={{ fontSize: "15px" }}>
                        Configure Metric Library
                      </span>
                    </Link>
                    <hr />
                  </div>
                </div>
                <div className="col mt-2">
                  <div>
                    <PiGoogleChromeLogo
                      style={{
                        width: "20px",
                        height: "20px",
                        color: "#050549A6",
                      }}
                    />{" "}
                    <a
                      href="https://chromewebstore.google.com/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia"
                      className={clsx(
                        styles.workspaceSetupLink,
                        "align-middle"
                      )}
                    >
                      <span style={{ fontSize: "15px" }}>
                        Install Chrome DevTools Extension
                      </span>
                    </a>
                    <hr />
                  </div>
                  <div>
                    <PiWebhooksLogo
                      style={{
                        width: "20px",
                        height: "20px",
                        color: "#050549A6",
                      }}
                    />{" "}
                    <Link
                      href="/settings/webhooks"
                      className={clsx(
                        styles.workspaceSetupLink,
                        "align-middle"
                      )}
                    >
                      <span style={{ fontSize: "15px" }}>Add Webhooks</span>
                    </Link>
                    <hr />
                  </div>
                  <div>
                    <PiPlugs
                      style={{
                        width: "20px",
                        height: "20px",
                        color: "#050549A6",
                      }}
                    />{" "}
                    <Link
                      href="/integrations/slack"
                      className={clsx(
                        styles.workspaceSetupLink,
                        "align-middle"
                      )}
                    >
                      <span style={{ fontSize: "15px" }}>
                        Integrate Slack or Discord
                      </span>
                    </Link>
                    <hr />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col"></div>
          <div className="col-2 pl-0">
            <DocumentationDisplay setUpgradeModal={setUpgradeModal} />
          </div>
        </div>
      </div>
      <span>
        Finished setting up?{" "}
        <a href="#">Turn off the guide to hide this page</a>
      </span>
    </div>
  );
};

export default NewGetStartedPage;
