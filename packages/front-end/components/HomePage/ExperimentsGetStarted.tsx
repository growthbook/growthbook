import React, { useState } from "react";
import { useRouter } from "next/router";
import { FaArrowLeft } from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { canCreateMetrics, hasFileConfig } from "@/services/env";
import usePermissions from "@/hooks/usePermissions";
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
import NewExperimentForm from "../Experiment/NewExperimentForm";
import Button from "../Button";

const ExperimentsGetStarted = (): React.ReactElement => {
  const { metrics, datasources, mutateDefinitions, project } = useDefinitions();

  const permissions = usePermissions();

  const [dataSourceOpen, setDataSourceOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [importExperimentsOpen, setImportExperimentsOpen] = useState(false);
  const [designExperimentOpen, setDesignExperimentOpen] = useState(false);

  const router = useRouter();

  const [showAnalysisSteps, setShowAnalysisSteps] = useState(false);

  const { organization } = useUser();

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization?.id || ""
  );

  const hasDataSource = datasources.some(
    (d) => !d.projects?.includes(demoProjectId)
  );
  const hasMetrics = metrics.some(
    (m) => !m.id.match(/^met_sample/) && !m.projects?.includes(demoProjectId)
  );
  const currentStep = hasMetrics ? 3 : hasDataSource ? 2 : 1;

  const {
    projectId: demoDataSourceProjectId,
    demoExperimentId,
  } = useDemoDataSourceProject();

  const { apiCall } = useAuth();

  const openSampleExperiment = async () => {
    if (demoDataSourceProjectId && demoExperimentId) {
      router.push(`/experiment/${demoExperimentId}`);
    } else {
      track("Create Sample Project", {
        source: "experiments-get-started",
      });
      const res = await apiCall<{
        project: ProjectInterface;
        experimentId: string;
      }>("/demo-datasource-project", {
        method: "POST",
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
            onSuccess={() => {
              mutateDefinitions();
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
          <NewExperimentForm
            onClose={() => setDesignExperimentOpen(false)}
            source={"get-started"}
            isNewExperiment={true}
          />
        )}

        {showAnalysisSteps ? (
          <div style={{ maxWidth: 900 }}>
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
            {hasFileConfig() && (
              <div className="alert alert-info">
                It looks like you have a <code>config.yml</code> file. Use that
                to define data sources and metrics.{" "}
                <DocLink docSection="config_yml">View Documentation</DocLink>
              </div>
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
                        ? permissions.check("editDatasourceSettings", project)
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
                        Create your first metric definition. Use this as a goal
                        or guardrail when analyzing your experiment results.
                        With GrowthBook, you can build out an entire metric
                        library to represent all of the KPIs for your business
                      </p>
                    }
                    hideCTA={!canCreateMetrics()}
                    cta="Add metric"
                    finishedCTA="View metrics"
                    permissionsError={
                      canCreateMetrics() &&
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
                      !permissions.check("createAnalyses", project)
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
            <div className="alert alert-info text-center">
              <p>
                Not ready to connect to your data warehouse? Explore a sample
                experiment first to get a feel for the GrowthBook platform.
              </p>
              <Button color="outline-primary" onClick={openSampleExperiment}>
                View Sample Experiment
              </Button>
            </div>
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
                <div
                  className={`card gsbox mb-3`}
                  style={{ overflow: "hidden" }}
                >
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
                      !permissions.check("createAnalyses", project)
                    }
                    imageLeft={false}
                    onClick={openSampleExperiment}
                  />
                </div>
                <div
                  className={`card gsbox mb-3`}
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
                    imageLeft={false}
                    onClick={() => {
                      setDesignExperimentOpen(true);
                    }}
                  />
                </div>
                <div className={`card gsbox`} style={{ overflow: "hidden" }}>
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
