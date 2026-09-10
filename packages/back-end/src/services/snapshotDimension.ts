import { parseDimensionId } from "shared/experiments";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import { findDimensionById } from "back-end/src/models/DimensionModel";

function validateExperimentDimension({
  experiment,
  datasource,
  column,
}: {
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  column: string;
}): void {
  if (!experiment.exposureQueryId) {
    throw new Error(
      `Cannot use an "exp:" dimension because this experiment has no exposure query configured.`,
    );
  }
  const exposureQuery = datasource.settings?.queries?.exposure?.find(
    (q) => q.id === experiment.exposureQueryId,
  );
  if (!exposureQuery?.dimensions?.includes(column)) {
    throw new Error(
      `Experiment dimension "${column}" is not available on the experiment's exposure query.`,
    );
  }
}

async function validateUserDimension({
  datasource,
  dimension,
  organization,
}: {
  datasource: DataSourceInterface;
  dimension: string;
  organization: string;
}): Promise<void> {
  const dimensionDoc = await findDimensionById(dimension, organization);
  if (!dimensionDoc) {
    throw new Error(`Dimension ${dimension} not found`);
  }
  if (dimensionDoc.datasource !== datasource.id) {
    throw new Error(
      `Dimension ${dimension} belongs to a different data source than this experiment.`,
    );
  }
}

/**
 * Validates a user-supplied dimension string for a snapshot create request.
 *
 * @throws {Error} if the dimension is not valid
 */
export async function validateSnapshotDimension({
  experiment,
  datasource,
  dimension,
  organization,
  phase,
}: {
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  dimension: string;
  organization: string;
  phase?: number;
}): Promise<void> {
  const parsed = parseDimensionId(dimension);
  switch (parsed.kind) {
    case "invalid":
      throw new Error(parsed.reason);
    case "date":
      return;
    case "activation":
      if (!experiment.activationMetric) {
        throw new Error(
          `Cannot use "pre:activation" because this experiment has no activation metric configured.`,
        );
      }
      return;
    case "experiment":
      validateExperimentDimension({
        experiment,
        datasource,
        column: parsed.column,
      });
      return;
    case "datecutoff": {
      const phaseObj = experiment.phases[phase ?? experiment.phases.length - 1];
      const start = phaseObj?.dateStarted;
      const end = phaseObj?.dateEnded ?? new Date();
      if (start && (parsed.cutoff <= start || parsed.cutoff >= end)) {
        throw new Error(
          `The cutoff datetime must fall within the experiment phase, between ${start.toISOString()} and ${end.toISOString()}.`,
        );
      }
      return;
    }
    case "combo":
      for (const constituentId of parsed.constituentIds) {
        const constituent = parseDimensionId(constituentId);
        if (constituent.kind === "experiment") {
          validateExperimentDimension({
            experiment,
            datasource,
            column: constituent.column,
          });
        } else if (constituent.kind === "user") {
          await validateUserDimension({
            datasource,
            dimension: constituent.id,
            organization,
          });
        } else {
          throw new Error(
            `Invalid combination dimension "${constituentId}". Each must be an experiment dimension ("exp:<name>") or a unit dimension id.`,
          );
        }
      }
      return;
    case "user": {
      const dimensionDoc = await findDimensionById(parsed.id, organization);
      if (!dimensionDoc) {
        throw new Error(`Dimension ${dimension} not found`);
      }
      return;
    }
  }
}
