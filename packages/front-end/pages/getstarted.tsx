import React, { useState } from "react";
import ReactPlayer from "react-player";
import clsx from "clsx";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import { FiArrowRight } from "react-icons/fi";
import { useExperiments } from "@/hooks/useExperiments";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { GBExperiment } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useFeaturesList } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import GuidedGetStarted from "@/components/GuidedGetStarted/GuidedGetStarted";
import styles from "@/components/GuidedGetStarted/GuidedGetStarted.module.scss";

const GetStartedPage = (): React.ReactElement => {
  const { ready, error: definitionsError } = useDefinitions();

  const [newUi] = useState(true);

  const {
    experiments,
    error: experimentsError,
    mutateExperiments,
    loading: experimentsLoading,
  } = useExperiments();

  const { features, error: featuresError } = useFeaturesList();

  const { apiCall } = useAuth();

  const [showVideo, setShowVideo] = useState(false);
  const { refreshOrganization } = useUser();

  if (featuresError || experimentsError || definitionsError) {
    return (
      <div className="alert alert-danger">
        An error occurred:{" "}
        {featuresError?.message ||
          experimentsError?.message ||
          definitionsError}
      </div>
    );
  }

  if (experimentsLoading || !features || !ready) {
    return <LoadingOverlay />;
  }

  if (newUi) {
    return (
      <div className="container pagecontents text-center py-5">
        <h1
          style={{ fontSize: "3.5em", fontWeight: "normal" }}
          className="mb-3"
        >
          Welcome to{" "}
          <span className="text-purple font-weight-bold">GrowthBook</span>!
        </h1>
        <div className="row justify-content-center mb-4">
          <div className={clsx(styles.playerWrapper, "col-lg-6", "col-md-8")}>
            {showVideo ? (
              <ReactPlayer
                className={clsx("mb-4")}
                url="https://www.youtube.com/watch?v=b4xUnDGRKRQ"
                playing={true}
                controls={true}
                width="100%"
              />
            ) : (
              <img
                role="button"
                className={styles.videoPreview}
                src="/images/intro-video-cover.png"
                width={"100%"}
                onClick={async () => {
                  setShowVideo(true);
                  await apiCall(`/organization`, {
                    method: "PUT",
                    body: JSON.stringify({
                      settings: {
                        videoInstructionsViewed: true,
                      },
                    }),
                  });
                  await refreshOrganization();
                }}
              />
            )}
          </div>
        </div>
        <hr />
        <div className="mt-4">
          <h2 style={{ fontSize: "2em" }} className="mb-3">
            What do you want to start with?
          </h2>
          <div className="text-center">
            <Tooltip
              body={
                <>
                  Wrap your code in <strong>Feature Flag</strong> checks to
                  control exactly how and when it&apos;s released to your users.
                </>
              }
              popperClassName="mt-3"
            >
              <Link
                href="/features?getstarted"
                className="btn btn-primary btn-lg mx-3"
              >
                <BsFlag />
                Feature Flags
                <FiArrowRight />
              </Link>
            </Tooltip>
            <Tooltip
              body={
                <>
                  Run controlled <strong>Experiments</strong> to determine the
                  impact of changes to your product. Code and No Code
                  implementation options are available.
                </>
              }
              popperClassName="mt-3"
            >
              <Link
                href="/experiments?getstarted"
                className="btn btn-primary btn-lg mx-3"
              >
                <GBExperiment />
                Experimentation
                <FiArrowRight />
              </Link>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container pagecontents position-relative">
      <GuidedGetStarted
        experiments={experiments}
        features={features}
        mutate={mutateExperiments}
      />
    </div>
  );
};

export default GetStartedPage;
