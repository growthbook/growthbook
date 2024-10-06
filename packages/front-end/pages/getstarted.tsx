import { useState, useEffect } from "react";
import Link from "next/link";
import {
  PiArrowFatLineRight,
  PiChartScatter,
  PiFolders,
  PiGoogleChromeLogo,
  PiTable,
  PiUsersThree,
  PiWebhooksLogo,
  PiKey,
  PiArrowSquareOut,
} from "react-icons/pi";
import { IconType } from "react-icons";
import clsx from "clsx";
import { useRouter } from "next/router";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import styles from "@/components/GetStarted/GetStarted.module.scss";
import YouTubeLightBox from "@/components/GetStarted/YoutubeLightbox";
import { useGetStarted } from "@/services/GetStartedProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import FeaturedCard from "@/components/GetStarted/FeaturedCard";
import LinkButton from "@/components/Radix/LinkButton";

function WorkspaceLink({
  Icon,
  url,
  text,
  external,
  disabled,
}: {
  Icon: IconType;
  url: string;
  text: string;
  disabled?: boolean;
  external?: boolean;
}) {
  return (
    <div className="col-6">
      <Icon
        className="ml-3 mr-1"
        style={{
          width: "20px",
          height: "20px",
          color: "var(--text-color-muted)",
        }}
      />{" "}
      {disabled ? (
        <Tooltip body="You do not have permission to complete this action">
          <span
            className={clsx(
              styles.workspaceSetupLink,
              styles.disabled,
              "align-middle"
            )}
          >
            <span style={{ fontSize: "15px" }}>{text}</span>
          </span>
        </Tooltip>
      ) : (
        <Link
          href={url}
          className={clsx(styles.workspaceSetupLink, "align-middle")}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          <span style={{ fontSize: "15px" }}>
            {text}{" "}
            {external && (
              <PiArrowSquareOut
                className="ml-1"
                style={{
                  height: "15px",
                  width: "15px",
                  verticalAlign: "middle",
                }}
              />
            )}
          </span>
        </Link>
      )}
      <hr />
    </div>
  );
}

const GetStartedPage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { clearStep } = useGetStarted();

  const router = useRouter();

  const permissionsUtils = usePermissionsUtil();

  const { project } = useDefinitions();

  const canImportLaunchDarkly =
    permissionsUtils.canViewFeatureModal() &&
    permissionsUtils.canCreateEnvironment({
      projects: [],
      id: "",
    }) &&
    permissionsUtils.canCreateProjects();

  const canUseSetupFlow =
    permissionsUtils.canCreateSDKConnection({
      projects: [project],
      environment: "production",
    }) &&
    permissionsUtils.canCreateEnvironment({
      projects: [project],
      id: "production",
    });

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

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
      <div className="container-fluid mx-0 mb-3">
        <div className="row">
          <div
            className="col pl-0 mr-auto col-md-12"
            style={{
              maxWidth: 862,
            }}
          >
            <h1 className="mb-3">Get Started</h1>
            <div className="d-flex flex-wrap">
              <Link
                href={"/getstarted/feature-flag-guide"}
                className="mb-3 d-block"
              >
                <button
                  className={clsx(styles.animatedCard, "px-0 py-4 text-left")}
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
              <Link
                href={"/getstarted/experiment-guide"}
                className="mb-3 d-block"
              >
                <button
                  className={clsx(styles.animatedCard, "px-0 py-4 text-left")}
                  style={{ marginRight: "0px" }}
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
            </div>

            <div className="d-flex flex-row flex-wrap mt-3 mb-3">
              <Tooltip
                body={
                  canImportLaunchDarkly
                    ? ""
                    : "You do not have permission to complete this action"
                }
              >
                <button
                  className={clsx(
                    styles.animatedButton,
                    `p-3 mr-4 mb-3 text-left align-middle`,
                    { [styles.disabled]: !canImportLaunchDarkly }
                  )}
                  disabled={!canImportLaunchDarkly}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push("/importing/launchdarkly");
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
              </Tooltip>
              <Link href="/getstarted/imported-experiment-guide">
                <button className={`${styles.animatedButton} p-3 text-left`}>
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
                  <FeaturedCard
                    imgUrl={
                      "/images/get-started/thumbnails/intro-to-growthbook.svg"
                    }
                    handleClick={() => setShowVideoId("b4xUnDGRKRQ")}
                    playTime={5}
                  />
                  <a
                    href="https://blog.growthbook.io/measuring-a-b-test-impacts-on-website-latency-using-quantile-metrics-in-growthbook/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FeaturedCard
                      imgUrl={
                        "/images/get-started/thumbnails/quantile-metrics-blog.png"
                      }
                    />
                  </a>
                  <a
                    href="https://blog.growthbook.io/growthbook-version-3-2/"
                    target="_blank"
                    rel="noreferrer"
                    key="3-2-release"
                  >
                    <FeaturedCard
                      imgUrl={"/images/get-started/thumbnails/3.2-release.svg"}
                      lastCard
                    />
                  </a>
                </div>
              </div>
            </div>
            <div className="mb-2">
              <h6 className="text-muted mb-3">SET UP YOUR WORKSPACE</h6>
              <div
                className="appbox d-flex px-4 pt-4 pb-3 mr-6 w-100"
                style={{
                  borderRadius: "5px",
                }}
              >
                <div className="row mt-2">
                  <WorkspaceLink
                    Icon={PiUsersThree}
                    url="/settings/team"
                    text="Teams & Permissions"
                    disabled={!permissionsUtils.canManageTeam()}
                  />
                  <WorkspaceLink
                    Icon={PiGoogleChromeLogo}
                    url="https://chromewebstore.google.com/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia"
                    text="Install Chrome DevTools Extension"
                    external
                  />
                  <WorkspaceLink
                    Icon={PiFolders}
                    url="/projects"
                    text="Create Projects"
                    disabled={!permissionsUtils.canCreateProjects()}
                  />
                  <WorkspaceLink
                    Icon={PiWebhooksLogo}
                    url="/settings/webhooks"
                    text="Integrate Slack or Discord"
                    disabled={!permissionsUtils.canCreateEventWebhook()}
                  />
                  <WorkspaceLink
                    Icon={PiTable}
                    url="/fact-tables"
                    text="Configure Metric Library"
                    disabled={
                      !permissionsUtils.canViewCreateFactTableModal(project) &&
                      !permissionsUtils.canCreateFactMetric({
                        projects: project ? [project] : [],
                      })
                    }
                  />
                  <WorkspaceLink
                    Icon={PiKey}
                    url="/settings/keys"
                    text="Create API Token"
                    disabled={!permissionsUtils.canCreateApiKey()}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="col-auto pl-0">
            {canUseSetupFlow && (
              <LinkButton href="/setup" mt="2" mb="4">
                Launch Setup Flow
              </LinkButton>
            )}
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
