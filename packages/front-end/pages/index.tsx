import React from "react";
import Head from "next/head";
import Dashboard from "../components/HomePage/Dashboard";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import GetStarted from "../components/HomePage/GetStarted";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../hooks/useApi";
import { useContext } from "react";
import { UserContext } from "../components/ProtectedPage";
import { FeatureInterface } from "back-end/types/feature";
import { useState } from "react";
import track from "../services/track";

export default function Home(): React.ReactElement {
  const {
    metrics,
    ready,
    datasources,
    error: definitionsError,
    project,
  } = useDefinitions();

  const [onboardingType, setOnboardingType] = useState<
    "features" | "experiments" | null
  >(null);

  const { settings } = useContext(UserContext);

  const {
    data: experiments,
    error: experimentsError,
    mutate: mutateExperiments,
  } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project}`);

  const {
    data: features,
    error: featuresError,
    mutate: mutateFeatures,
  } = useApi<{
    features: FeatureInterface[];
  }>(`/feature?project=${project}`);

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

  if (!experiments || !features || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments =
    experiments?.experiments?.filter((e) => !e.id.match(/^exp_sample/))
      ?.length > 0;

  const hasFeatures = features?.features?.length > 0;

  const startedExpOnboarding =
    datasources.length > 0 || metrics.length > 0 || hasExperiments;

  const startedFeatOnboarding =
    !!settings?.attributeSchema ||
    settings?.sdkInstructionsViewed ||
    hasFeatures;

  return (
    <>
      <Head>
        <title>GrowthBook</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="container pagecontents position-relative">
        {!onboardingType && !startedExpOnboarding && !startedFeatOnboarding && (
          <>
            <div
              className="bg-white"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 120,
                opacity: 0.75,
              }}
            ></div>
            <div
              style={{
                position: "absolute",
              }}
              className="bg-white p-4 shadow-lg onboarding-modal"
            >
              <div className="text-center p-3">
                <h1 className="mb-5">What do you want to do first?</h1>
                <div className="row">
                  <div className="col">
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        track("Choose Onboarding", {
                          type: "features",
                          source: "modal",
                        });
                        setOnboardingType("features");
                      }}
                      className="d-block border p-3 onboarding-choice"
                    >
                      <img src="/images/feature-icon.svg" className="mb-3" />
                      <div style={{ fontSize: "1.3em" }} className="text-dark">
                        Use Feature Flags
                      </div>
                    </a>
                  </div>

                  <div className="col">
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        track("Choose Onboarding", {
                          type: "experiments",
                          source: "modal",
                        });
                        setOnboardingType("experiments");
                      }}
                      className="d-block border p-3 onboarding-choice"
                    >
                      <img
                        src="/images/getstarted-step3.svg"
                        className="mb-3"
                      />
                      <div style={{ fontSize: "1.3em" }} className="text-dark">
                        Analyze Experiment Results
                      </div>
                    </a>
                  </div>
                </div>

                <div className="mt-4">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      track("Choose Onboarding", {
                        type: "skip",
                        source: "modal",
                      });
                      setOnboardingType("experiments");
                    }}
                  >
                    I&apos;m just here to explore, skip this step
                  </a>
                </div>
              </div>
            </div>
          </>
        )}
        {hasExperiments || hasFeatures ? (
          <Dashboard
            features={features?.features || []}
            experiments={experiments?.experiments || []}
          />
        ) : (
          <GetStarted
            experiments={experiments?.experiments || []}
            features={features?.features || []}
            mutateExperiments={mutateExperiments}
            mutateFeatures={mutateFeatures}
            onboardingType={
              onboardingType ??
              (startedFeatOnboarding ? "features" : "experiments")
            }
          />
        )}
      </div>
    </>
  );
}
