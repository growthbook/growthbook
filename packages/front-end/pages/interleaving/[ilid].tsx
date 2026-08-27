import React, { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { InterleavingEstimator } from "shared/validators";
import type { ExperimentReportResultDimension } from "shared/types/report";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import LoadingSpinner from "@/components/LoadingSpinner";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import PageHead from "@/components/Layout/PageHead";
import InterleavingForm from "@/components/Interleaving/InterleavingForm";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
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
  metricInterleaveIdCoverage?: Record<string, number>;
  results?: ExperimentReportResultDimension[];
  dateCreated: string;
};

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

  const { data: resultsData, mutate: mutateResults } = useApi<{
    snapshot: ResultsSnapshot | null;
  }>(`/api/v1/interleavings/${ilid}/results`, {
    shouldRun: () => !!ilid && hasCommercialFeature("interleaving"),
    autoRevalidate: true,
  });
  const snapshot = resultsData?.snapshot ?? null;
  const isRunning =
    snapshot?.status === "running" || snapshot?.status === "pending";

  // Poll while a refresh is in flight
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
          <Badge label={interleaving.status} color="indigo" />
        </Flex>
        <Flex gap="2" align="center">
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          <RunQueriesButton
            cta="Update results"
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
      </Flex>

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
              <td>{exposureQuery?.name ?? interleaving.interleavingQueryId}</td>
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
                {interleaving.metricIds
                  .map((id) => getExperimentMetricById(id)?.name || id)
                  .join(", ") || "None"}
              </td>
            </tr>
          </tbody>
        </table>
      </Frame>

      <Box mt="4">
        <Flex align="center" justify="between">
          <Heading as="h3" size="md">
            Results
          </Heading>
          {snapshot && snapshot.queries.length > 0 && (
            <ViewAsyncQueriesButton
              queries={snapshot.queries.map((q) => q.query)}
              error={snapshot.error}
              status={getQueryStatus(snapshot.queries).status}
              condensed
            />
          )}
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
        {isRunning && (
          <Callout status="info" mb="2">
            Queries are running… results refresh automatically.
          </Callout>
        )}
        {snapshot?.results && snapshot.results.length > 0 ? (
          <InterleavingResults
            interleaving={interleaving}
            results={snapshot.results}
            metricEstimators={snapshot.metricEstimators ?? {}}
            metricInterleaveIdCoverage={
              snapshot.metricInterleaveIdCoverage ?? {}
            }
            snapshotDate={new Date(snapshot.dateCreated)}
          />
        ) : !isRunning ? (
          <Callout status="info">
            No results yet. Click &quot;Update results&quot; to run the
            analysis.
          </Callout>
        ) : null}
      </Box>

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
