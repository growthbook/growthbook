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

const GetStartedPage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
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
      {showVideoId && (
        <YouTubeLightBox
          close={() => setShowVideoId("")}
          videoId={showVideoId}
        />
      )}
      <h1 className="mb-3">Get Started</h1>
      <div className="container-fluid mx-0 mb-4">
        <div className="row">
          <div className="col pl-0">
            <Link href={"/getstarted/feature-flag-guide"}>
              <button
                className={clsx(
                  styles.animatedCard,
                  "px-0 py-4 mr-3 text-left"
                )}
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
                  className={clsx(styles.imgActive, "float-right")}
                  src="/images/get-started/feature-flag-active.svg"
                  width={"384px"}
                  height={"80px"}
                />
                <img
                  className={clsx(styles.imgInactive, "float-right")}
                  src="/images/get-started/feature-flag-inactive.svg"
                  width={"384px"}
                  height={"80px"}
                />
              </button>
            </Link>
            <Link href={"/getstarted/experiment-guide"}>
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
                  className={clsx(styles.imgActive, "float-right")}
                  src="/images/get-started/traffic-split-active.svg"
                  width={"384px"}
                  height={"80px"}
                />
                <img
                  className={clsx(styles.imgInactive, "float-right")}
                  src="/images/get-started/traffic-split-inactive.svg"
                  width={"384px"}
                  height={"80px"}
                />
              </button>
            </Link>

            <div className="d-flex flex-row mt-4 mb-4">
              <Link href="/importing/launchdarkly">
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
                  <svg width="0" height="0">
                    <linearGradient
                      id="arrow-gradient"
                      x1="100%"
                      y1="100%"
                      x2="0%"
                      y2="0%"
                    >
                      <stop stopColor="#7B45EA" offset="0%" />
                      <stop stopColor="#FFC53D" offset="100%" />
                    </linearGradient>
                  </svg>
                  <PiArrowFatLineRight
                    className="mr-4"
                    style={{
                      width: "35px",
                      height: "35px",
                      color: "#050549A6",
                      fill: "url(#arrow-gradient)",
                    }}
                  />
                  <span style={{ fontSize: "17px", fontWeight: 600 }}>
                    Migrate from LaunchDarkly
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
              </Link>
              <Link href="/getstarted/imported-experiment-guide">
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
                  <svg width="0" height="0">
                    <linearGradient
                      id="blue-gradient"
                      x1="100%"
                      y1="100%"
                      x2="0%"
                      y2="0%"
                    >
                      <stop stopColor="#3E63DD" offset="0%" />
                      <stop stopColor="#27B08B" offset="100%" />
                    </linearGradient>
                  </svg>
                  <PiChartScatter
                    className="mr-4"
                    style={{
                      width: "35px",
                      height: "35px",
                      color: "#050549A6",
                      fill: "url(#blue-gradient)",
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
                </button>
              </Link>
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
                  <a href="https://medium.com/growth-book/growthbook-version-2-9-b795d758177f">
                    <button
                      className="border-0 rounded"
                      style={{
                        width: "268px",
                        height: "151px",
                        background:
                          'url("/images/get-started/thumbnails/new-release.png")',
                      }}
                    />
                  </a>
                </div>
              </div>
            </div>
            <div className="mr-2 mb-2">
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
          <div className="col">
            <DocumentationDisplay
              setUpgradeModal={setUpgradeModal}
              type="get-started"
            />
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

export default GetStartedPage;
