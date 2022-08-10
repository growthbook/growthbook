import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MetricInterface } from "back-end/types/metric";
import router from "next/router";
import React, { useEffect, useMemo, useState } from "react";
import CodeSnippetModal from "../components/Features/CodeSnippetModal";
import FeatureModal from "../components/Features/FeatureModal";
import SetupGuide from "../components/HomePage/SetupGuide";
import LoadingOverlay from "../components/LoadingOverlay";
import DataSourceForm from "../components/Settings/DataSourceForm";
import useApi from "../hooks/useApi";
import useOrgSettings from "../hooks/useOrgSettings";
import { useDefinitions } from "../services/DefinitionsContext";
import { useFeaturesList } from "../services/features";
import { hasFileConfig } from "../services/env";
import track from "../services/track";
import { useAuth } from "../services/auth";
import MetricForm from "../components/Metrics/MetricForm";
import ImportExperimentModal from "../components/Experiment/ImportExperimentModal";
// import GetStarted from "../components/HomePage/GetStarted";
import GetStartedVideoModal from "../components/Features/GetStartedVideoModal";
import EditDataSourceSettingsForm from "../components/Settings/EditDataSourceSettingsForm";

export type Task = {
  title: string;
  text: string;
  cta: string;
  learnMoreLink?: string;
  link?: string;
  completed: boolean;
  onClick: (value: boolean) => void;
};

