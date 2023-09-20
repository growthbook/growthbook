import React, { FC } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import CompactResults from "@/components/Experiment/CompactResults";
import useOrgSettings from "@/hooks/useOrgSettings";

const ShowLatestResults: FC<{
  experiment: ExperimentInterfaceStringDates;
}> = ({ experiment }) => {
  const { ready } = useDefinitions();
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;
  const { data, error } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
  }>(`/experiment/${experiment.id}/snapshot/${experiment?.phases?.length - 1}`);

  if (!ready || !data) {
    return <>Loading...</>;
  }
  if (error) {
    return null;
  }
  if (data && !data.snapshot) {
    return null;
  }
  const phase = experiment?.phases?.[experiment?.phases?.length - 1];
  const snapshot = data.snapshot;
  //const latest = data.latest;

  return (
    <>
      <CompactResults
        id={experiment.id}
        isLatestPhase={true}
        metrics={experiment.metrics}
        metricOverrides={experiment?.metricOverrides ?? []}
        results={snapshot?.analyses[0]?.results?.[0]}
        status={experiment.status}
        startDate={phase?.dateStarted ?? ""}
        variations={experiment.variations.map((v, i) => {
          return {
            id: v.key || i + "",
            name: v.name,
            weight: phase?.variationWeights?.[i] || 0,
          };
        })}
        multipleExposures={snapshot.multipleExposures || 0}
        reportDate={snapshot.dateCreated}
        statsEngine={snapshot?.analyses[0]?.settings.statsEngine}
        pValueCorrection={pValueCorrection}
        regressionAdjustmentEnabled={
          snapshot?.analyses[0]?.settings?.regressionAdjusted
        }
        metricRegressionAdjustmentStatuses={[]}
        sequentialTestingEnabled={
          snapshot?.analyses[0]?.settings?.sequentialTesting
        }
        showTitle={false}
      />
    </>
  );
};
export default ShowLatestResults;
