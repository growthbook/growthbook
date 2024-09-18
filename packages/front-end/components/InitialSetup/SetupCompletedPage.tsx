import clsx from "clsx";
import Link from "next/link";
import { useEffect } from "react";
import { PiCheckCircleFill } from "react-icons/pi";
import styles from "@/components/GetStarted/GetStarted.module.scss";
import { useCelebration } from "@/hooks/useCelebration";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useDefinitions } from "@/services/DefinitionsContext";

const SetupCompletedPage = (): React.ReactElement => {
  const startCelebration = useCelebration();
  const { data: sdkConnectionData } = useSDKConnections();
  const { datasources } = useDefinitions();

  const setupComplete =
    sdkConnectionData?.connections[0].connected && datasources.length > 0;

  useEffect(() => {
    startCelebration();
  });

  return (
    <div className="container pagecontents" style={{ maxWidth: "900px" }}>
      <h1 className="my-4">
        {!setupComplete ? "You’re almost done…" : "Setup Complete!"}
      </h1>
      {!setupComplete ? (
        <>
          <h3 className="mb-3">Steps left to complete to run Experiments</h3>
          <ul className="list-unstyled mt-2">
            {!sdkConnectionData?.connections[0].connected ? (
              <li className="mb-2">
                <PiCheckCircleFill
                  style={{
                    height: "15px",
                    width: "15px",
                    fill: "var(--gray-9)",
                  }}
                />{" "}
                <Link href={"/sdks"}>Connect an SDK</Link>
              </li>
            ) : null}
            {datasources.length === 0 ? (
              <li>
                <PiCheckCircleFill
                  style={{
                    height: "15px",
                    width: "15px",
                    fill: "var(--gray-9)",
                  }}
                />{" "}
                <Link href={"/datasources"}>Connect a Data Source</Link>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
      <div className="d-flex align-items-center mt-5 mb-2">
        <h3>
          {!setupComplete
            ? "In the meantime, feel free to explore GrowthBook"
            : "What do you want to do next?"}
        </h3>
        <div className="ml-auto">
          <Link href={"/getstarted"}>
            <button className="btn btn-link">Exit Setup {">"}</button>
          </Link>
        </div>
      </div>

      <div className="d-flex flex-wrap">
        <Link href={"/getstarted/feature-flag-guide"} className="mb-3 d-block">
          <button className={clsx(styles.animatedCard, "px-0 py-4 text-left")}>
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
        <Link href={"/getstarted/experiment-guide"} className="mb-3 d-block">
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
    </div>
  );
};

export default SetupCompletedPage;
