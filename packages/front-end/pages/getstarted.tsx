import { useState } from "react";
import Link from "next/link";
import {
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
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import styles from "@/components/GetStarted/GetStarted.module.scss";
import YouTubeLightBox from "@/components/GetStarted/YoutubeLightbox";

const GetStartedPage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

  return (
    <div className={clsx(styles.getStartedPage, "container pagecontents p-4")}>
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
                <div className="pr-3 mb-5" style={{ paddingLeft: "29px" }}>
                  <div className="d-flex text-left align-middle">
                    <h2>Create Feature Flags from Scratch</h2>
                    <img
                      className={clsx(styles.imgInactive, "ml-auto")}
                      width="30px"
                      height="30px"
                      src="/images/get-started/icons/inactive-card-arrow.svg"
                    />
                    <img
                      className={clsx(styles.imgActive, "ml-auto")}
                      width="30px"
                      height="30px"
                      src="/images/get-started/icons/active-card-arrow.svg"
                    />
                  </div>

                  <p>Explore a guided setup & sample feature flag</p>
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
                <div className="pr-3 mb-5" style={{ paddingLeft: "29px" }}>
                  <div className="d-flex text-left align-middle">
                    <h2>Run an Experiment</h2>
                    <img
                      className={clsx(styles.imgInactive, "ml-auto")}
                      width="30px"
                      height="30px"
                      src="/images/get-started/icons/inactive-card-arrow.svg"
                    />
                    <img
                      className={clsx(styles.imgActive, "ml-auto")}
                      width="30px"
                      height="30px"
                      src="/images/get-started/icons/active-card-arrow.svg"
                    />
                  </div>
                  <p>Explore a guided setup & sample results</p>
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
                  className={`${styles.animatedButton} p-3 mr-3 text-left align-middle`}
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
                  <PiArrowFatLineRight className={`${styles.arrowIcon} mr-4`} />
                  <span
                    className="align-middle"
                    style={{ fontSize: "17px", fontWeight: 600 }}
                  >
                    Migrate from LaunchDarkly
                  </span>

                  <img
                    className={clsx(styles.imgInactive, "float-right")}
                    width="30px"
                    height="30px"
                    src="/images/get-started/icons/inactive-button-arrow.svg"
                  />
                  <img
                    className={clsx(styles.imgActive, "float-right")}
                    width="30px"
                    height="30px"
                    src="/images/get-started/icons/active-button-arrow.svg"
                  />
                </button>
              </Link>
              <Link href="/getstarted/imported-experiment-guide">
                <button
                  className={`${styles.animatedButton} p-3 mr-3 text-left`}
                >
                  <svg width="0" height="0">
                    <linearGradient
                      id="chart-gradient"
                      x1="100%"
                      y1="100%"
                      x2="0%"
                      y2="0%"
                    >
                      <stop stopColor="#3E63DD" offset="0%" />
                      <stop stopColor="#27B08B" offset="100%" />
                    </linearGradient>
                  </svg>
                  <PiChartScatter className={`${styles.chartIcon} mr-4`} />
                  <span
                    className="align-middle"
                    style={{ fontSize: "17px", fontWeight: 600 }}
                  >
                    Analyze Imported Experiments
                  </span>
                  <img
                    className={clsx(
                      styles.imgInactive,
                      "float-right align-middle"
                    )}
                    width="30px"
                    height="30px"
                    src="/images/get-started/icons/inactive-button-arrow.svg"
                  />
                  <img
                    className={clsx(styles.imgActive, "float-right")}
                    width="30px"
                    height="30px"
                    src="/images/get-started/icons/active-button-arrow.svg"
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
                className="appbox d-flex px-4 py-4 mr-6 w-100"
                style={{
                  borderRadius: "5px",
                }}
              >
                <div className="col mt-2">
                  <div className="mr-3 w-100">
                    <PiUsersThree
                      style={{
                        width: "20px",
                        height: "20px",
                        color: "var(--text-color-muted)",
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
                        color: "var(--text-color-muted)",
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
                        color: "var(--text-color-muted)",
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
                        color: "var(--text-color-muted)",
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
                        color: "var(--text-color-muted)",
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
                        color: "var(--text-color-muted)",
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
          <div className="col pl-0">
            <DocumentationSidebar
              setUpgradeModal={setUpgradeModal}
              type="get-started"
            />
          </div>
        </div>
      </div>
      {/* <span>
        Finished setting up?{" "}
        <a href="#">Turn off the guide to hide this page</a>
      </span> */}
    </div>
  );
};

export default GetStartedPage;
