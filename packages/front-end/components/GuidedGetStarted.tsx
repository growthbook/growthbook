import { FeatureInterface } from "back-end/types/feature";
import router from "next/router";
import React, { ReactNode, useState } from "react";
import useOrgSettings from "../hooks/useOrgSettings";
import CodeSnippetModal from "./Features/CodeSnippetModal";
import FeatureModal from "./Features/FeatureModal";
import GetStartedSteps from "./GetStartedSteps";
import MetricForm from "./Metrics/MetricForm";
import DataSourceForm from "./Settings/DataSourceForm";
import ReactPlayer from "react-player";
import Link from "next/link";
import { useDefinitions } from "../services/DefinitionsContext";
import useUser from "../hooks/useUser";
import { useAuth } from "../services/auth";
import { useLocalStorage } from "../hooks/useLocalStorage";
import styles from "./GuidedGetStarted.module.scss";
import clsx from "clsx";

export type Task = {
  blackTitle: string;
  purpleTitle: string;
  text: string;
  cta?: string;
  learnMoreLink?: string;
  link?: string;
  completed?: boolean;
  render: ReactNode;
};

export default function GuidedGetStarted({
  features,
}: {
  features: FeatureInterface[];
}) {
  const [skippedSteps, setSkippedSteps] = useLocalStorage<{
    [key: string]: boolean;
  }>("onboarding-steps-skipped", {});

  const { metrics } = useDefinitions();
  const settings = useOrgSettings();
  const { datasources } = useDefinitions();

  const steps: Task[] = [
    {
      blackTitle: "Welcome to ",
      purpleTitle: "GrowthBook!",
      text:
        "GrowthBook is a modular platform that enables teams to create feature flags and analyze experiment results. These features can be used together, or on their own - the choice is yours.",
      completed: settings?.videoInstructionsViewed || false,
      render: (
        <>
          <ReactPlayer
            className={clsx("mb-4", styles.reactPlayer)}
            url="https://www.youtube.com/watch?v=1ASe3K46BEw"
            light={true}
            playing={true}
            controls={true}
            onClick={() => updateSettings()}
          />
          <button
            onClick={() => setCurrentStep(currentStep + 1)}
            className="btn btn-primary w-25 m-2"
          >
            Set up your SDK
          </button>
          <button
            className="btn btn-outline-secondary btn-sm m-4"
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
      blackTitle: "Install an ",
      purpleTitle: "SDK",
      text:
        "Integrate GrowthBook into your Javascript, React, Golang, Ruby, PHP, Python, or Android application. More languages and frameworks coming soon!",
      cta: "View Instructions",
      learnMoreLink: "Learn more about our SDKs.",
      link: "https://docs.growthbook.io/lib",
      completed:
        settings?.sdkInstructionsViewed || skippedSteps["install-sdk"] || false,
      render: (
        <CodeSnippetModal
          inline={true}
          cta={"Next: Create Feature Flag"}
          submit={async () => {
            setCurrentStep(currentStep + 1);
          }}
          secondaryCTA={
            <button
              onClick={() => {
                setSkippedSteps({ ...skippedSteps, "install-sdk": true });
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
      blackTitle: "Create a ",
      purpleTitle: "Feature Flag",
      text:
        "Create a feature flag within GrowthBook. Use feature flags to toggle app behavior, do gradual rollouts, and run A/B tests.",
      cta: "Create Feature Flag",
      learnMoreLink: "Learn more about how to use feature flags.",
      link: "https://docs.growthbook.io/app/features",
      completed: features.length > 0 || skippedSteps["feature-flag"],
      render: (
        <FeatureModal
          inline={true}
          cta={"Next: Add a Data Source"}
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
      ),
    },
    {
      blackTitle: "Add a ",
      purpleTitle: "Data Source",
      text:
        "GrowthBook needs read access to where your experiment and metric data lives. We support Mixpanel, Snowflake, Redshift, BigQuery, Google Analytics, and more. If you don't see yours, let us know or open a GitHub issue.",
      cta: "Add Data Source",
      learnMoreLink: "Learn more about how to connect to a data source.",
      link: "https://docs.growthbook.io/app/datasources",
      completed: datasources.length > 0 || skippedSteps["data-source"],
      render: (
        <DataSourceForm
          data={{
            name: "My Datasource",
            settings: {},
          }}
          existing={false}
          source="get-started"
          inline={true}
          cta={"Next: Add a Data Source"}
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
        />
      ),
    },
    {
      blackTitle: "Define a ",
      purpleTitle: "Metric",
      text:
        "Create a library of metrics to experiment against. You can always add more at any time, and even add them retroactively to past experiments.",
      cta: "Define a Metric",
      learnMoreLink: "Learn more about how to use metrics.",
      link: "https://docs.growthbook.io/app/metrics",
      completed: metrics.length > 0 || skippedSteps["metric-definition"],
      render: (
        <MetricForm
          inline={true}
          cta={"Next: Create Experiment"}
          current={{}}
          edit={false}
          source="get-started"
          onSuccess={() => {
            setCurrentStep(currentStep + 1);
          }}
          secondaryCTA={
            <button
              onClick={() => {
                setSkippedSteps({ ...skippedSteps, "metric-definition": true });
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
      blackTitle: "Great ",
      purpleTitle: "Work!",
      completed: false,
      text:
        "Here are a few more things you can do to get the most out of your GrowthBook account.",
      render: (
        <div className="d-flex justify-content-space-between">
          <Link href="/settings/team" className={styles.nextStepWrapper}>
            <h1
              role="button"
              className={clsx("text-center p-4 m-1", styles.nextStepLink)}
            >
              Invite your Teammates
            </h1>
          </Link>
          <Link href="/experiments" className={styles.nextStepWrapper}>
            <h1
              role="button"
              className={clsx("text-center p-4 m-1", styles.nextStepLink)}
            >
              Analyze a Previous Experiment
            </h1>
          </Link>
          <a
            role="button"
            target="_blank"
            rel="noreferrer"
            href="https://slack.growthbook.io?ref=app-getstarted"
            className={styles.nextStepWrapper}
          >
            <h1 className={clsx("text-center p-4 m-1", styles.nextStepLink)}>
              Join our Slack Community
            </h1>
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
      return 0;
    }
  });
  const { apiCall } = useAuth();
  const { update } = useUser();

  async function updateSettings() {
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          videoInstructionsViewed: true,
        },
      }),
    });
    await update();
  }

  return (
    <div
      className={clsx("contents container pagecontents", styles.pageWrapper)}
    >
      <GetStartedSteps
        setCurrentStep={setCurrentStep}
        currentStep={currentStep}
        steps={steps}
      />
      <div className="d-flex flex-column">
        <div className="d-flex flex-column align-items-center pl-4 pr-4 pt-2 pb-2">
          <h1>
            <span className={styles.blackTitle}>
              {steps[currentStep].blackTitle}
            </span>
            <span className={styles.purpleTitle}>
              {steps[currentStep].purpleTitle}
            </span>
          </h1>
          <p className="text-center">
            {steps[currentStep].text}
            {steps[currentStep].learnMoreLink && steps[currentStep].link && (
              <span>
                <Link href={steps[currentStep].link}>
                  <a>{` ${steps[currentStep].learnMoreLink}`}</a>
                </Link>
              </span>
            )}
          </p>
          {steps[currentStep].blackTitle === "Welcome to " && (
            <Link href="/settings/team">
              <a className="font-weight-bold">
                Not an engineer? Invite a developer to get started.
              </a>
            </Link>
          )}
        </div>
        <div className="d-flex flex-column align-items-center pl-4 pr-4 pb-4 pt-1">
          {steps[currentStep].render}
        </div>
      </div>
    </div>
  );
}
