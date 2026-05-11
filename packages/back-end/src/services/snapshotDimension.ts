import type pino from "pino";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import { findDimensionById } from "back-end/src/models/DimensionModel";
import { logger as defaultLogger } from "back-end/src/util/logger";

/**
 * Validates a user-supplied dimension string for experiment result snapshot APIs.
 *
 * @throws {Error} if the dimension is not valid
 */
export async function validateSnapshotDimension({
  experiment,
  datasource,
  dimension,
  logger = defaultLogger,
  organization,
}: {
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  dimension: string;
  logger?: Pick<pino.BaseLogger, "warn">;
  organization: string;
}): Promise<void> {
  if (dimension.startsWith("pre:")) {
    const preType = dimension.substring(4);
    if (preType !== "date" && preType !== "activation") {
      throw new Error(
        `Pre-exposure dimension "${dimension}" is not supported. Use "pre:date" or "pre:activation".`,
      );
    }
    if (preType === "activation" && !experiment.activationMetric) {
      throw new Error(
        `Cannot use "pre:activation" because this experiment has no activation metric configured.`,
      );
    }
    return;
  }

  if (dimension.startsWith("exp:")) {
    const dimName = dimension.substring(4);
    if (!experiment.exposureQueryId) {
      throw new Error(
        `Cannot use an "exp:" dimension because this experiment has no exposure query configured.`,
      );
    }
    const exposureQuery = datasource.settings?.queries?.exposure?.find(
      (q) => q.id === experiment.exposureQueryId,
    );
    if (!exposureQuery?.dimensions?.includes(dimName)) {
      throw new Error(
        `Experiment dimension "${dimName}" is not available on the experiment's exposure query.`,
      );
    }
    return;
  }

  const dimensionDoc = await findDimensionById(dimension, organization);
  if (!dimensionDoc) {
    throw new Error(
      `Dimension "${dimension}" not found. Use a Unit Dimension id, an Experiment Dimension like "exp:country", or a built-in pre-exposure dimension "pre:date" or "pre:activation".`,
    );
  }
  if (!dimensionDoc.datasource) {
    logger.warn(
      {
        organization,
        experimentId: experiment.id,
        datasourceId: datasource.id,
        dimension,
      },
      "Unit dimension has no datasource; allowing for compatibility",
    );
    return;
  }
  if (datasource.id && dimensionDoc.datasource !== datasource.id) {
    throw new Error(
      `Dimension ${dimension} is not available on the experiment's datasource.`,
    );
  }
}
