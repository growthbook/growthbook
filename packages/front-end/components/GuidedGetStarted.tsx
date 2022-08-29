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
            className="mb-4"
            url="https://www.youtube.com/watch?v=1ASe3K46BEw"
            light={true}
            playing={true}
            controls={true}
            style={{ boxShadow: "#9D9D9D 4px 4px 12px 0px" }}
            onClick={() => updateSettings("videoInstructionsViewed")}
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
      completed: settings?.sdkInstructionsViewed || false,
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
      blackTitle: "Great ",
      purpleTitle: "Work!",
      text:
        "Here are a few more things you can do to get the most out of your GrowthBook account.",
      render: (
        <div className="d-flex justify-content-space-between">
          <div>
            <h1
              role="button"
              className="text-center p-4 m-1"
              style={{ border: "1px solid black", borderRadius: "5px" }}
            >
              Invite your Teammates
            </h1>
          </div>
          <div>
            <h1
              role="button"
              className="text-center p-4 m-1"
              style={{ border: "1px solid black", borderRadius: "5px" }}
            >
              Analyze a Previous Experiement
            </h1>
          </div>
          <div>
            <h1
              role="button"
              className="text-center p-4 m-1"
              style={{ border: "1px solid black", borderRadius: "5px" }}
            >
              Join our Slack Community
            </h1>
          </div>
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
          <p style={{ textAlign: "center", maxWidth: "800px" }}>
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
