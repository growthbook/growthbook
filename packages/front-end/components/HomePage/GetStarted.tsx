import React from "react";
import Link from "next/link";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FiArrowRight } from "react-icons/fi";
import { useState } from "react";
import DataSourceForm from "../Settings/DataSourceForm";
import { useRouter } from "next/router";
import MetricForm from "../Metrics/MetricForm";
import { FaCheck, FaChevronRight, FaDesktop } from "react-icons/fa";
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
import ImportExperimentModal from "../Experiment/ImportExperimentModal";

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
  const allowImport = !(hasMetrics || hasExperiments) && !hasFileConfig();

  return (
    <>
      <div className="container-fluid mt-3 pagecontents getstarted">
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
              type: "bigquery",
              name: "My Datasource",
              params: {
                clientEmail: "",
                privateKey: "",
                projectId: "",
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
          <ImportExperimentModal
            onClose={() => setExperimentsOpen(false)}
            source="get-started"
          />
        )}
        <div className="row">
          <div className="col-12 mb-3">
            <h1>Let&apos;s get started!</h1>
            <p className="mb-0">
              Follow the steps below to start using GrowthBook
            </p>
          </div>
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
                  <div
                    className={`card-body extra-padding ${
                      currentStep === 1 ? "active-step" : ""
                    } ${hasDataSource ? "step-done" : ""}`}
                  >
                    <div className="row">
                      <div className="col-4 d-none d-sm-block">
                        <img
                          className=""
                          style={{ width: "100%", maxWidth: "200px" }}
                          src="/images/getstarted-step1.svg"
                          alt=""
                        />
                      </div>
                      <div className="col-12 col-sm-8">
                        <div className="card-title">
                          <h3 className="">
                            1. Connect to your data source(s)
                            <span className="h3 mb-0 ml-3 complete checkmark d-none">
                              <FaCheck /> Completed
                            </span>
                          </h3>
                        </div>
                        <p className="card-text">
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
                        </p>
                        <a
                          className={clsx(`action-link mr-3`, {
                            "btn btn-outline-primary": hasDataSource,
                            "btn btn-primary":
                              !hasDataSource && currentStep === 1,
                            "non-active-step":
                              !hasDataSource && currentStep > 1,
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
                          {hasDataSource
                            ? "View data sources"
                            : "Add data source"}{" "}
                          <FiArrowRight />
                        </a>
                      </div>
                    </div>
                  </div>
                  <div
                    className={`card-body border-top extra-padding ${
                      currentStep === 2 ? " active-step" : ""
                    } ${hasMetrics ? "step-done" : ""}`}
                  >
                    <div className="row">
                      <div className="col-12 col-sm-8">
                        <div className="card-title">
                          <h3 className="">
                            2. Define metrics
                            <span className="h3 mb-0 ml-3 complete checkmark d-none">
                              <FaCheck /> Completed
                            </span>
                          </h3>
                        </div>
                        <p className="card-text">
                          Create a library of metrics to experiment against. You
                          can always add more at any time, and even add them
                          retroactively to past experiments.
                        </p>
                        <a
                          className={clsx(`action-link`, {
                            "btn btn-outline-primary": hasMetrics,
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
                      <div className="col-4 d-none d-sm-block">
                        <img
                          className=""
                          style={{ width: "100%", maxWidth: "200px" }}
                          src="/images/getstarted-step2.svg"
                          alt=""
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    className={`card-body border-top extra-padding ${
                      currentStep === 3 ? " active-step" : ""
                    } ${hasExperiments ? "step-done" : ""}`}
                  >
                    <div className="row">
                      <div className="col-4 d-none d-sm-block">
                        <img
                          className=""
                          style={{ width: "100%", maxWidth: "200px" }}
                          src="/images/getstarted-step3.svg"
                          alt=""
                        />
                      </div>
                      <div className="col-12 col-sm-8">
                        <div className="card-title">
                          <h3 className="">
                            3. Create an experiment
                            <span className="h3 mb-0 ml-3 complete checkmark d-none">
                              <FaCheck /> Completed
                            </span>
                          </h3>
                        </div>
                        <p className="card-text">
                          Create a draft experiment, implement using our Client
                          Libraries or Visual Editor, start it, and analyze
                          results.
                        </p>
                        <a
                          className={`action-link ${
                            hasExperiments
                              ? "btn btn-outline-primary"
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
                        <p
                          className="card-text"
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
                        </p>
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
              <div className="card gsbox mb-3">
                <div className="card-body">
                  <div className="card-title">
                    <h4 className="">Documentation, help &amp; support</h4>
                  </div>
                  <div className="card-text">
                    <div className="d-flex flex-row">
                      <div className="p-1 w-100">
                        Read our{" "}
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://docs.growthbook.io/app"
                        >
                          <strong>User Guide</strong>
                        </a>
                      </div>
                    </div>
                    <div className="d-flex flex-row">
                      <div className="p-1 w-100">
                        View docs for our{" "}
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://docs.growthbook.io/lib"
                        >
                          <strong>Client Libraries</strong>
                        </a>
                      </div>
                    </div>
                    <div className="d-flex flex-row">
                      <div className="p-1 w-100">
                        Chat with us on{" "}
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg"
                        >
                          <strong>Slack</strong>
                        </a>
                      </div>
                    </div>
                    <div className="d-flex flex-row">
                      <div className="p-1 w-100">
                        Open an issue on{" "}
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://github.com/growthbook/growthbook/issues"
                        >
                          <strong>GitHub</strong>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card-body border-top">
                  <div className="card-title">
                    <h4 className="">Invite team</h4>
                  </div>
                  <p className="card-text">Add teammates to your account</p>
                  <span className="action-link non-active-step">
                    <Link href="/settings/team">
                      <a className="boxlink">
                        Invite team <FiArrowRight />
                      </a>
                    </Link>
                  </span>
                </div>

                {!visualEditorEnabled && (
                  <div className="card-body border-top">
                    <div className="card-title">
                      <h4 className="">Enable the Visual Editor</h4>
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
                      <Link href="/settings">
                        <a className="boxlink">
                          Go to settings <FiArrowRight />
                        </a>
                      </Link>
                    </span>
                  </div>
                )}
                <div className="card-body border-top">
                  <div className="card-title">
                    <h4 className="">Have questions?</h4>
                  </div>
                  Talk to us in our{" "}
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg"
                  >
                    <strong>Slack channel</strong>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GetStarted;
