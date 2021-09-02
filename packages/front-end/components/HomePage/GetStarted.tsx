import React from "react";
import Link from "next/link";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MdChevronRight } from "react-icons/md";
import { FiArrowRight } from "react-icons/fi";
import { useState } from "react";
import DataSourceForm from "../Settings/DataSourceForm";
import { useRouter } from "next/router";
import MetricForm from "../Metrics/MetricForm";
import NewExperimentForm from "../Experiment/NewExperimentForm";
import { FaChevronRight, FaDatabase, FaDesktop } from "react-icons/fa";
import Button from "../Button";
import Tooltip from "../Tooltip";
import { useAuth } from "../../services/auth";
import { HiCursorClick } from "react-icons/hi";
import { useContext } from "react";
import { UserContext } from "../ProtectedPage";
import track from "../../services/track";
import { hasFileConfig } from "../../services/env";
import clsx from "clsx";
import EditDataSourceSettingsForm from "../Settings/EditDataSourceSettingsForm";

const GetStarted = ({
  experiments,
  mutate,
}: {
  experiments: ExperimentInterfaceStringDates[];
  mutate: () => void;
}): React.ReactElement => {
  const { metrics, datasources, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();

  const {
    settings: { visualEditorEnabled },
  } = useContext(UserContext);

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

  return (
    <>
      <div className="container-fluid mt-3 pagecontents getstarted">
        {dataSourceQueriesOpen &&
          datasources?.[0] &&
          datasources[0].type !== "google_analytics" && (
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
              type: "redshift",
              name: "My Datasource",
              params: {
                port: 5439,
                database: "",
                host: "",
                password: "",
                user: "",
                defaultSchema: "",
                ssl: "false",
              },
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
          <NewExperimentForm
            onClose={() => setExperimentsOpen(false)}
            source="get-started"
          />
        )}
        <div className="row">
          <div className="col-12 col-lg-8">
            <div className="row mb-3">
              <div className="col-auto">
                <h1>Let&apos;s get started!</h1>
                <p className="mb-0">
                  Follow the steps below to start using GrowthBook
                </p>
              </div>
            </div>
            {hasFileConfig() && (
              <div className="alert alert-info">
                It looks like you have a <code>config.yml</code> file. Use that
                to define data sources and metrics.{" "}
                <a href="https://docs.growthbook.io/self-host/config#configyml">
                  View Documentation
                </a>
              </div>
            )}
            {!(hasMetrics || hasExperiments) && !hasFileConfig() && (
              <div className="alert alert-info mb-3">
                <div className="d-flex align-items-center">
                  <strong className="mr-2">Just here to explore?</strong>
                  <div style={{ flex: 1 }}>
                    Quick start with some{" "}
                    <Tooltip
                      text="Includes a sample experiment with results. Don't worry, it's easy to remove later."
                      style={{ borderBottom: "1px dotted #666" }}
                    >
                      sample data
                    </Tooltip>
                  </div>
                  {hasSampleExperiment ? (
                    <Link href={`/experiment/${hasSampleExperiment.id}`}>
                      <a className="btn btn-sm btn-success ml-3">
                        View Sample Experiment <FaChevronRight />
                      </a>
                    </Link>
                  ) : (
                    <Button
                      color="primary"
                      className="btn-sm ml-3"
                      onClick={async () => {
                        const res = await apiCall<{
                          experiment: string;
                        }>(`/organization/sample-data`, {
                          method: "POST",
                        });
                        await mutateDefinitions();
                        await mutate();
                        track("Add Sample Data");
                        await router.push("/experiment/" + res.experiment);
                      }}
                    >
                      <FaDatabase /> Import Sample Data
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="row mb-3">
              <div className="col">
                <div
                  className={`card gsbox ${
                    currentStep === 1 ? "border-primary active-step" : ""
                  } ${hasDataSource ? "step-done" : ""}`}
                >
                  <div className="card-body">
                    <div className="card-title">
                      <h3 className="text-blue">
                        1. Connect to your data source(s)
                      </h3>
                    </div>
                    <p className="card-text">
                      <img
                        className="float-right mx-4"
                        src="/images/database.png"
                      />
                      GrowthBook needs read access to where your experiment and
                      metric data lives. We support Mixpanel, Snowflake,
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
                    </p>
                    <a
                      className={clsx(`action-link mr-3`, {
                        "btn btn-success": hasDataSource,
                        "btn btn-primary": !hasDataSource && currentStep === 1,
                        "non-active-step": !hasDataSource && currentStep > 1,
                        "d-none": !hasDataSource && hasFileConfig(),
                      })}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (hasDataSource) {
                          router.push("/datasources");
                        } else {
                          setDataSourceOpen(true);
                        }
                      }}
                    >
                      {hasDataSource ? "View data sources" : "Add data source"}{" "}
                      <FiArrowRight />
                    </a>
                  </div>
                </div>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col">
                <div
                  className={`card gsbox ${
                    currentStep === 2 ? "border-primary active-step" : ""
                  } ${hasMetrics ? "step-done" : ""}`}
                >
                  <div className="card-body">
                    <div className="card-title">
                      <h3 className="text-blue">2. Define metrics</h3>
                    </div>
                    <p className="card-text">
                      <img
                        className="float-right mx-4"
                        src="/images/metrics.png"
                      />
                      Create a library of metrics to experiment against. You can
                      always add more at any time, and even add them
                      retroactively to past experiments.
                    </p>
                    <a
                      className={clsx(`action-link`, {
                        "btn btn-success": hasMetrics,
                        "btn btn-primary": !hasMetrics && currentStep === 2,
                        "non-active-step": !hasMetrics && currentStep !== 2,
                        "d-none": !hasMetrics && hasFileConfig(),
                      })}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (!hasMetrics) {
                          setMetricsOpen(true);
                        } else {
                          router.push("/metrics");
                        }
                      }}
                    >
                      {hasMetrics ? "View metrics" : "Add metric"}{" "}
                      <FiArrowRight />
                    </a>
                  </div>
                </div>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col">
                <div
                  className={`card gsbox ${
                    currentStep === 3 ? "border-primary active-step" : ""
                  } ${hasExperiments ? "step-done" : ""}`}
                >
                  <div className="card-body">
                    <div className="card-title">
                      <h3 className="text-blue">3. Create an experiment</h3>
                    </div>
                    <p className="card-text">
                      <img
                        className="float-right mx-4"
                        src="/images/beaker.png"
                      />
                      Create a draft experiment, implement using our Client
                      Libraries or Visual Editor, start it, and analyze results.
                    </p>
                    <a
                      className={`action-link ${
                        hasExperiments
                          ? "btn btn-success"
                          : currentStep === 3
                          ? "btn btn-primary"
                          : "non-active-step"
                      }`}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (!hasExperiments) {
                          setExperimentsOpen(true);
                        } else {
                          router.push("/experiments");
                        }
                      }}
                    >
                      {hasExperiments
                        ? "View experiments"
                        : "Create experiment"}{" "}
                      <FiArrowRight />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col-12 col-lg-4">
            <div>
              <h3>More...</h3>
              {/* <div className="card gsbox mb-4">
                <div className="card-body">
                  <div className="d-flex flex-row">
                    <div className="p-2">
                      <img src="/images/play.png" className="mr-2" />
                    </div>
                    <div className="">
                      <p className="card-text font-smaller">
                        <span className="text-muted">
                          <BiTimeFive /> 2 minutes
                        </span>
                        <br />
                        Watch a quick overview video of how GrowthBook works.
                      </p>
                    </div>
                  </div>
                </div>
              </div> */}
              <div className="card gsbox mb-3">
                <div className="card-body">
                  <div className="card-title">
                    <h3 className="">Documentation, help &amp; support</h3>
                  </div>
                  <div className="card-text">
                    <div className="d-flex flex-row">
                      <div className="p-1">
                        <MdChevronRight />
                      </div>
                      <div className="p-1 w-100">
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://docs.growthbook.io/app"
                        >
                          Read our <strong>User Guide</strong>
                        </a>
                      </div>
                    </div>
                    <div className="d-flex flex-row">
                      <div className="p-1">
                        <MdChevronRight />
                      </div>
                      <div className="p-1 w-100">
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://docs.growthbook.io/lib"
                        >
                          View docs for our <strong>Client Libraries</strong>
                        </a>
                      </div>
                    </div>
                    <div className="d-flex flex-row">
                      <div className="p-1">
                        <MdChevronRight />
                      </div>
                      <div className="p-1 w-100">
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg"
                        >
                          Chat with us on <strong>Slack</strong>
                        </a>
                      </div>
                    </div>
                    <div className="d-flex flex-row">
                      <div className="p-1">
                        <MdChevronRight />
                      </div>
                      <div className="p-1 w-100">
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://github.com/growthbook/growthbook/issues"
                        >
                          Open an issue on <strong>GitHub</strong>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* <div className="card gsbox mb-3">
                <div className="card-body">
                  <h3>Sample data</h3>
                  <p>
                    If you&apos;re not ready to connect up your data, you can
                    still explore the features of GrowthBook with some sample
                    data.
                  </p>
                  <a className="btn btn-primary">Load sample data</a>
                </div>
              </div> */}

              <Link href="/settings/team">
                <a className="boxlink">
                  <div className={`card gsbox mb-3`}>
                    <div className="card-body">
                      <div className="card-title">
                        <h3 className="text-blue">Invite team</h3>
                      </div>
                      <p className="card-text">
                        <img
                          className="float-right mx-4"
                          src="/images/team.png"
                        />
                        Add teammates to your account
                      </p>
                      <span className="action-link non-active-step">
                        Invite team <FiArrowRight />
                      </span>
                    </div>
                  </div>
                </a>
              </Link>
              {!visualEditorEnabled && (
                <Link href="/settings">
                  <a className="boxlink">
                    <div className={`card gsbox mb-3`}>
                      <div className="card-body">
                        <div className="card-title">
                          <h3 className="text-blue">
                            Enable the Visual Editor
                          </h3>
                        </div>
                        <p className="card-text">
                          <div className="float-right mx-4 position-relative">
                            <FaDesktop
                              style={{
                                fontSize: "3.4em",
                                color: "#71B1E9",
                                stroke: "#fff",
                                strokeWidth: 3,
                              }}
                            />
                            <HiCursorClick
                              style={{
                                fontSize: "2.4em",
                                position: "absolute",
                                bottom: 3,
                                right: -3,
                                stroke: "#fff",
                                color: "#4A8AC2",
                                strokeWidth: "1px",
                              }}
                            />
                          </div>
                          Let your non-technical teammates implement A/B tests
                          without writing code.
                        </p>
                        <span className="action-link non-active-step">
                          Go to settings <FiArrowRight />
                        </span>
                      </div>
                    </div>
                  </a>
                </Link>
              )}
              <p className="text-center">
                Need more help? Ask questions in our{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href="https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg"
                >
                  Slack channel
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GetStarted;
