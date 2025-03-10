import md5 from "md5";
import { addHours } from "date-fns";
import { ReqContext } from "back-end/types/organization";
import { ExperimentInterface } from "back-end/src/validators/experiments";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { CreateExperimentTimeSeries } from "back-end/src//validators/experiment-time-series";
import { getAllSnapshotsForTimeSeries } from "back-end/src/models/ExperimentSnapshotModel";

export async function updateExperimentTimeSeries({
  context,
  experiment,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
}) {
  const allSnapshots = await getAllSnapshotsForTimeSeries({
    experiment: experiment.id,
    phase: experiment.phases.length - 1,
  });

  if (allSnapshots.length > 0) {
    const experimentTimeSeries = convertExperimentSnapshotsToTimeSeries({
      experiment,
      snapshots: allSnapshots,
    });

    await context.models.experimentTimeSeries.createOrUpdate(
      experimentTimeSeries
    );
  }
}

export function convertExperimentSnapshotsToTimeSeries({
  experiment,
  snapshots,
}: {
  experiment: ExperimentInterface;
  snapshots: ExperimentSnapshotInterface[];
}): CreateExperimentTimeSeries {
  const timeSeriesResults = snapshots.map((s) =>
    convertSingleSnapshotToTimeSeries(experiment, s)
  );

  // Limit the number of results, to avoid uncapped growing document
  const reducedDataPoints = downsampleTimeSeriesData(timeSeriesResults);

  const experimentTimeSeries: CreateExperimentTimeSeries = {
    experiment: experiment.id,
    phase: experiment.phases.length - 1,
    results: reducedDataPoints,
  };

  return experimentTimeSeries;
}

function convertSingleSnapshotToTimeSeries(
  experiment: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface
): CreateExperimentTimeSeries["results"][number] {
  const analyses = Object.fromEntries(
    snapshot.analyses
      .filter((a) => a.results.length > 0 && a.results[0].variations.length > 0)
      .map((a) => {
        return [a.settings.differenceType, a];
      })
  );

  return {
    snapshotId: snapshot.id,
    analysisDate: snapshot.dateCreated,
    settingsHash: md5(
      JSON.stringify({ ...snapshot.settings, metricSettings: [] })
    ),
    metrics: Object.fromEntries(
      snapshot.settings.metricSettings.map((metricSetting) => {
        return [
          metricSetting.id,
          {
            metricSettingsHash: md5(JSON.stringify(metricSetting)),
            variations: snapshot.settings.variations.map((_, index) => ({
              id: experiment.variations[index].id,
              name: experiment.variations[index].name,
              absoluteData:
                analyses["absolute"]?.results[0]?.variations[index].metrics[
                  metricSetting.id
                ],
              relativeData:
                analyses["relative"]?.results[0]?.variations[index].metrics[
                  metricSetting.id
                ],
              scaledData:
                analyses["scaled"]?.results[0]?.variations[index].metrics[
                  metricSetting.id
                ],
            })),
          },
        ];
      })
    ),
  };
}

function downsampleTimeSeriesData(
  timeSeriesDataPoints: CreateExperimentTimeSeries["results"]
): CreateExperimentTimeSeries["results"] {
  const MAX_RESULTS = 60;

  const results = [...timeSeriesDataPoints];
  let iter = 0;
  for (let i = results.length; results.length > MAX_RESULTS; i--) {
    const hours = 24 * (iter <= 0 ? 1 : iter <= 2 ? 7 : iter <= 3 ? 30 : 90);

    if (
      i > 0 &&
      i < results.length - 1 &&
      addHours(results[i].analysisDate, hours - 2) >=
        results[i - 1].analysisDate
    ) {
      results.splice(i, 1);
    }

    if (i === 0) {
      i = results.length;
      iter++;
    }
  }

  return results;
}
