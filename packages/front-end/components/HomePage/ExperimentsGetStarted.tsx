import React, { useState } from "react";
import { useRouter } from "next/router";
import { FaArrowLeft } from "react-icons/fa";
import { ProjectInterface } from "shared/types/project";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { envAllowsCreatingMetrics, hasFileConfig } from "@/services/env";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import MetricForm from "@/components/Metrics/MetricForm";
import { DocLink } from "@/components/DocLink";
import DocumentationLinksSidebar from "@/components/HomePage/DocumentationLinksSidebar";
import GetStartedStep from "@/components/HomePage/GetStartedStep";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import CreateExperimentModal from "@/components/Experiment/CreateExperimentModal";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";

const ExperimentsGetStarted = (): React.ReactElement => {
  const { metrics, datasources, mutateDefinitions, project, projects } =
    useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const [dataSourceOpen, setDataSourceOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [importExperimentsOpen, setImportExperimentsOpen] = useState(false);
  const [designExperimentOpen, setDesignExperimentOpen] = useState(false);

  const router = useRouter();

  const [showAnalysisSteps, setShowAnalysisSteps] = useState(false);

  const { organization } = useUser();

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization?.id || "",
  );

  const hasDataSource = datasources.some(
    (d) => !d.projects?.includes(demoProjectId),
  );
  const hasMetrics = metrics.some(
    (m) => !m.id.match(/^met_sample/) && !m.projects?.includes(demoProjectId),
  );
  const currentStep = hasMetrics ? 3 : hasDataSource ? 2 : 1;

  const { projectId: demoDataSourceProjectId, demoExperimentId } =
    useDemoDataSourceProject();

  const { apiCall } = useAuth();

  const openSampleExperiment = async () => {
    if (demoDataSourceProjectId && demoExperimentId) {
      router.push(`/experiment/${demoExperimentId}`);
    } else {
      const res = await apiCall<{
        project: ProjectInterface;
        experimentId: string;
      }>("/demo-datasource-project", {
        method: "POST",
      });
      track("Create Sample Project", {
        source: "experiments-get-started",
      });
      await mutateDefinitions();
      if (res.experimentId) {
        router.push(`/experiment/${res.experimentId}`);
      } else {
        throw new Error("Could not create sample experiment");
      }
    }
  };

  return (
    <>
      <div>
        {dataSourceOpen && (
          <NewDataSourceForm
            source="get-started"
            onCancel={() => setDataSourceOpen(false)}
            onSuccess={async () => {
              await mutateDefinitions();
              setDataSourceOpen(false);
            }}
            showImportSampleData={false}
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
          />
        )}
        {importExperimentsOpen && (
          <ImportExperimentModal
            onClose={() => setImportExperimentsOpen(false)}
            source="get-started"
          />
        )}

        {designExperimentOpen && (
          <CreateExperimentModal
            onClose={() => setDesignExperimentOpen(false)}
            source={"get-started"}
          />
        )}

        {showAnalysisSteps ? (
          <div style={{ maxWidth: 900 }}>
            <div className="mb-2">
              <Link onClick={() => setShowAnalysisSteps(false)}>
                <FaArrowLeft /> Back to Options
              </Link>
            </div>
            <h1>Analyze an Existing Experiment</h1>
            <p>
              There are a few setup steps before you can analyze an existing
              experiment.
            </p>
            {hasFileConfig() && (
              <Callout status="info">
                It looks like you have a <code>config.yml</code> file. Use that
                to define data sources and metrics.{" "}
                <DocLink useRadix={false} docSection="config_yml">
                  View Documentation
                </DocLink>
              </Callout>
            )}
            <div className="row mb-3">
              <div className="col">
                <div className={`card gsbox`} style={{ overflow: "hidden" }}>
                  <GetStartedStep
                    current={currentStep === 1}
                    finished={hasDataSource}
                    image="/images/getstarted-step1.svg"
                    title="1. Connect to your data warehouse"
                    text={
                      <>
                        GrowthBook needs read access to where your experiment
                        and metric data lives. We support Snowflake, Redshift,
                        BigQuery, Databricks, Postgres, and more. If you
                        don&apos;t see yours,{" "}
                        <Link
                          href="https://www.growthbook.io/contact"
                          target="_blank"
                          rel="noreferrer"
                        >
                          let us know
                        </Link>{" "}
                        or{" "}
                        <Link
                          href="https://github.com/growthbook/growthbook/issues/new"
                          target="_blank"
                          rel="noreferrer"
                        >
                          open a GitHub issue
                        </Link>
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
                        ? datasources.some((datasource) =>
                            permissionsUtil.canUpdateDataSourceSettings(
                              datasource,
                            ),
                          )
                        : permissionsUtil.canViewCreateDataSourceModal(
                            project,
                            projects,
                          ))
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
                        Create your first metric definition. Use this as a goal
                        or guardrail when analyzing your experiment results.
                        With GrowthBook, you can build out an entire metric
                        library to represent all of the KPIs for your business
                      </p>
                    }
                    hideCTA={!envAllowsCreatingMetrics()}
                    cta="Add metric"
                    finishedCTA="View metrics"
                    permissionsError={
                      envAllowsCreatingMetrics() &&
                      !permissionsUtil.canCreateMetric({
                        projects: [project],
                      }) &&
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
                    finished={false}
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
                    finishedCTA="Import Experiment"
                    permissionsError={
                      !permissionsUtil.canViewExperimentModal(project, projects)
                    }
                    imageLeft={true}
                    onClick={() => {
                      setImportExperimentsOpen(true);
                      track("Import Experiment Form", {
                        source: "experiment-get-started",
                      });
                    }}
                  />
                </div>
              </div>
            </div>
            <Callout status="info">
              <Text as="div" align="center">
                <p>
                  Not ready to connect to your data warehouse? Explore a sample
                  experiment first to get a feel for the GrowthBook platform.
                </p>
                <Button
                  color="inherit"
                  variant="outline"
                  onClick={openSampleExperiment}
                >
                  View Sample Experiment
                </Button>
              </Text>
            </Callout>
          </div>
        ) : (
          <div>
            <h1>Experimentation Setup</h1>
            <p>
              There are three ways to get started with experimentation in
              GrowthBook.
            </p>

            <div className="row mb-3">
              <div className="col">
                <div className="appbox p-4" style={{ overflow: "hidden" }}>
                  <GetStartedStep
                    current={true}
                    finished={false}
                    noActiveBorder={true}
                    image="/images/sample-data-illustration.svg"
                    title="Explore a Sample Experiment"
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
                      !permissionsUtil.canViewExperimentModal(project, projects)
                    }
                    imageLeft={false}
                    onClick={openSampleExperiment}
                  />
                </div>
                <div
                  className={`appbox p-4 mb-3`}
                  style={{ overflow: "hidden" }}
                >
                  <GetStartedStep
                    current={true}
                    finished={false}
                    noActiveBorder={true}
                    image="/images/design-experiment-illustration.svg"
                    title="Design and Run a New Experiment"
                    text={
                      <p>
                        Design a new A/B test from scratch using either{" "}
                        <strong>Feature Flags</strong>, our{" "}
                        <strong>Visual Editor</strong>, or{" "}
                        <strong>URL Redirects</strong>. Then, integrate our SDK
                        into your application and start collecting and analyzing
                        data from your users.
                      </p>
                    }
                    hideCTA={false}
                    cta="Design New Experiment"
                    finishedCTA="Design New Experiment"
                    permissionsError={
                      !permissionsUtil.canViewExperimentModal(project, projects)
                    }
                    imageLeft={false}
                    onClick={() => {
                      setDesignExperimentOpen(true);
                    }}
                  />
                </div>
                <div className={`appbox p-4`} style={{ overflow: "hidden" }}>
                  <GetStartedStep
                    current={true}
                    finished={false}
                    noActiveBorder={true}
                    image="/images/analyze-results-illustration.svg"
                    title="Analyze an Existing Experiment"
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
                      !permissionsUtil.canViewExperimentModal(project, projects)
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
