import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import router from "next/router";
import React, { ReactNode, useMemo, useState } from "react";
import useOrgSettings from "../hooks/useOrgSettings";
import ImportExperimentModal from "./Experiment/ImportExperimentModal";
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

export type Task = {
  blackTitle: string;
  purpleTitle: string;
  text: string;
  cta: string;
  learnMoreLink?: string;
  link?: string;
  completed: boolean;
  feature:
    | "video"
    | "sdk"
    | "feature-flag"
    | "data-source"
    | "metric"
    | "experiment";
  render: ReactNode;
};

type Props = {
  experiments: {
    experiments: ExperimentInterfaceStringDates[];
  };
  features: FeatureInterface[];
};

export default function GuidedGetStarted({ experiments, features }: Props) {
  const { metrics } = useDefinitions();
  const settings = useOrgSettings();
  const { datasources } = useDefinitions();

  // If this is coming from a feature experiment rule
  const featureExperiment = useMemo(() => {
    if (!router?.query?.featureExperiment) {
      return null;
    }
    try {
      const initialExperiment: Partial<ExperimentInterfaceStringDates> = JSON.parse(
        router?.query?.featureExperiment as string
      );
      window.history.replaceState(null, null, window.location.pathname);
      return initialExperiment;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [router?.query?.featureExperiment]);

  const steps: Task[] = [
    {
      blackTitle: "Welcome to ",
      purpleTitle: "GrowthBook!",
      text:
        "This quick start guide is designed to get you up and running with GrowthBook in ~15 minutes!",
      completed: settings?.videoInstructionsViewed || false,
      cta: "Watch Video",
      feature: "video",
      render: (
        <>
          <ReactPlayer
            className="mb-4"
            url="https://www.youtube.com/watch?v=1ASe3K46BEw"
            light={true}
            playing={true}
            controls={true}
            style={{ boxShadow: "#9D9D9D 4px 4px 12px 0px" }}
            onClick={() => updateSettings("videoInstructionsViewed")}
          />
          <p style={{ fontWeight: "bold", color: "#1C63EA" }}>
            Watch a 2-min demo
          </p>
          <button
            onClick={() => setCurrentStep(currentStep + 1)}
            className="btn btn-primary w-25 m-2"
          >
            Next: Install SDK
          </button>
          <button className="btn btn-outline-primary w-25 m-2">
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
      completed: settings?.sdkInstructionsViewed || false,
      feature: "sdk",
      render: (
        <CodeSnippetModal
          inline={true}
          cta={"Next: Create Feature Flag"}
          submit={async () => {
            setCurrentStep(currentStep + 1);
          }}
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
      completed: features.length > 0,
      feature: "feature-flag",
      render: (
        <FeatureModal
          inline={true}
          cta={"Next: Add a Data Source"}
          onSuccess={async () => {
            setCurrentStep(currentStep + 1);
          }}
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
      completed: datasources.length > 0,
      feature: "data-source",
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
      completed: metrics.length > 0,
      feature: "metric",
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
        />
      ),
    },
    {
      blackTitle: "Create an ",
      purpleTitle: "Experiment",
      text:
        "Import an existing experiment from your data source or create a new draft from scratch.",
      cta: "Create Experiment",
      learnMoreLink: "Learn more about experiments.",
      link: "https://docs.growthbook.io/app/experiments",
      completed: experiments?.experiments.length > 0,
      feature: "experiment",
      render: (
        <ImportExperimentModal
          inline={true}
          source={featureExperiment ? "feature-rule" : "get-started"}
          initialValue={featureExperiment}
          fromFeature={!!featureExperiment}
        />
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

  async function updateSettings(stepViewed: string) {
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          [stepViewed]: true,
        },
      }),
    });
    await update();
  }

  return (
    <>
      <GetStartedSteps
        setCurrentStep={setCurrentStep}
        currentStep={currentStep}
        steps={steps}
      />
      <div className="d-flex flex-column pl-5 pr-5">
        <div className="d-flex flex-column align-items-center p-2">
          <h1>
            <span>{steps[currentStep].blackTitle}</span>
            <span style={{ color: "#7C45E9", fontWeight: "bold" }}>
              {steps[currentStep].purpleTitle}
            </span>
          </h1>
          <h5
            className="m-0"
            style={{ textAlign: "center", maxWidth: "800px" }}
          >
            {steps[currentStep].text}
            {steps[currentStep].learnMoreLink && steps[currentStep].link && (
              <span>
                <Link href={steps[currentStep].link}>
                  <a>{` ${steps[currentStep].learnMoreLink}`}</a>
                </Link>
              </span>
            )}
          </h5>
          {steps[currentStep].blackTitle === "Welcome to " && (
            <Link href="/settings/team">
              <a style={{ fontWeight: "bold" }}>
                Not an engineer? Invite a developer to get started.
              </a>
            </Link>
          )}
        </div>
        <div className="d-flex flex-column align-items-center p-4">
          {steps[currentStep].render}
        </div>
      </div>
    </>
  );
}
