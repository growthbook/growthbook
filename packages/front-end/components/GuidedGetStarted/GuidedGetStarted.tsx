import { FeatureInterface } from "back-end/types/feature";
import router from "next/router";
import React, { ReactNode, useState } from "react";
import ReactPlayer from "react-player";
import Link from "next/link";
import clsx from "clsx";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import useSDKConnections from "@/hooks/useSDKConnections";
import usePermissions from "@/hooks/usePermissions";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import FeatureModal from "../Features/FeatureModal";
import NewDataSourceForm from "../Settings/NewDataSourceForm";
import { DocLink, DocSection } from "../DocLink";
import InitialSDKConnectionForm from "../Features/SDKConnections/InitialSDKConnectionForm";
import MetricForm from "../Metrics/MetricForm";
import styles from "./GuidedGetStarted.module.scss";
import GetStartedSteps from "./GetStartedSteps";
import SuccessCard from "./SuccessCard";

export type Task = {
  blackTitle: string;
  purpleTitle: string;
  text?: string;
  learnMoreLink?: string;
  docSection?: DocSection;
  completed?: boolean;
  render: ReactNode;
  inviteTeammates?: boolean;
  additionalCta?: ReactNode;
  alwaysShowHelperText?: boolean;
};

export default function GuidedGetStarted({
  features,
  experiments,
}: {
  features: FeatureInterface[];
  experiments: ExperimentInterfaceStringDates[];
  mutate: () => void;
}) {
  const [skippedSteps, setSkippedSteps] = useLocalStorage<{
    [key: string]: boolean;
  }>("onboarding-steps-skipped", {});
  const [showVideo, setShowVideo] = useState(false);
  const permissions = usePermissions();

  const { data: SDKData } = useSDKConnections();

  const { metrics } = useDefinitions();
  const settings = useOrgSettings();
  const { datasources } = useDefinitions();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();

  const { exists: demoProjectExists } = useDemoDataSourceProject();

  const steps: Task[] = [
    {
      alwaysShowHelperText: true,
      blackTitle: "Welcome to ",
      purpleTitle: "GrowthBook!",
      text:
        "GrowthBook is a modular platform that enables teams to create feature flags and analyze experiment results. These features can be used together, or on their own - the choice is yours.",
      completed:
        settings?.videoInstructionsViewed ||
        datasources.length > 0 ||
        features.length > 0,
      additionalCta: (
        <>
          {permissions.manageTeam && (
            <Link href="/settings/team">
              <a className="font-weight-bold">
                Not an engineer? Invite a developer to get started.
              </a>
            </Link>
          )}
        </>
      ),
      render: (
        <>
          <div className={clsx(styles.playerWrapper, "col-lg-6")}>
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
          <button
            onClick={() => setCurrentStep(currentStep + 1)}
            className="btn btn-primary m-4"
          >
            Step 1: Create a Feature Flag
          </button>
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={(e) => {
              e.preventDefault();
              router.push("/features");
            }}
          >
            Skip Onboarding
          </button>
        </>
      ),
    },
    {
      blackTitle: "Create a ",
      purpleTitle: "Feature Flag",
      text:
        "Create a feature flag within GrowthBook. Use feature flags to toggle app behavior, do gradual rollouts, and run A/B tests.",
      learnMoreLink: "Learn more about how to use feature flags.",
      docSection: "features",
      completed: features.length > 0 || skippedSteps["feature-flag"],
      render: (
        <>
          {features.length > 0 ? (
            <SuccessCard
              feature="feature flag"
              href="/features"
              onClick={async () => setCurrentStep(currentStep + 1)}
              nextStep="Next: Install an SDK"
            />
          ) : (
            <FeatureModal
              inline={true}
              cta={"Next: Install an SDK"}
              onSuccess={async () => {
                setCurrentStep(currentStep + 1);
              }}
              secondaryCTA={
                <button
                  onClick={() => {
                    setSkippedSteps({ ...skippedSteps, "feature-flag": true });
                    setCurrentStep(currentStep + 1);
                  }}
                  className="btn btn-link"
                >
                  Skip Step
                </button>
              }
            />
          )}
        </>
      ),
    },
    {
      alwaysShowHelperText: true,
      blackTitle: "Install an ",
      purpleTitle: "SDK",
      text:
        "Integrate GrowthBook into your front-end, back-end, or mobile application.",
      learnMoreLink: "Learn more about our SDKs.",
      docSection: "sdks",
      completed:
        // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        SDKData?.connections.length > 0 || skippedSteps["install-sdk"] || false,
      render: (
        <InitialSDKConnectionForm
          inline={true}
          cta={"Next: Check Your Connection"}
          goToNextStep={() => setCurrentStep(currentStep + 1)}
          feature={features?.[0]}
          includeCheck={true}
          secondaryCTA={
            <button
              onClick={() => {
                setSkippedSteps({ ...skippedSteps, "install-sdk": true });
                setCurrentStep(currentStep + 1);
              }}
              className="btn btn-link"
            >
              Skip Step
            </button>
          }
        />
      ),
    },
    {
      blackTitle: "Add a ",
      purpleTitle: "Data Source",
      text:
        "GrowthBook needs read access to where your experiment and metric data lives. We support Mixpanel, Snowflake, Redshift, BigQuery, Google Analytics, and more. If you don't see yours, let us know or open a GitHub issue.",
      learnMoreLink: "Learn more about how to connect to a data source.",
      docSection: "datasources",
      completed: datasources.length > 0 || skippedSteps["data-source"],
      render: (
        <>
          {datasources.length > 0 ? (
            <SuccessCard
              feature="data source"
              href="/datasources"
              onClick={async () => setCurrentStep(currentStep + 1)}
              nextStep="Next: Define a Metric"
            />
          ) : (
            <NewDataSourceForm
              data={{
                name: "My Datasource",
                settings: {},
              }}
              existing={false}
              inline={true}
              source="get-started"
              onSuccess={async () => {
                setCurrentStep(currentStep + 1);
              }}
              secondaryCTA={
                <button
                  onClick={() => {
                    setSkippedSteps({ ...skippedSteps, "data-source": true });
                    setCurrentStep(currentStep + 1);
                  }}
                  className="btn btn-link"
                >
                  Skip Step
                </button>
              }
              showImportSampleData={!demoProjectExists}
            />
          )}
        </>
      ),
    },
    {
      blackTitle: "Define a ",
      purpleTitle: "Metric",
      text:
        "Create a library of metrics to experiment against. You can always add more at any time, and even add them retroactively to past experiments.",
      learnMoreLink: "Learn more about how to use metrics.",
      docSection: "metrics",
      completed: metrics.length > 0 || skippedSteps["metric-definition"],
      render: (
        <>
          {metrics.length > 0 ? (
            <SuccessCard
              feature="metric"
              href="/metrics"
              onClick={async () => setCurrentStep(currentStep + 1)}
              nextStep="Next: Continue Setting up Account"
            />
          ) : (
            <MetricForm
              inline={true}
              cta={"Finish"}
              current={{}}
              edit={false}
              source="get-started"
              onSuccess={() => {
                setCurrentStep(currentStep + 1);
              }}
              secondaryCTA={
                <button
                  onClick={() => {
                    setSkippedSteps({
                      ...skippedSteps,
                      "metric-definition": true,
                    });
                    setCurrentStep(currentStep + 1);
                  }}
                  className="btn btn-link"
                >
                  Skip Step
                </button>
              }
            />
          )}
        </>
      ),
    },
    {
      alwaysShowHelperText: true,
      blackTitle: "Great ",
      purpleTitle: "Work!",
      completed: experiments.length > 0,
      text:
        "Here are a few more things you can do to get the most out of your GrowthBook account.",
      render: (
        <div className="col-12 col-sm-8 col-lg-6">
          {permissions.check("manageTeam") ? (
            <Link href="/settings/team" className={styles.nextStepWrapper}>
              <h2
                role="button"
                className={clsx("text-center p-4 m-1", styles.nextStepLink)}
              >
                Invite Your Teammates
              </h2>
            </Link>
          ) : (
            <Link href="/features" className={styles.nextStepWrapper}>
              <h2
                role="button"
                className={clsx("text-center p-4 m-1", styles.nextStepLink)}
              >
                View Features
              </h2>
            </Link>
          )}
          <Link href="/experiments" className={styles.nextStepWrapper}>
            <h2
              role="button"
              className={clsx("text-center p-4 m-1", styles.nextStepLink)}
            >
              Analyze a Previous Experiment
            </h2>
          </Link>
          <a
            role="button"
            target="_blank"
            rel="noreferrer"
            href="https://slack.growthbook.io?ref=app-getstarted"
            className={styles.nextStepWrapper}
          >
            <h2 className={clsx("text-center p-4 m-1", styles.nextStepLink)}>
              Join our Slack Community
            </h2>
          </a>
        </div>
      ),
    },
  ];

  const [currentStep, setCurrentStep] = useState(() => {
    const initialStep = steps.findIndex((step) => step.completed === false);

    if (initialStep >= 0) {
      return initialStep;
    } else {
      return steps.length - 1;
    }
  });

  return (
    <>
      <GetStartedSteps
        setCurrentStep={setCurrentStep}
        currentStep={currentStep}
        steps={steps}
      />
      <div className="d-flex flex-column">
        <div className="d-flex flex-column align-items-center pl-4 pr-4 pt-2 pb-2">
          <h1 className="text-center">
            <span className={styles.blackTitle}>
              {steps[currentStep].blackTitle}
            </span>
            <span className={styles.purpleTitle}>
              {steps[currentStep].purpleTitle}
            </span>
          </h1>
          {((steps[currentStep].text && !steps[currentStep].completed) ||
            steps[currentStep].alwaysShowHelperText) && (
            <p className="text-center col-10">
              {`${steps[currentStep].text} `}
              {steps[currentStep].learnMoreLink &&
                steps[currentStep].docSection && (
                  <span>
                    {/* @ts-expect-error TS(2322) If you come across this, please fix it!: Type '"ruby" | "home" | "features" | "experiments"... Remove this comment to see the full error message */}
                    <DocLink docSection={steps[currentStep].docSection}>
                      {steps[currentStep].learnMoreLink}
                    </DocLink>
                  </span>
                )}
            </p>
          )}
          {steps[currentStep].additionalCta}
        </div>
        <div className="d-flex flex-column align-items-center pl-4 pr-4 pb-4 pt-1">
          {steps[currentStep].render}
        </div>
      </div>
    </>
  );
}
