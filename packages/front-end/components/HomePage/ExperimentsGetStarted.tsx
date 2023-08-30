import React, { useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useRouter } from "next/router";
import { FaArrowLeft } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import usePermissions from "@/hooks/usePermissions";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import MetricForm from "@/components/Metrics/MetricForm";
import { DocLink } from "@/components/DocLink";
import DocumentationLinksSidebar from "@/components/HomePage/DocumentationLinksSidebar";
import GetStartedStep from "@/components/HomePage/GetStartedStep";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import AddExperimentModal from "../Experiment/AddExperimentModal";

const ExperimentsGetStarted = ({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
  mutate: () => void;
}): React.ReactElement => {
  const { metrics, datasources, mutateDefinitions, project } = useDefinitions();

  const permissions = usePermissions();

  const [dataSourceOpen, setDataSourceOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
  const router = useRouter();

  const [showAnalysisSteps, setShowAnalysisSteps] = useState(false);

  // If this is coming from a feature experiment rule
  const featureExperiment = useMemo(() => {
    if (!router?.query?.featureExperiment) {
      return null;
    }
    try {
      const initialExperiment: Partial<ExperimentInterfaceStringDates> = JSON.parse(
        router?.query?.featureExperiment as string
      );
      window.history.replaceState(null, "", window.location.pathname);
      return initialExperiment;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [router?.query?.featureExperiment]);

  const hasDataSource = datasources.length > 0;
  const hasMetrics =
    metrics.filter((m) => !m.id.match(/^met_sample/)).length > 0;
  const hasExperiments =
    experiments.filter((m) => !m.id.match(/^exp_sample/)).length > 0;
  const currentStep = hasExperiments
    ? 4
    : hasMetrics
    ? 3
    : hasDataSource
    ? 2
    : 1;
  const { exists: demoProjectExists } = useDemoDataSourceProject();

  return (
    <>
      <div>
        {dataSourceOpen && (
          <NewDataSourceForm
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
            }}
            showImportSampleData={!demoProjectExists}
          />
        )}

        {metricsOpen && (
          <MetricForm
            current={{}}
            edit={false}
            source="get-started"
            onClose={() => {
              setMetricsOpen(false);
            }}
            onSuccess={() => {
              mutateDefinitions();
            }}
          />
        )}
        {experimentsOpen &&
          (featureExperiment ? (
            <ImportExperimentModal
              onClose={() => setExperimentsOpen(false)}
              source={featureExperiment ? "feature-rule" : "get-started"}
              initialValue={featureExperiment}
              fromFeature={!!featureExperiment}
            />
          ) : (
            <AddExperimentModal
              onClose={() => setExperimentsOpen(false)}
              source="get-started"
            />
          ))}

        {showAnalysisSteps ? (
          <>
            <div className="mb-2">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowAnalysisSteps(false);
                }}
              >
                <FaArrowLeft /> Back to Options
              </a>
            </div>
            <h1>Analyze an Existing Experiment</h1>
            <p>
              There are a few setup steps before you can analyze an existing
              experiment.
            </p>
            <div className="row">
              <div className="col-12 col-lg-8">
                {hasFileConfig() ? (
                  <div className="alert alert-info">
                    It looks like you have a <code>config.yml</code> file. Use
                    that to define data sources and metrics.{" "}
                    <DocLink docSection="config_yml">
                      View Documentation
                    </DocLink>
                  </div>
                ) : featureExperiment ? (
                  <div className="alert alert-info mb-3">
                    First connect to your data source and define a metric. Then
                    you can view results for your experiment.
                  </div>
                ) : null}
                <div className="row mb-3">
                  <div className="col">
                    <div
                      className={`card gsbox`}
                      style={{ overflow: "hidden" }}
                    >
                      <GetStartedStep
                        current={currentStep === 1}
                        finished={hasDataSource}
                        image="/images/getstarted-step1.svg"
                        title="1. Connect to your data warehouse"
                        text={
                          <>
                            GrowthBook needs read access to where your
                            experiment and metric data lives. We support
                            Snowflake, Redshift, BigQuery, Databricks, Postgres,
                            and more. If you don&apos;t see yours,{" "}
                            <a
                              className={``}
                              href="https://www.growthbook.io/contact"
                              target="_blank"
                              rel="noreferrer"
                            >
                              let us know
                            </a>{" "}
                            or{" "}
                            <a
                              href="https://github.com/growthbook/growthbook/issues/new"
                              target="_blank"
                              rel="noreferrer"
                            >
                              open a GitHub issue
                            </a>
                            .
                          </>
                        }
                        hideCTA={hasFileConfig()}
                        permissionsError={
                          // If data sources are managed in the UI
                          // If there's already a data source, you only need edit access to be able to view it
                          // Otherwise, you need full create access
                          !hasFileConfig() &&
                          !(hasDataSource
                            ? permissions.check(
                                "editDatasourceSettings",
                                project
                              )
                            : permissions.check("createDatasources", project))
                        }
                        cta="Add data source"
                        finishedCTA="View data sources"
                        imageLeft={true}
                        onClick={(finished) => {
                          if (finished) {
                            router.push("/datasources");
                          } else {
                            setDataSourceOpen(true);
                          }
                        }}
                      />
                      <GetStartedStep
                        current={currentStep === 2}
                        finished={hasMetrics}
                        className="border-top"
                        image="/images/getstarted-step2.svg"
                        title="2. Define a metric"
                        text={
                          <p>
                            Create your first metric definition. Use this as a
                            goal or guardrail when analyzing your experiment
                            results. With GrowthBook, you can build out an
                            entire metric library to represent all of the KPIs
                            for your business
                          </p>
                        }
                        hideCTA={hasFileConfig()}
                        cta="Add metric"
                        finishedCTA="View metrics"
                        permissionsError={
                          !hasFileConfig() &&
                          !permissions.check("createMetrics", project) &&
                          !hasMetrics
                        }
                        imageLeft={false}
                        onClick={(finished) => {
                          if (finished) {
                            router.push("/metrics");
                          } else {
                            setMetricsOpen(true);
                          }
                        }}
                      />
                      <GetStartedStep
                        current={currentStep === 3}
                        finished={hasExperiments}
                        className="border-top"
                        image="/images/getstarted-step3.svg"
                        title="3. Import an experiment"
                        text={
                          <p>
                            We&apos;ll scan your data warehouse looking for past
                            experiments that already have some data collected.
                            Choose one to import and start analyzing results.
                          </p>
                        }
                        hideCTA={false}
                        cta={"Import Experiment"}
                        finishedCTA="View experiments"
                        permissionsError={
                          !permissions.check("createAnalyses", project) &&
                          !hasExperiments
                        }
                        imageLeft={true}
                        onClick={(finished) => {
                          if (finished) {
                            router.push("/experiments");
                          } else {
                            setExperimentsOpen(true);
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <DocumentationLinksSidebar />
              </div>
            </div>
          </>
        ) : (
          <div>
            <h1>Experiments</h1>
            <p>
              There are three ways to get started with experimentation in
              GrowthBook.
            </p>

            <div className="row mb-3">
              <div className="col">
                <div className={`card gsbox`} style={{ overflow: "hidden" }}>
                  <GetStartedStep
                    current={true}
                    finished={false}
                    noActiveBorder={true}
                    className="border-top-0"
                    image="/images/sample-data-illustration.svg"
                    title="Option 1: Explore a Sample Experiment"
                    text={
                      <p>
                        Running an actual A/B test on your application and
                        waiting for results can take a long time, so this is a
                        great way to test out the platform with a fully loaded
                        sample experiment.
                      </p>
                    }
                    hideCTA={false}
                    cta="View Sample Experiment"
                    finishedCTA="View Sample Experiment"
                    permissionsError={
                      !permissions.check("createAnalyses", project)
                    }
                    imageLeft={false}
                    onClick={() => {
                      router.push("/demo-datasource-project");
                    }}
                  />
                  <GetStartedStep
                    current={true}
                    finished={false}
                    noActiveBorder={true}
                    className="border-top"
                    image="/images/design-experiment-illustration.svg"
                    title="Option 2: Design and Run a New Experiment"
                    text={
                      <p>
                        Design a new A/B test from scratch using either{" "}
                        <strong>Feature Flags</strong> or our{" "}
                        <strong>Visual Editor</strong>. Then, integrate our SDK
                        into your application and start collecting and analyzing
                        data from your users.
                      </p>
                    }
                    hideCTA={false}
                    cta="Design New Experiment"
                    finishedCTA="Design New Experiment"
                    permissionsError={
                      !permissions.check("createAnalyses", project)
                    }
                    imageLeft={true}
                    onClick={() => {
                      setExperimentsOpen(true);
                    }}
                  />
                  <GetStartedStep
                    current={true}
                    finished={false}
                    noActiveBorder={true}
                    className="border-top"
                    image="/images/analyze-results-illustration.svg"
                    title="Option 3: Analyze an Existing Experiment"
                    text={
                      <p>
                        Have you already been running A/B tests with another
                        platform? Connect GrowthBook to your data warehouse and
                        use our powerful stats engine to automate the analysis.
                      </p>
                    }
                    hideCTA={false}
                    cta="Analyze Existing Experiment"
                    finishedCTA="Analyze Existing Experiment"
                    permissionsError={
                      !permissions.check("createAnalyses", project)
                    }
                    imageLeft={false}
                    onClick={() => {
                      setShowAnalysisSteps(true);
                    }}
                  />
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <DocumentationLinksSidebar />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ExperimentsGetStarted;
