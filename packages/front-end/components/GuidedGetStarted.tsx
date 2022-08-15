import { DimensionInterface } from "back-end/types/dimension";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import { MetricInterface } from "back-end/types/metric";
import { SegmentInterface } from "back-end/types/segment";
import router from "next/router";
import React, { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import useOrgSettings from "../hooks/useOrgSettings";
import { SettingsApiResponse } from "../pages/settings";
import { useAuth } from "../services/auth";
import { useDefinitions } from "../services/DefinitionsContext";
import { hasFileConfig } from "../services/env";
import { useAttributeSchema } from "../services/features";
import track from "../services/track";
import DimensionForm from "./Dimensions/DimensionForm";
import ImportExperimentModal from "./Experiment/ImportExperimentModal";
import CodeSnippetModal from "./Features/CodeSnippetModal";
import EditAttributesModal from "./Features/EditAttributesModal";
import FeatureModal from "./Features/FeatureModal";
import GetStartedVideoModal from "./Features/GetStartedVideoModal";
import { GetHelpDiv } from "./GetHelpDiv";
import SetupGuide from "./HomePage/SetupGuide";
import { ExpandableDrawer } from "./Layout/ExpandableDrawer";
import MetricForm from "./Metrics/MetricForm";
import SegmentForm from "./Segments/SegmentForm";
import DataSourceForm from "./Settings/DataSourceForm";
import EditDataSourceSettingsForm from "./Settings/EditDataSourceSettingsForm";

export type Task = {
  title: string;
  text: string;
  cta: string;
  learnMoreLink?: string;
  link?: string;
  completed: boolean;
  onClick: (
    value: boolean | null
  ) =>
    | void
    | Promise<void>
    | ((value: null | Partial<DimensionInterface>) => void);
};

type Props = {
  experiments: {
    experiments: ExperimentInterfaceStringDates[];
  };
  features: FeatureInterface[];
  data: {
    metrics: MetricInterface[];
  };
  mutate: () => void;
};

export default function GuidedGetStarted({
  experiments,
  features,
  data,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const [
    initialTasksPercentComplete,
    setInitialTasksPercentComplete,
  ] = useState(null);
  const [
    advancedTasksPercentComplete,
    setAdvancedTasksPercentComplete,
  ] = useState(null);
  const [dismissedSteps, setDismissedSteps] = useState(
    settings.dismissedGettingStartedSteps || {}
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [dataSourceOpen, setDataSourceOpen] = useState(false);
  const [dataSourceQueriesOpen, setDataSourceQueriesOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [dimensionForm] = useState<null | Partial<DimensionInterface>>({});
  const [dimensionFormOpen, setDimensionFormOpen] = useState(false);
  const [segmentForm] = useState<null | Partial<SegmentInterface>>({});
  const [segmentFormOpen, setSegmentFormOpen] = useState(false);

  const attributeSchema = useAttributeSchema();

  const {
    dimensions,
    segments,
    datasources,
    mutateDefinitions,
    metrics,
  } = useDefinitions();

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

  const org = useApi<SettingsApiResponse>(`/organization`);

  const hasDataSource = datasources.length > 0;

  const hasMetrics =
    metrics.filter((m) => !m.id.match(/^met_sample/)).length > 0;

  const hasExperiments =
    experiments?.experiments.filter((m) => !m.id.match(/^exp_sample/)).length >
    0;

  const allowImport = !(hasMetrics || hasExperiments) && !hasFileConfig();

  const hasSampleExperiment = experiments?.experiments.filter((m) =>
    m.id.match(/^exp_sample/)
  )[0];

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
      completed:
        settings?.videoInstructionsViewed ||
        dismissedSteps["Video: Growthbook 101"],
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
      completed:
        settings?.sdkInstructionsViewed || dismissedSteps["Install SDK"],
    },
    {
      title: "Create a Feature Flag",
      text:
        "Create a feature flag within GrowthBook. Use feature flags to toggle app behavior, do gradual rollouts, and run A/B tests.",
      cta: "Create Feature Flag",
      learnMoreLink: "Learn more about how to use feature flags.",
      link: "https://docs.growthbook.io/app/features",
      onClick: setModalOpen,
      completed: features.length > 0 || dismissedSteps["Create a Feature Flag"],
    },
    {
      title: "Add a Data Source",
      text:
        "GrowthBook needs read access to where your experiment and metric data lives. We support Mixpanel, Snowflake, Redshift, BigQuery, Google Analytics, and more. If you don't see yours, let us know or open a GitHub issue.",
      cta: "Add Data Source",
      learnMoreLink: "Learn more about how to connect to a data source.",
      link: "https://docs.growthbook.io/app/datasources",
      completed: datasources.length > 0 || dismissedSteps["Add a Data Source"],
      onClick: setDataSourceOpen,
    },
    {
      title: "Define a Metric",
      text:
        "Create a library of metrics to experiment against. You can always add more at any time, and even add them retroactively to past experiments.",
      cta: "Define a Metric",
      learnMoreLink: "Learn more about how to use metrics.",
      link: "https://docs.growthbook.io/app/metrics",
      completed: data?.metrics.length > 0 || dismissedSteps["Define a Metric"],
      onClick: setMetricsOpen,
    },
    {
      title: "Create an Experiment",
      text:
        "Import an existing experiment from your data source or create a new draft from scratch.",
      cta: "Create Experiment",
      learnMoreLink: "Learn more about experiments.",
      link: "https://docs.growthbook.io/app/experiments",
      completed:
        experiments?.experiments.length > 0 ||
        dismissedSteps["Create an Experiment"],
      onClick: setExperimentsOpen,
    },
  ];

  const advancedTasks: Task[] = [
    {
      title: "Create a Dimension",
      text:
        "User Dimensions are attributes of your users - for example, 'subscription plan' or 'age group'. In Growth Book, you can use these to drill down into experiment results.",
      completed: dimensions.length > 0 || dismissedSteps["Create a dimension"],
      cta: "Create a Dimension",
      learnMoreLink: "Learn more about dimensions.",
      link: "https://docs.growthbook.io/app/dimensions",
      onClick: setDimensionFormOpen,
    },
    {
      title: "Create a Segment",
      text:
        "Segments define important groups of users - for example, 'annual subscribers' or 'left-handed people from France.'",
      cta: "Create a Segment",
      completed: segments.length > 0 || dismissedSteps["Create a segment"],
      onClick: setSegmentFormOpen,
    },
    {
      title: "Define an Attribute",
      text:
        "Attributes can be used when targeting feature flags. Attributes set here must also be passed in through the SDK.",
      cta: "Create an Attribute",
      onClick: setAttributesOpen,
      completed:
        attributeSchema.length > 0 || dismissedSteps["Define an attribute"],
    },
    {
      title: "Invite teammates",
      text:
        "GrowthBook needs read access to where your experiment and metric data lives. We support Mixpanel, Snowflake, Redshift, BigQuery, Google Analytics, and more. If you don't see yours, let us know or open a GitHub issue.",
      cta: "Invite a Teammate",
      completed:
        org.data?.organization.members.length +
          org.data?.organization.invites.length >
          1 || dismissedSteps["Invite teammates"],
      onClick: () => {
        router.push("/settings/team");
      },
    },
    {
      title: "Install our Chrome Plugin",
      text:
        "QA and debug feature flags and experiments from GrowthBook's js/react SDKs.",
      cta: "Get the Plugin",
      completed:
        settings?.pluginInstructionsViewed ||
        dismissedSteps["Install our Chrome Plugin"],
      onClick: async () => {
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: {
              pluginInstructionsViewed: true,
            },
          }),
        });
        window.open(
          "https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia",
          "_blank",
          "noopener,noreferrer"
        );
      },
    },
  ];

  const calculatePercentComplete = (tasks) => {
    let tasksCompleted = 0;
    tasks.forEach((task) => {
      if (task.completed) {
        tasksCompleted++;
      }
    });

    return Math.round(tasksCompleted / tasks.length) * 100;
  };

  useEffect(() => {
    if (settings && features && experiments) {
      setInitialTasksPercentComplete(calculatePercentComplete(initialTasks));
      setAdvancedTasksPercentComplete(calculatePercentComplete(advancedTasks));
    }
  }, [initialTasks, advancedTasks, settings]);

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
      {dimensionFormOpen && (
        <DimensionForm
          close={() => setDimensionFormOpen(false)}
          current={dimensionForm}
        />
      )}
      {segmentFormOpen && (
        <SegmentForm
          close={() => setSegmentFormOpen(false)}
          current={segmentForm}
        />
      )}
      {attributesOpen && (
        <EditAttributesModal close={() => setAttributesOpen(false)} />
      )}
      <ExpandableDrawer
        title="Quick Start Guide"
        percentComplete={initialTasksPercentComplete}
        open={
          initialTasksPercentComplete && initialTasksPercentComplete === 100
            ? false
            : true
        }
      >
        <SetupGuide
          showSubHead
          tasks={initialTasks}
          dismissedSteps={dismissedSteps}
          setDismissedSteps={setDismissedSteps}
        />
      </ExpandableDrawer>
      <ExpandableDrawer
        title="Setup Advanced Features"
        percentComplete={advancedTasksPercentComplete}
        open={false}
      >
        <SetupGuide
          tasks={advancedTasks}
          dismissedSteps={dismissedSteps}
          setDismissedSteps={setDismissedSteps}
        />
      </ExpandableDrawer>
      <ExpandableDrawer title="Need Help?" open={false}>
        <GetHelpDiv />
      </ExpandableDrawer>
    </>
  );
}
