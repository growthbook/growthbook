import React, { useState } from "react";
import ReactPlayer from "react-player";
import clsx from "clsx";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import { useExperiments } from "@/hooks/useExperiments";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { GBExperiment } from "@/components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import { useFeaturesList } from "../services/features";
import { useDefinitions } from "../services/DefinitionsContext";
import GuidedGetStarted from "../components/GuidedGetStarted/GuidedGetStarted";
import styles from "../components/GuidedGetStarted/GuidedGetStarted.module.scss";

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
                url="https://www.youtube.com/watch?v=1ASe3K46BEw"
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
          <h2 style={{ fontSize: "2em" }}>Get Started</h2>
          <p>
            GrowthBook is a modular feature flagging and experimentation
            platform. Which one do you want to start with?
          </p>
          <div className="d-flex justify-content-center">
            <Link href="/features">
              <a
                className="d-block appbox p-3 text-dark h2 mx-3"
                style={{ width: 300 }}
              >
                <BsFlag className="text-purple" /> Feature Flags
              </a>
            </Link>
            <Link href="/experiments">
              <a
                className="d-block appbox p-3 text-dark h2 mx-3"
                style={{ width: 300 }}
              >
                <GBExperiment className="text-purple" /> Experimentation
              </a>
            </Link>
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
