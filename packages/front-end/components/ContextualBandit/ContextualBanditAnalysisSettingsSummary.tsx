import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { ApiContextualBanditInterface } from "shared/validators";
import { expandMetricGroups } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useContextualBanditSnapshot } from "@/components/ContextualBandit/ContextualBanditSnapshotProvider";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
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
  const { latest, refresh, cancel } = useContextualBanditSnapshot();

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

  return (
    <Flex align="center" justify="end" gap="4" wrap="wrap" mb="3">
      <QueriesLastRun
        status={status}
        dateCreated={latest ? getValidDate(latest.dateCreated) : undefined}
        latestQueryDate={latest ? getValidDate(latest.dateCreated) : undefined}
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
  );
}
