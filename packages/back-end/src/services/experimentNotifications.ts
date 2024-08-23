import { includeExperimentInPayload } from "shared/util";
import { Context } from "../models/BaseModel";
import { createEvent, CreateEventData } from "../models/EventModel";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";
import {
  ExperimentSnapshotDocument,
  getDefaultAnalysisResults,
} from "../models/ExperimentSnapshotModel";
import {
  ExperimentInterface,
  ExperimentNotification,
} from "../../types/experiment";
import { ExperimentReportResultDimension } from "../../types/report";
import { ResourceEvents } from "../events/base-types";
import { getMetricById } from "../models/MetricModel";
import { getEnvironmentIdsFromOrg } from "./organizations";

// This ensures that the two types remain equal.

const dispatchEvent = async <T extends ResourceEvents<"experiment">>({
  context,
  experiment,
  event,
  data,
}: {
  context: Context;
  experiment: ExperimentInterface;
  event: T;
  data: CreateEventData<"experiment", T>;
}) => {
  const changedEnvs = includeExperimentInPayload(experiment)
    ? getEnvironmentIdsFromOrg(context.org)
    : [];

  await createEvent({
    context,
    object: "experiment",
    event,
    data,
    objectId: experiment.id,
    projects: experiment.project ? [experiment.project] : [],
    environments: changedEnvs,
    tags: experiment.tags || [],
    containsSecrets: false,
  });
};

export const memoizeNotification = async ({
  context,
  experiment,
  type,
  triggered,
  dispatch,
}: {
  context: Context;
  experiment: ExperimentInterface;
  type: ExperimentNotification;
  triggered: boolean;
  dispatch: () => Promise<void>;
}) => {
  if (triggered && experiment.pastNotifications?.includes(type)) return;
  if (!triggered && !experiment.pastNotifications?.includes(type)) return;

  await dispatch();

  const pastNotifications = triggered
    ? [...(experiment.pastNotifications || []), type]
    : (experiment.pastNotifications || []).filter((t) => t !== type);

  await updateExperiment({
    experiment,
    context,
    changes: {
      pastNotifications,
    },
  });
};

export const notifyAutoUpdate = ({
  context,
  experiment,
  success,
}: {
  context: Context;
  experiment: ExperimentInterface;
  success: boolean;
}) =>
  memoizeNotification({
    context,
    experiment,
    type: "auto-update",
    triggered: !success,
    dispatch: () =>
      dispatchEvent({
        context,
        experiment,
        event: "warning",
        data: {
          object: {
            type: "auto-update",
            success,
            experimentId: experiment.id,
            experimentName: experiment.name,
          },
        },
      }),
  });

export const MINIMUM_MULTIPLE_EXPOSURES_PERCENT = 0.01;

export const notifyMultipleExposures = async ({
  context,
  experiment,
  results,
  snapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  results: ExperimentReportResultDimension;
  snapshot: ExperimentSnapshotDocument;
}) => {
  const totalsUsers = results.variations.reduce(
    (totalUsersCount, { users }) => totalUsersCount + users,
    0
  );
  const percent = snapshot.multipleExposures / totalsUsers;
  const multipleExposureMinPercent =
    context.org.settings?.multipleExposureMinPercent ??
    MINIMUM_MULTIPLE_EXPOSURES_PERCENT;

  const triggered = multipleExposureMinPercent < percent;

  await memoizeNotification({
    context,
    experiment,
    type: "multiple-exposures",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      await dispatchEvent({
        context,
        experiment,
        event: "warning",
        data: {
          object: {
            type: "multiple-exposures",
            experimentId: experiment.id,
            experimentName: experiment.name,
            usersCount: snapshot.multipleExposures,
            percent,
          },
        },
      });
    },
  });
};

export const DEFAULT_SRM_THRESHOLD = 0.001;

export const notifySrm = async ({
  context,
  experiment,
  results,
}: {
  context: Context;
  experiment: ExperimentInterface;
  results: ExperimentReportResultDimension;
}) => {
  const srmThreshold =
    context.org.settings?.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const triggered = results.srm < srmThreshold;

  await memoizeNotification({
    context,
    experiment,
    type: "srm",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      await dispatchEvent({
        context,
        experiment,
        event: "warning",
        data: {
          object: {
            type: "srm",
            experimentId: experiment.id,
            experimentName: experiment.name,
            threshold: srmThreshold,
          },
        },
      });
    },
  });
};

export const SIGNIFICANCE_LOWER_THRESHOLD = 0.05;

export const SIGNIFICANCE_UPPER_THRESHOLD = 0.95;

export const notifySignificance = async ({
  context,
  experiment,
  snapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotDocument;
}) => {
  if (!snapshot.results) return;

  const significances: {
    id: string;
    threshold: number;
  }[] = snapshot.results.reduce(
    (ret, result) => [
      ...ret,
      ...result.variations.reduce(
        (res, variant) => [
          ...res,
          ...Object.keys(variant.metrics).reduce((ans, key) => {
            if (!variant.metrics[key]) return ans;

            const chanceToWin = variant.metrics[key].chanceToWin;

            if (chanceToWin === undefined) return ans;

            if (chanceToWin <= SIGNIFICANCE_LOWER_THRESHOLD)
              return [
                ...ans,
                {
                  id: key,
                  threshold: SIGNIFICANCE_LOWER_THRESHOLD,
                },
              ];

            if (SIGNIFICANCE_UPPER_THRESHOLD <= chanceToWin)
              return [
                ...ans,
                {
                  id: key,
                  threshold: SIGNIFICANCE_UPPER_THRESHOLD,
                },
              ];
            return ans;
          }, []),
        ],
        []
      ),
    ],
    []
  );

  const triggered = !!significances.length;

  await memoizeNotification({
    context,
    experiment,
    type: "significance",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      Promise.all(
        significances.map(async ({ id, threshold }) => {
          const metric = await getMetricById(context, id);
          if (!metric) throw new Error(`Cannot find metric with id: ${id}`);

          await dispatchEvent({
            context,
            experiment,
            event: "info.significance",
            data: {
              object: {
                experimentId: experiment.id,
                experimentName: experiment.name,
                metricId: id,
                metricName: metric.name,
                threshold,
              },
            },
          });
        })
      );
    },
  });
};

export const notifyExperimentChange = async ({
  context,
  snapshot,
}: {
  context: Context;
  snapshot: ExperimentSnapshotDocument;
}) => {
  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment) throw new Error("Error while fetching experiment!");

  await notifySignificance({ context, experiment, snapshot });

  const results = getDefaultAnalysisResults(snapshot);

  if (results) {
    await notifyMultipleExposures({
      context,
      experiment,
      results,
      snapshot,
    });
    await notifySrm({ context, experiment, results });
  }
};
