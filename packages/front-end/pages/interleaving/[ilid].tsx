import React, { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { InterleavingEstimator } from "shared/validators";
import type { ExperimentReportResultDimension } from "shared/types/report";
import type { Queries } from "shared/types/query";
import { getValidDate } from "shared/dates";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { interleavingStatusIndicatorData } from "@/services/interleavings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import LoadingSpinner from "@/components/LoadingSpinner";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import PageHead from "@/components/Layout/PageHead";
import InterleavingForm from "@/components/Interleaving/InterleavingForm";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import InterleavingResults from "@/components/Interleaving/InterleavingResults";
import { useInterleaving } from "@/hooks/useInterleavings";
import { useInterleavingQueries } from "@/hooks/useInterleavingQueries";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type ResultsSnapshot = {
  id: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
  runStarted: string | null;
  queries: Queries;
  metricEstimators?: Record<string, InterleavingEstimator>;
  results?: ExperimentReportResultDimension[];
  dateCreated: string;
};

type InterleavingTab = "overview" | "results";

function initialTab(): InterleavingTab {
  if (typeof window !== "undefined" && window.location.hash === "#results") {
    return "results";
  }
  return "overview";
}

export default function InterleavingDetailPage() {
  const router = useRouter();
  const { ilid } = router.query as { ilid: string };
  const { hasCommercialFeature } = useUser();
  const { getDatasourceById, getExperimentMetricById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const { interleaving, loading, error, mutate } = useInterleaving(ilid);
  const { interleavingQueriesMap } = useInterleavingQueries(
    interleaving?.datasource,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [tab, setTab] = useState<InterleavingTab>(initialTab);

  const changeTab = (value: string) => {
    const next: InterleavingTab = value === "results" ? "results" : "overview";
    setTab(next);
    router.replace(`${router.asPath.split("#")[0]}#${next}`, undefined, {
      shallow: true,
    });
  };

  const { data: resultsData, mutate: mutateResults } = useApi<{
    snapshot: ResultsSnapshot | null;
  }>(`/api/v1/interleavings/${ilid}/results`, {
    shouldRun: () => !!ilid && hasCommercialFeature("interleaving"),
    autoRevalidate: true,
  });
  const snapshot = resultsData?.snapshot ?? null;
  const isRunning =
    snapshot?.status === "running" || snapshot?.status === "pending";

  // Poll while a refresh is in flight, even when the Results tab (and with
  // it the RunQueriesButton poll loop) is not mounted
  React.useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      mutateResults();
    }, 3000);
    return () => clearInterval(interval);
  }, [isRunning, mutateResults]);

  if (!hasCommercialFeature("interleaving")) {
    return (
      <div className="container pagecontents">
        <PremiumEmptyState
          h1="Interleaving"
          title="Compare rankers with interleaved lists"
          description="Interleaving experiments are available on the Enterprise plan."
          commercialFeature="interleaving"
          learnMoreLink="https://docs.growthbook.io/interleaving/overview"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Failed to load this interleaving experiment.
        </Callout>
      </div>
    );
  }
  if (loading || !interleaving) {
    return (
      <div className="container pagecontents">
        <LoadingSpinner />
      </div>
    );
  }

  const canEdit =
    permissionsUtil.canViewInterleavingModal(interleaving.project) &&
    !interleaving.archived;
  const exposureQuery = interleavingQueriesMap.get(
    interleaving.interleavingQueryId,
  );

  const queryStatus = getQueryStatus(
    snapshot?.queries ?? [],
    snapshot?.error,
  ).status;
  const queriesFailed =
    queryStatus === "failed" || queryStatus === "partially-succeeded";

  const refresh = async () => {
    setRefreshError(null);
    try {
      await apiCall(`/api/v1/interleavings/${ilid}/refresh`, {
        method: "POST",
      });
      await mutateResults();
    } catch (e) {
      setRefreshError(e.message);
    }
  };

  const transition = async (action: "start" | "stop") => {
    setLifecycleError(null);
    try {
      await apiCall(`/api/v1/interleavings/${ilid}/${action}`, {
        method: "POST",
      });
      await mutate();
    } catch (e) {
      setLifecycleError(e.message);
    }
  };

  return (
    <div className="container pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Interleaving", href: "/interleaving" },
          { display: interleaving.name },
        ]}
      />
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <Heading as="h1" size="xl" mb="0">
            {interleaving.name}
          </Heading>
          <Box style={{ userSelect: "none" }}>
            <ExperimentStatusIndicator
              experimentData={interleavingStatusIndicatorData(interleaving)}
            />
          </Box>
        </Flex>
        <Flex gap="2" align="center" flexShrink="0">
          {canEdit && interleaving.status === "draft" && (
            <Button onClick={() => transition("start")}>
              Start Interleaving
            </Button>
          )}
          {canEdit && interleaving.status === "running" && (
            <Button
              variant="outline"
              color="red"
              onClick={() => setConfirmStop(true)}
            >
              Stop Interleaving
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
        </Flex>
      </Flex>

      {lifecycleError && (
        <Callout status="error" mb="3">
          {lifecycleError}
        </Callout>
      )}
      {interleaving.status === "draft" && (
        <Callout status="info" mb="3">
          This interleaving experiment is a draft — it is not included in the
          SDK payload. Start it to begin serving interleaved lists.
        </Callout>
      )}

      <Tabs value={tab} onValueChange={changeTab}>
        <Box mb="3">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
          </TabsList>
        </Box>

        <TabsContent value="overview">
          <Frame>
            <Heading as="h3" size="md">
              Overview
            </Heading>
            <table className="table gbtable w-auto">
              <tbody>
                <tr>
                  <th className="pr-4">Tracking key</th>
                  <td>
                    <code>{interleaving.trackingKey}</code>
                  </td>
                </tr>
                <tr>
                  <th className="pr-4">Data Source</th>
                  <td>
                    {getDatasourceById(interleaving.datasource)?.name ??
                      interleaving.datasource}
                  </td>
                </tr>
                <tr>
                  <th className="pr-4">Exposure query</th>
                  <td>
                    {exposureQuery?.name ?? interleaving.interleavingQueryId}
                  </td>
                </tr>
                <tr>
                  <th className="pr-4">Rankers</th>
                  <td>
                    {interleaving.variationNames[0]} (control) vs{" "}
                    {interleaving.variationNames[1]} (treatment)
                  </td>
                </tr>
                <tr>
                  <th className="pr-4">Metrics</th>
                  <td>
                    {interleaving.metrics
                      .map(
                        (m) =>
                          `${getExperimentMetricById(m.id)?.name || m.id} (${m.estimator})`,
                      )
                      .join(", ") || "None"}
                  </td>
                </tr>
                {interleaving.measurementArmPercent ? (
                  <tr>
                    <th className="pr-4">Measurement arm</th>
                    <td>
                      {interleaving.measurementArmPercent}% holdout, tracked as{" "}
                      <code>{interleaving.trackingKey}__measurement</code>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Frame>
        </TabsContent>

        <TabsContent value="results">
          <Frame>
            <Flex align="center" justify="between" mb="3">
              <QueriesLastRun
                status={queryStatus}
                dateCreated={
                  snapshot ? getValidDate(snapshot.dateCreated) : undefined
                }
                queries={
                  snapshot && queriesFailed
                    ? snapshot.queries.map((q) => q.query)
                    : undefined
                }
                onViewQueries={
                  snapshot && queriesFailed
                    ? () => setQueriesModalOpen(true)
                    : undefined
                }
                showAutoUpdateWidget={false}
              />
              <RunQueriesButton
                cta="Update"
                cancelEndpoint={`/api/v1/interleavings/${ilid}/cancel-refresh`}
                model={{
                  queries: snapshot?.queries ?? [],
                  runStarted: snapshot?.runStarted ?? null,
                }}
                mutate={mutateResults}
                onSubmit={refresh}
                icon="refresh"
              />
            </Flex>
            {refreshError && (
              <Callout status="error" mb="2">
                {refreshError}
              </Callout>
            )}
            {snapshot?.status === "error" && (
              <Callout status="error" mb="2">
                The last update failed: {snapshot.error || "Unknown error"}
              </Callout>
            )}
            {snapshot?.results && snapshot.results.length > 0 ? (
              <InterleavingResults
                interleaving={interleaving}
                results={snapshot.results}
                metricEstimators={snapshot.metricEstimators ?? {}}
                snapshotDate={new Date(snapshot.dateCreated)}
              />
            ) : !isRunning ? (
              <Callout status="info">
                No results yet. Click &quot;Update&quot; to run the analysis.
              </Callout>
            ) : null}
          </Frame>
        </TabsContent>
      </Tabs>

      {queriesModalOpen && snapshot && (
        <AsyncQueriesModal
          close={() => setQueriesModalOpen(false)}
          queries={snapshot.queries.map((q) => q.query)}
          savedQueries={[]}
          error={snapshot.error}
        />
      )}

      {confirmStop && (
        <ConfirmDialog
          title="Stop this interleaving experiment?"
          content="Stopping removes it from the SDK payload — users will see the fallback list. Results stay available."
          yesText="Stop"
          onConfirm={async () => {
            await transition("stop");
            setConfirmStop(false);
          }}
          onCancel={() => setConfirmStop(false)}
        />
      )}

      {editOpen && (
        <InterleavingForm
          mode="edit"
          interleaving={interleaving}
          onSave={async () => {
            await mutate();
            setEditOpen(false);
          }}
          onCancel={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
