import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { ApiContextualBanditInterface } from "shared/validators";
import {
  expandMetricGroups,
  isActiveVariation,
  isDeactivatedVariation,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useContextualBanditSnapshot } from "@/components/ContextualBandit/ContextualBanditSnapshotProvider";
import OutdatedBadge from "@/components/OutdatedBadge";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";

export default function ContextualBanditAnalysisSettingsSummary({
  cb,
  mutate,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
}) {
  const { getDatasourceById, metricGroups } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { latest, results, refresh, cancel } = useContextualBanditSnapshot();
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);

  const datasource = cb.datasource ? getDatasourceById(cb.datasource) : null;

  const allExpandedMetrics = useMemo(() => {
    const ids = cb.decisionMetric ? [cb.decisionMetric] : [];
    return Array.from(new Set(expandMetricGroups(ids, metricGroups)));
  }, [cb.decisionMetric, metricGroups]);

  const canRunQueries =
    !!datasource &&
    permissionsUtil.canRunExperimentQueries(datasource) &&
    allExpandedMetrics.length > 0;

  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const overallVariations = useMemo(
    () => results?.overall.variations ?? [],
    [results?.overall.variations],
  );
  const hasTableData = (results?.leaves ?? []).length > 0;
  const isOutdated = useMemo(() => {
    const snapshotIds = new Set(overallVariations.map((v) => v.variationId));
    const pendingActive = cb.variations.filter(
      (v) => isActiveVariation(v) && !snapshotIds.has(v.id),
    );
    return (
      pendingActive.length > 0 ||
      overallVariations.some((v) => {
        const current = cb.variations.find((c) => c.id === v.variationId);
        return !current || isDeactivatedVariation(current);
      })
    );
  }, [overallVariations, cb.variations]);

  const showQueries =
    !!latest && (status === "failed" || status === "partially-succeeded");

  return (
    <>
      <Flex align="center" justify="end" gap="4" wrap="wrap" mb="3">
        {isOutdated && hasTableData ? (
          <OutdatedBadge
            reasons={[
              "The Contextual Bandit's variations have changed since the last results were computed. Update results to reflect the current variation set.",
            ]}
          />
        ) : null}
        <QueriesLastRun
          status={status}
          dateCreated={latest ? getValidDate(latest.dateCreated) : undefined}
          latestQueryDate={
            latest ? getValidDate(latest.dateCreated) : undefined
          }
          nextUpdate={
            cb.nextSnapshotAttempt
              ? getValidDate(cb.nextSnapshotAttempt)
              : undefined
          }
          autoUpdateEnabled={cb.status === "running" && !!cb.autoSnapshots}
          showAutoUpdateWidget={true}
          failedString={
            latest && !latest.queries.length && latest.error
              ? `Snapshot update failed: ${latest.error}`
              : undefined
          }
          queries={showQueries ? latest.queries.map((q) => q.query) : undefined}
          onViewQueries={
            showQueries ? () => setQueriesModalOpen(true) : undefined
          }
        />
        {canRunQueries ? (
          <RunQueriesButton
            cta="Update results"
            icon="refresh"
            model={{
              queries: latest?.queries ?? [],
              runStarted: latest?.runStarted ?? null,
            }}
            onCancel={cancel}
            mutate={mutate}
            onSubmit={async () => {
              await refresh();
              mutate();
            }}
          />
        ) : null}
      </Flex>
      {queriesModalOpen && showQueries && (
        <AsyncQueriesModal
          close={() => setQueriesModalOpen(false)}
          queries={latest.queries.map((q) => q.query)}
          savedQueries={[]}
          error={latest.error}
        />
      )}
    </>
  );
}