const GetStartedPage = (): React.ReactElement => {
  const [modalOpen, setModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [dataSourceOpen, setDataSourceOpen] = useState(false);
  const [dataSourceQueriesOpen, setDataSourceQueriesOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
  const [percentComplete, setPercentComplete] = useState(undefined);
  const {
    datasources,
    ready,
    error: definitionsError,
    mutateDefinitions,
    metrics,
  } = useDefinitions();
  const { apiCall } = useAuth();

  const settings = useOrgSettings();

  const { data: experiments, mutate, error: experimentsError } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments`);

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

  const { data } = useApi<{ metrics: MetricInterface[] }>(`/metrics`);

  const { features, error: featuresError } = useFeaturesList();

  const hasSampleExperiment = experiments?.experiments.filter((m) =>
    m.id.match(/^exp_sample/)
  )[0];

  const hasDataSource = datasources.length > 0;

  const hasMetrics =
    metrics.filter((m) => !m.id.match(/^met_sample/)).length > 0;

  const hasExperiments =
    experiments?.experiments.filter((m) => !m.id.match(/^exp_sample/)).length >
    0;

  const allowImport = !(hasMetrics || hasExperiments) && !hasFileConfig();

  const importSampleData = (source: string) => async () => {
    const res = await apiCall<{
      experiment: string;
    }>(`/organization/sample-data`, {
      method: "POST",
    });
    await mutateDefinitions();
    await mutate();
    track("Add Sample Data", {
      source,
    });
    await router.push("/experiment/" + res.experiment);
  };

  const initialTasks: Task[] = [
    {
      title: "Video: Growthbook 101",
      text:
        "A very brief introduction to GrowthBook - the open-source feature flagging and A/B testing platform.",
      completed: settings?.videoInstructionsViewed,
      cta: "Watch Video",
      onClick: setVideoModalOpen,
    },
    {
      title: "Install SDK",
      text:
        "Integrate GrowthBook into your Javascript, React, Golang, Ruby, PHP, Python, or Android application. More languages and frameworks coming soon!",
      cta: "View Instructions",
      learnMoreLink: "Learn more about our SDKs.",
      link: "https://docs.growthbook.io/lib",
      onClick: setCodeModalOpen,
      completed: settings?.sdkInstructionsViewed,
    },
    {
      title: "Create a Feature Flag",
      text:
        "Create a feature flag within GrowthBook. Use feature flags to toggle app behavior, do gradual rollouts, and run A/B tests.",
      cta: "Create Feature Flag",
      learnMoreLink: "Learn more about how to use feature flags.",
      link: "https://docs.growthbook.io/app/features",
      onClick: setModalOpen,
      completed: features.length > 0,
    },
    {
      title: "Add a Data Source",
      text:
        "GrowthBook needs read access to where your experiment and metric data lives. We support Mixpanel, Snowflake, Redshift, BigQuery, Google Analytics, and more. If you don't see yours, let us know or open a GitHub issue.",
      cta: "Add Data Source",
      learnMoreLink: "Learn more about how to connect to a data source.",
      link: "https://docs.growthbook.io/app/datasources",
      completed: datasources.length > 0,
      onClick: setDataSourceOpen,
    },
    {
      title: "Define a Metric",
      text:
        "Create a library of metrics to experiment against. You can always add more at any time, and even add them retroactively to past experiments.",
      cta: "Define a Metric",
      learnMoreLink: "Learn more about how to use metrics.",
      link: "https://docs.growthbook.io/app/metrics",
      completed: data?.metrics.length > 0,
      onClick: setMetricsOpen,
    },
    {
      title: "Create an Experiment",
      text:
        "Import an existing experiment from your data source or create a new draft from scratch.",
      cta: "Create Experiment",
      learnMoreLink: "Learn more about experiments.",
      link: "https://docs.growthbook.io/app/experiments",
      completed: experiments?.experiments.length > 0,
      onClick: setExperimentsOpen,
    },
  ];

  useEffect(() => {
    if (settings) {
      let completedTasks = 0;
      initialTasks.forEach((task) => {
        if (task.completed) {
          completedTasks++;
        }
      });

      setPercentComplete(
        Math.round((completedTasks / initialTasks.length) * 100)
      );
    }
  }, [initialTasks, settings]);

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

  if (!experiments || !features || !ready || !percentComplete) {
    return <LoadingOverlay />;
  }

  // return (
  //   <>
  //     <div className="container pagecontents position-relative">
  //       <GetStarted
  //         experiments={experiments?.experiments || []}
  //         features={features}
  //         mutateExperiments={mutateExperiments}
  //         onboardingType={null}
  //       />
  //     </div>
  //   </>
  // );

  return (
    <>
      {videoModalOpen && (
        <GetStartedVideoModal close={() => setVideoModalOpen(false)} />
      )}
      {codeModalOpen && (
        <CodeSnippetModal close={() => setCodeModalOpen(false)} />
      )}
      {modalOpen && (
        <FeatureModal
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${
              features.length > 0 ? "" : "?first"
            }`;
            await router.push(url);
          }}
        />
      )}
      {dataSourceOpen && (
        <DataSourceForm
          data={{
            name: "My Datasource",
            settings: {},
          }}
          existing={false}
          source="get-started"
          onCancel={() => setDataSourceOpen(false)}
          onSuccess={async () => {
            await mutateDefinitions();
            setDataSourceOpen(false);
            setDataSourceQueriesOpen(true);
          }}
          importSampleData={
            !hasDataSource &&
            allowImport &&
            !hasSampleExperiment &&
            importSampleData("datasource-form")
          }
        />
      )}
      {metricsOpen && (
        <MetricForm
          current={{}}
          edit={false}
          source="get-started"
          onClose={(refresh) => {
            setMetricsOpen(false);
            if (refresh) {
              mutateDefinitions();
            }
          }}
        />
      )}
      {experimentsOpen && (
        <ImportExperimentModal
          onClose={() => setExperimentsOpen(false)}
          source={featureExperiment ? "feature-rule" : "get-started"}
          initialValue={featureExperiment}
          fromFeature={!!featureExperiment}
        />
      )}
      {dataSourceQueriesOpen &&
        datasources?.[0] &&
        datasources[0].properties?.hasSettings && (
          <EditDataSourceSettingsForm
            firstTime={true}
            data={datasources[0]}
            onCancel={() => setDataSourceQueriesOpen(false)}
            onSuccess={() => {
              setDataSourceQueriesOpen(false);
              mutateDefinitions();
            }}
            source="onboarding"
          />
        )}
      <div className="container pagecontents position-relative">
        <SetupGuide
          tasks={initialTasks}
          title="Quick Start Guide"
          percentComplete={percentComplete}
        />
        <SetupGuide
          tasks={initialTasks}
          title="Setup Advanced Features"
          percentComplete={percentComplete}
        />
        <SetupGuide
          tasks={initialTasks}
          title="Need Help?"
          percentComplete={percentComplete}
        />
      </div>
    </>
  );
};

export default GetStartedPage;
