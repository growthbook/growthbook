import React from "react";
import useApi from "../../hooks/useApi";
import Link from "next/link";
import LoadingOverlay from "../../components/LoadingOverlay";
//import { BiTimeFive } from "react-icons/bi";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MdChevronRight } from "react-icons/md";
import { FiArrowRight } from "react-icons/fi";

const GetStarted = (): React.ReactElement => {
  const { data } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");

  const { metrics, datasources } = useDefinitions();

  if (!data) {
    return <LoadingOverlay />;
  }

  const hasDataSource = datasources.length > 0;
  const hasMetrics = metrics.length > 0;
  const hasExperiments = data?.experiments?.length > 0;
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
        <div className="row">
          <div className="col-12 col-lg-8">
            <div className="row mb-3">
              <div className="col-auto">
                <h1>Let&apos;s get started!</h1>
                <p>Follow the steps below to start using Growth Book</p>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col">
                <Link href="/settings/datasources">
                  <a className="boxlink">
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
                          Growth Book needs read access to where your experiment
                          and event data lives. We support most data sources,
                          even manually inputted data. (if you do want to use
                          manual data, you can skip this step)
                        </p>
                        <a
                          className={`action-link ${
                            hasDataSource
                              ? "btn btn-success"
                              : currentStep === 1
                              ? "btn btn-primary"
                              : "non-active-step"
                          }`}
                        >
                          {hasDataSource ? (
                            "Done"
                          ) : (
                            <>
                              Add data source <FiArrowRight />
                            </>
                          )}
                        </a>
                      </div>
                    </div>
                  </a>
                </Link>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col">
                <Link href="/metrics">
                  <a className="boxlink">
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
                          Create a library of metrics from which you can measure
                          your experiments against. You can always add more at
                          any time, and even add them retroactively to past
                          experiments.
                        </p>
                        <a
                          className={`action-link ${
                            hasMetrics
                              ? "btn btn-success"
                              : currentStep === 2
                              ? "btn btn-primary"
                              : "non-active-step"
                          }`}
                        >
                          {hasMetrics ? (
                            "Done"
                          ) : (
                            <>
                              Add metrics <FiArrowRight />
                            </>
                          )}
                        </a>
                      </div>
                    </div>
                  </a>
                </Link>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col">
                <Link href="/ideas">
                  <a className="boxlink">
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
                          Start a draft experiment, add metrics, and convert to
                          a running experiment.
                        </p>

                        <a
                          className={`action-link ${
                            hasExperiments
                              ? "btn btn-success"
                              : currentStep === 3
                              ? "btn btn-primary"
                              : "non-active-step"
                          }`}
                        >
                          {hasExperiments ? (
                            "Done"
                          ) : (
                            <>
                              Create experiment <FiArrowRight />
                            </>
                          )}
                        </a>
                      </div>
                    </div>
                  </a>
                </Link>
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
                        Watch a quick overview video of how Growth Book works.
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
                          Learn about connecting to data sources and defining
                          metrics
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
                          Learn about ways to integrate Growth Book with your
                          app
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
                          Contact us for help on our slack channel
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
                          Open an issue on github
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card gsbox mb-3">
                <div className="card-body">
                  <h3>Sample data</h3>
                  <p>
                    If you&apos;re not ready to connect up your data, you can
                    still explore the features of Growth Book with some sample
                    data.
                  </p>
                  <a className="btn btn-primary">Load sample data</a>
                </div>
              </div>

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
                      <a className="action-link non-active-step">
                        Invite team <FiArrowRight />
                      </a>
                    </div>
                  </div>
                </a>
              </Link>
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
