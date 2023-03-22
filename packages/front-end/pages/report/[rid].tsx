import { useRouter } from "next/router";
import { ExperimentReportArgs, ReportInterface } from "back-end/types/report";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import LoadingOverlay from "@/components/LoadingOverlay";
import Markdown from "@/components/Markdown/Markdown";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import { ago, datetime, getValidDate, date } from "@/services/dates";
import DateResults from "@/components/Experiment/DateResults";
import BreakDownResults from "@/components/Experiment/BreakDownResults";
import CompactResults from "@/components/Experiment/CompactResults";
import GuardrailResults from "@/components/Experiment/GuardrailResult";
import { useAuth } from "@/services/auth";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import { GBCircleArrowLeft, GBCuped, GBEdit } from "@/components/Icons";
import ConfigureReport from "@/components/Report/ConfigureReport";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import Toggle from "@/components/Forms/Toggle";
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import VariationIdWarning from "@/components/Experiment/VariationIdWarning";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import PValueGuardrailResults from "@/components/Experiment/PValueGuardrailResults";
import useOrgSettings from "@/hooks/useOrgSettings";

export default function ReportPage() {
  const router = useRouter();
  const { rid } = router.query;

  const [editModalOpen, setEditModalOpen] = useState(false);

  const { getMetricById, getDatasourceById } = useDefinitions();
  const { data, error, mutate } = useApi<{ report: ReportInterface }>(
    `/report/${rid}`
  );
  const { permissions, userId, getUserDisplay, hasCommercialFeature } = useUser();
  const [active, setActive] = useState<string | null>("Results");
  const [refreshError, setRefreshError] = useState("");

  const { apiCall } = useAuth();
  const settings = useOrgSettings();

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );

  const form = useForm({
    defaultValues: {
      title: data?.report.title || "",
      description: data?.report.description || "",
      status: data?.report?.status ? data.report.status : "private",
    },
  });

  useEffect(() => {
    if (data?.report) {
      const newVal = {
        ...form.getValues(),
        title: data?.report.title,
        description: data?.report.description,
        status: data?.report?.status ? data.report.status : "private",
      };
      form.reset(newVal);
    }
  }, [data?.report]);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const report = data.report;
  if (!report) {
    return null;
  }

  const variations = report.args.variations;

  const datasource = getDatasourceById(report.args.datasource);

  const status = getQueryStatus(report.queries || [], report.error);

  const hasData = report.results?.dimensions?.[0]?.variations?.length > 0;

  const phaseAgeMinutes =
    (Date.now() - getValidDate(report.args.startDate).getTime()) / (1000 * 60);

  const statsEngine =
    data?.report?.args?.statsEngine || settings?.statsEngine || "bayesian";
  const regressionAdjustmentAvailable = hasRegressionAdjustmentFeature && statsEngine === "frequentist";
  const regressionAdjustmentEnabled =
    hasRegressionAdjustmentFeature && regressionAdjustmentAvailable && !!report.args.regressionAdjustmentEnabled;

  return (
    <div className="container-fluid pagecontents experiment-details">
      {editModalOpen && (
        <Modal
          open={true}
          submit={form.handleSubmit(async (value) => {
            await apiCall(`/report/${report.id}`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            mutate();
          })}
          close={() => {
            setEditModalOpen(false);
          }}
          header="Edit Report"
          overflowAuto={false}
        >
          <Field label="Title" {...form.register("title")} />
          <div className="form-group">
            <label>Description</label>
            <MarkdownInput
              setValue={(value) => {
                form.setValue("description", value);
              }}
              value={form.watch("description")}
            />
          </div>
          Publish:{" "}
          <Toggle
            id="toggle-status"
            value={form.watch("status") === "published"}
            label="published"
            setValue={(value) => {
              const newStatus = value ? "published" : "private";
              form.setValue("status", newStatus);
            }}
          />
          <Tooltip
            body={
              "A published report will be visible to other users of your team"
            }
          />
        </Modal>
      )}
      <div className="mb-3">
        {report?.experimentId && (
          <Link href={`/experiment/${report.experimentId}#results`}>
            <a>
              <GBCircleArrowLeft /> Go to experiment results
            </a>
          </Link>
        )}
        {permissions.check("createAnalyses", "") &&
          (userId === report?.userId || !report?.userId) && (
            <DeleteButton
              displayName="Custom Report"
              link={false}
              className="float-right btn-sm"
              text="delete"
              useIcon={true}
              onClick={async () => {
                await apiCall<{ status: number; message?: string }>(
                  `/report/${report.id}`,
                  {
                    method: "DELETE",
                  }
                );
                router.push(`/experiment/${report.experimentId}#results`);
              }}
            />
          )}
        <h1 className="mb-0 mt-2">
          {report.title}{" "}
          {permissions.check("createAnalyses", "") &&
            (userId === report?.userId || !report?.userId) && (
              <a
                className="ml-2 cursor-pointer"
                onClick={() => setEditModalOpen(true)}
              >
                <GBEdit />
              </a>
            )}
        </h1>
        <div className="mb-1">
          <small className="text-muted">
            Created {report?.userId && <>by {getUserDisplay(report.userId)} </>}{" "}
            on {date(report.dateCreated)} -{" "}
            <span className="badge badge-secondary">
              {form.watch("status") === "published" ? "Published" : "Private"}
            </span>
          </small>
        </div>
        {report.description && (
          <div className="mb-3">
            <Markdown>{report.description}</Markdown>
          </div>
        )}
      </div>

      <ControlledTabs
        active={active}
        setActive={setActive}
        newStyle={true}
        navClassName={permissions.check("createAnalyses", "") ? "" : "d-none"}
      >
        <Tab key="results" anchor="results" display="Results" padding={false}>
          <div className="p-3">
            <div className="row align-items-center mb-2">
              <div className="col">
                <h2>Results</h2>
              </div>
              <div className="col-auto">
                {report.runStarted && status !== "running" ? (
                  <div
                    className="text-muted text-right"
                    style={{ width: 100, fontSize: "0.8em" }}
                    title={datetime(report.runStarted)}
                  >
                    <div
                      className="font-weight-bold"
                      style={{ lineHeight: 1.5 }}
                    >
                      updated
                    </div>
                    <div className="d-inline-block" style={{ lineHeight: 1 }}>
                      {ago(report.runStarted)}
                    </div>
                  </div>
                ) : (
                  ""
                )}
              </div>
              <div className="col-auto">
                {permissions.check("runQueries", "") && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await apiCall(`/report/${report.id}/refresh`, {
                          method: "POST",
                        });
                        mutate();
                        setRefreshError("");
                      } catch (e) {
                        setRefreshError(e.message);
                      }
                    }}
                  >
                    <RunQueriesButton
                      icon="refresh"
                      cta="Refresh Data"
                      initialStatus={status}
                      statusEndpoint={`/report/${report.id}/status`}
                      cancelEndpoint={`/report/${report.id}/cancel`}
                      color="outline-primary"
                      onReady={() => {
                        mutate();
                      }}
                    />
                  </form>
                )}
              </div>
              <div className="col-auto">
                <ResultMoreMenu
                  id={report.id}
                  hasData={hasData}
                  forceRefresh={async () => {
                    try {
                      await apiCall(`/report/${report.id}/refresh?force=true`, {
                        method: "POST",
                      });
                      mutate();
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
                  configure={
                    permissions.check("createAnalyses", "")
                      ? () => setActive("Configuration")
                      : null
                  }
                  editMetrics={
                    permissions.check("createAnalyses", "")
                      ? () => setActive("Configuration")
                      : null
                  }
                  generateReport={false}
                  hasUserQuery={false}
                  notebookUrl={`/report/${report.id}/notebook`}
                  notebookFilename={report.title}
                  queries={report.queries}
                  queryError={report.error}
                  results={report.results.dimensions}
                  variations={variations}
                  metrics={report.args.metrics}
                  trackingKey={report.title}
                />
              </div>
            </div>
            {refreshError && (
              <div className="alert alert-danger">
                <strong>Error refreshing data: </strong> {refreshError}
              </div>
            )}
            {report.args.metrics.length === 0 && (
              <div className="alert alert-info">
                Add at least 1 metric to view results.
              </div>
            )}
            {!hasData &&
              !report.results.unknownVariations?.length &&
              status !== "running" &&
              report.args.metrics.length > 0 && (
                <div className="alert alert-info">
                  No data yet.{" "}
                  {report.results &&
                    phaseAgeMinutes >= 120 &&
                    "Make sure your experiment is tracking properly."}
                  {report.results &&
                    phaseAgeMinutes < 120 &&
                    "It was just started " +
                      ago(report.args.startDate) +
                      ". Give it a little longer and click the 'Refresh' button to check again."}
                  {!report.results &&
                    permissions.check("runQueries", "") &&
                    `Click the "Refresh" button.`}
                </div>
              )}
          </div>
          {hasData &&
            report.args.dimension &&
            (report.args.dimension === "pre:date" ? (
              <DateResults
                metrics={report.args.metrics}
                guardrails={report.args.guardrails}
                results={report.results.dimensions}
                variations={variations}
              />
            ) : (
              <BreakDownResults
                isLatestPhase={true}
                metrics={report.args.metrics}
                metricOverrides={report.args.metricOverrides}
                reportDate={report.dateCreated}
                results={report.results?.dimensions || []}
                status={"stopped"}
                startDate={getValidDate(report.args.startDate).toISOString()}
                dimensionId={report.args.dimension}
                activationMetric={report.args.activationMetric}
                guardrails={report.args.guardrails}
                variations={variations}
                key={report.args.dimension}
                statsEngine={report.args.statsEngine}
                regressionAdjustmentEnabled={regressionAdjustmentEnabled}
                metricRegressionAdjustmentStatuses={
                  report.args.metricRegressionAdjustmentStatuses
                }
              />
            ))}
          {report.results && !report.args.dimension && (
            <VariationIdWarning
              unknownVariations={report.results?.unknownVariations || []}
              isUpdating={status === "running"}
              setVariationIds={async (ids) => {
                const args: ExperimentReportArgs = {
                  ...report.args,
                  variations: report.args.variations.map((v, i) => {
                    return {
                      ...v,
                      id: ids[i] ?? v.id,
                    };
                  }),
                };

                await apiCall(`/report/${report.id}`, {
                  method: "PUT",
                  body: JSON.stringify({
                    args,
                  }),
                });
                mutate();
              }}
              variations={variations}
              results={report.results?.dimensions?.[0]}
            />
          )}
          {hasData && !report.args.dimension && (
            <>
              <CompactResults
                id={report.id}
                isLatestPhase={true}
                metrics={report.args.metrics}
                metricOverrides={report.args.metricOverrides}
                reportDate={report.dateCreated}
                results={report.results?.dimensions?.[0]}
                status={"stopped"}
                startDate={getValidDate(report.args.startDate).toISOString()}
                multipleExposures={report.results?.multipleExposures || 0}
                variations={variations}
                statsEngine={report.args.statsEngine}
                regressionAdjustmentEnabled={regressionAdjustmentEnabled}
                metricRegressionAdjustmentStatuses={
                  report.args.metricRegressionAdjustmentStatuses
                }
              />
              {report.args.guardrails?.length > 0 && (
                <div className="mt-1 px-3">
                  <h3 className="mb-3">Guardrails</h3>
                  <div className="row">
                    {report.args.guardrails.map((g) => {
                      const metric = getMetricById(g);
                      if (!metric) return "";

                      const data = report.results?.dimensions?.[0]?.variations;
                      if (!data) return "";

                      return (
                        <div className="col-12 col-xl-4 col-lg-6 mb-3" key={g}>
                          {report.args.statsEngine === "frequentist" ? (
                            <PValueGuardrailResults
                              data={data}
                              variations={variations}
                              metric={metric}
                            />
                          ) : (
                            <GuardrailResults
                              data={data}
                              variations={variations}
                              metric={metric}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {hasData && (
            <div className="row align-items-center mx-2 my-3">
              <div className="col-auto small" style={{ lineHeight: 1.2 }}>
                <div>
                  <span className="text-muted">Engine:</span>{" "}
                  <span>
                    {report.args?.statsEngine === "frequentist"
                      ? "Frequentist"
                      : "Bayesian"}
                  </span>
                </div>
                {report.args?.statsEngine === "frequentist" && (
                  <div>
                    <span className="text-muted">
                      <GBCuped size={12} />
                      CUPED:
                    </span>{" "}
                    <span>
                      {report.args?.regressionAdjustmentEnabled
                        ? "Enabled"
                        : "Disabled"}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted">Date:</span>{" "}
                  <span>
                    {getValidDate(report.dateCreated).toLocaleString([], {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}
        </Tab>
        {permissions.check("createAnalyses", "") && (
          <Tab
            key="configuration"
            anchor="configuration"
            display="Configuration"
            visible={permissions.check("createAnalyses", "")}
            forceRenderOnFocus={true}
          >
            <h2>Configuration</h2>
            <ConfigureReport
              mutate={mutate}
              report={report}
              viewResults={() => setActive("Results")}
            />
          </Tab>
        )}
      </ControlledTabs>
    </div>
  );
}
