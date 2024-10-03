import clsx from "clsx";
import Link from "next/link";
import { useEffect } from "react";
import styles from "@/components/GetStarted/GetStarted.module.scss";
import { useCelebration } from "@/hooks/useCelebration";

const SetupCompletedPage = (): React.ReactElement => {
  const startCelebration = useCelebration();

  useEffect(() => {
    startCelebration();
  });

  return (
    <div
      className="container pagecontents"
      style={{ maxWidth: "885px", height: "100%" }}
    >
      <h1 className="my-4">Setup Complete!</h1>
      <div className="d-flex align-items-center mt-5 mb-2">
        <h3>What do you want to do next?</h3>
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
      <Link className="float-right mt-auto" href={"/getstarted"}>
        <button className="btn btn-primary">Exit Setup</button>
      </Link>
    </div>
  );
};

export default SetupCompletedPage;
