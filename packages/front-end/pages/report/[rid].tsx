import { useRouter } from "next/router";
import { ReportInterface } from "back-end/types/report";
import LoadingOverlay from "../../components/LoadingOverlay";
import Markdown from "../../components/Markdown/Markdown";
import useApi from "../../hooks/useApi";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useContext, useState } from "react";
import RunQueriesButton, {
  getQueryStatus,
} from "../../components/Queries/RunQueriesButton";
import { ago, datetime, getValidDate } from "../../services/dates";
import { UserContext } from "../../components/ProtectedPage";
import DateResults from "../../components/Experiment/DateResults";
import BreakDownResults from "../../components/Experiment/BreakDownResults";
import CompactResults from "../../components/Experiment/CompactResults";
import GuardrailResults from "../../components/Experiment/GuardrailResult";
import { useAuth } from "../../services/auth";
import ControlledTabs from "../../components/Tabs/ControlledTabs";
import Tab from "../../components/Tabs/Tab";
import { GBEdit } from "../../components/Icons";
import EditTitleDescription from "../../components/Report/EditTitleDescription";
import ConfigureReport from "../../components/Report/ConfigureReport";
import ResultMoreMenu from "../../components/Experiment/ResultMoreMenu";

export default function ReportPage() {
  const router = useRouter();
  const { rid } = router.query;

  const [editModalOpen, setEditModalOpen] = useState(false);

  const { getMetricById, getDatasourceById } = useDefinitions();
  const { data, error, mutate } = useApi<{ report: ReportInterface }>(
    `/report/${rid}`
  );
  const { permissions } = useContext(UserContext);
  const [active, setActive] = useState<string | null>("Results");

  const { apiCall } = useAuth();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const report = data.report;

  const variations = report.args.variations;

  const datasource = getDatasourceById(report.args.datasource);

  const status = getQueryStatus(report.queries || [], report.error);

  const hasData = report.results?.dimensions?.[0]?.variations?.length > 0;

  const phaseAgeMinutes =
    (Date.now() - getValidDate(report.args.startDate).getTime()) / (1000 * 60);

  return (
    <div className="container-fluid pagecontents experiment-details">
      {editModalOpen && (
        <EditTitleDescription
          report={report}
          cancel={() => setEditModalOpen(false)}
          mutate={mutate}
        />
      )}
      <div className="mb-3">
        <h1>
          {report.title}{" "}
          {permissions.runExperiments && (
            <a
              className="ml-2 cursor-pointer"
              onClick={() => setEditModalOpen(true)}
            >
              <GBEdit />
            </a>
          )}
        </h1>
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
        navClassName={permissions.runExperiments ? "" : "d-none"}
      >
        <Tab key="results" anchor="results" display="Results" padding={false}>
          <div className="p-3">
            <div className="row align-items-center">
              <div className="col">
                <h2>Results</h2>
              </div>
              <div className="col-auto ml-auto">
                {report.runStarted && status !== "running" ? (
                  <small
                    className="text-muted"
                    title={datetime(report.runStarted)}
                  >
                    updated {ago(report.runStarted)}
                  </small>
                ) : (
                  ""
                )}
              </div>
              <div className="col-auto">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await apiCall(`/report/${report.id}/refresh`, {
                        method: "POST",
                      });
                      mutate();
                    } catch (e) {
                      console.error(e);
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
                  configure={() => setActive("Configuration")}
                  editMetrics={() => setActive("Configuration")}
                  generateReport={false}
                  hasUserQuery={false}
                  notebookUrl={`/report/${report.id}/notebook`}
                  notebookFilename={report.title}
                  queries={report.queries}
                  queryError={report.error}
                />
              </div>
            </div>
            {report.args.metrics.length === 0 && (
              <div className="alert alert-info">
                Add at least 1 metric to view results.
              </div>
            )}
            {!hasData &&
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
                  {!report.results && `Click the "Refresh" button.`}
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
                reportDate={report.dateCreated}
                results={report.results?.dimensions || []}
                status={"stopped"}
                startDate={getValidDate(report.args.startDate).toISOString()}
                dimensionId={report.args.dimension}
                activationMetric={report.args.activationMetric}
                guardrails={report.args.guardrails}
                variations={variations}
                key={report.args.dimension}
              />
            ))}
          {hasData && !report.args.dimension && (
            <>
              <CompactResults
                id={report.id}
                isLatestPhase={true}
                metrics={report.args.metrics}
                reportDate={report.dateCreated}
                results={report.results?.dimensions?.[0]}
                status={"stopped"}
                startDate={getValidDate(report.args.startDate).toISOString()}
                unknownVariations={report.results?.unknownVariations || []}
                multipleExposures={report.results?.multipleExposures || 0}
                variations={variations}
                isUpdating={status === "running"}
              />
              {report.args.guardrails?.length > 0 && (
                <div className="mb-3 p-3">
                  <h3 className="mb-3">Guardrails</h3>
                  <div className="row mt-3">
                    {report.args.guardrails.map((g) => {
                      const metric = getMetricById(g);
                      if (!metric) return "";

                      const data = report.results?.dimensions?.[0]?.variations;
                      if (!data) return "";

                      return (
                        <div className="col-12 col-xl-4 col-lg-6 mb-3" key={g}>
                          <GuardrailResults
                            data={data}
                            variations={variations}
                            metric={metric}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </Tab>
        <Tab
          key="configuration"
          anchor="configuration"
          display="Configuration"
          visible={permissions.runExperiments}
        >
          <h2>Configuration</h2>
          <ConfigureReport
            mutate={mutate}
            report={report}
            viewResults={() => setActive("Results")}
          />
        </Tab>
      </ControlledTabs>
    </div>
  );
}
