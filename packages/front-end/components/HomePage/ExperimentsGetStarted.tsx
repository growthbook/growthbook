import React from "react";
import Link from "next/link";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useState } from "react";
import DataSourceForm from "../Settings/DataSourceForm";
import { useRouter } from "next/router";
import MetricForm from "../Metrics/MetricForm";
import { FaChevronRight } from "react-icons/fa";
import Button from "../Button";
import Tooltip from "../Tooltip";
import { useAuth } from "../../services/auth";
import track from "../../services/track";
import { hasFileConfig } from "../../services/env";
import EditDataSourceSettingsForm from "../Settings/EditDataSourceSettingsForm";
import ImportExperimentModal from "../Experiment/ImportExperimentModal";
import GetStartedStep from "./GetStartedStep";
import DocumentationLinksSidebar from "./DocumentationLinksSidebar";
import useOrgSettings from "../../hooks/useOrgSettings";

const ExperimentsGetStarted = ({
  experiments,
  mutate,
}: {
  experiments: ExperimentInterfaceStringDates[];
  mutate: () => void;
}): React.ReactElement => {
  const { metrics, datasources, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();

  const { visualEditorEnabled } = useOrgSettings();

  const [dataSourceOpen, setDataSourceOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
  const [dataSourceQueriesOpen, setDataSourceQueriesOpen] = useState(false);
  const router = useRouter();

  const hasSampleExperiment = experiments.filter((m) =>
    m.id.match(/^exp_sample/)
  )[0];

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
  const allowImport = !(hasMetrics || hasExperiments) && !hasFileConfig();

  return (
    <>
      <div>
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
            source="get-started"
          />
        )}
        <div className="row">
          <div className="col-12 col-lg-8">
            {hasFileConfig() && (
              <div className="alert alert-info">
                It looks like you have a <code>config.yml</code> file. Use that
                to define data sources and metrics.{" "}
                <a href="https://docs.growthbook.io/self-host/config#configyml">
                  View Documentation
                </a>
              </div>
            )}
            <div className="row mb-3">
              <div className="col">
                <div className={`card gsbox`} style={{ overflow: "hidden" }}>
                  <GetStartedStep
                    current={currentStep === 1}
                    finished={hasDataSource}
                    image="/images/getstarted-step1.svg"
                    title="1. Connect to your data source(s)"
                    text={
                      <>
                        GrowthBook needs read access to where your experiment
                        and metric data lives. We support Mixpanel, Snowflake,
                        Redshift, BigQuery, Google Analytics, and more. If you
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
                    title="2. Define metrics"
                    text="Create a library of metrics to experiment against. You
                    can always add more at any time, and even add them
                    retroactively to past experiments."
                    hideCTA={hasFileConfig()}
                    cta="Add metric"
                    finishedCTA="View metrics"
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
                    title="3. Add an Experiment"
                    text="Import an existing experiment from your data source or
                    create a new draft from scratch."
                    hideCTA={false}
                    cta="Add experiment"
                    finishedCTA="View experiments"
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
            <div>
              {!allowImport ? (
                <div className="card gsbox secondary-box mb-4">
                  <div className="card-body">
                    <div className="d-flex flex-row">
                      <div className="">
                        <h4 style={{ paddingRight: "100px" }}>
                          Want to understand how it works?
                        </h4>
                        <p
                          className="card-text"
                          style={{ paddingRight: "105px" }}
                        >
                          Watch a quick{" "}
                          <a
                            href="https://youtu.be/0-gugX_dICM"
                            target="_blank"
                            rel="noreferrer"
                          >
                            video&nbsp;tour
                          </a>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card gsbox secondary-box mb-4">
                  <div className="card-body">
                    <div className="d-flex flex-row">
                      <div className="">
                        <h4>Just here to explore?</h4>
                        <div
                          className="card-text mb-3"
                          style={{ paddingRight: "105px" }}
                        >
                          Add some{" "}
                          <Tooltip
                            text="Includes a sample experiment with results. Don't worry, it's easy to remove later."
                            style={{ borderBottom: "1px dotted #666" }}
                          >
                            sample data
                          </Tooltip>
                          , or watch a{" "}
                          <a
                            href="https://youtu.be/0-gugX_dICM"
                            target="_blank"
                            rel="noreferrer"
                          >
                            video&nbsp;tour
                          </a>
                        </div>
                        {hasSampleExperiment ? (
                          <Link href={`/experiment/${hasSampleExperiment.id}`}>
                            <a className="btn btn-sm btn-success ml-3">
                              View Sample Experiment <FaChevronRight />
                            </a>
                          </Link>
                        ) : (
                          <Button
                            color="outline-primary"
                            className=""
                            onClick={async () => {
                              const res = await apiCall<{
                                experiment: string;
                              }>(`/organization/sample-data`, {
                                method: "POST",
                              });
                              await mutateDefinitions();
                              await mutate();
                              track("Add Sample Data");
                              await router.push(
                                "/experiment/" + res.experiment
                              );
                            }}
                          >
                            Import Sample Data
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <DocumentationLinksSidebar
                showVisualEditor={!visualEditorEnabled}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ExperimentsGetStarted;
