import cloneDeep from "lodash/cloneDeep";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  Dimension,
  ProcessedDimensions,
  UserDimension,
} from "shared/types/integrations";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function processDimensions(
  dialect: SqlDialect,
  dimensions: Dimension[],
  settings: ExperimentSnapshotSettings,
  activationMetric: ExperimentMetricInterface | null,
): ProcessedDimensions {
  const processedDimensions: ProcessedDimensions = {
    unitDimensions: [],
    experimentDimensions: [],
    activationDimension: null,
    dateDimension: null,
  };

  dimensions.forEach((dimension) => {
    if (dimension?.type === "activation") {
      if (activationMetric) {
        processedDimensions.activationDimension = { type: "activation" };
      }
    } else if (dimension?.type === "user") {
      // Replace any placeholders in the user defined dimension SQL
      const clonedDimension = cloneDeep<UserDimension>(dimension);
      clonedDimension.dimension.sql = compileSqlTemplate(
        dimension.dimension.sql,
        {
          startDate: settings.startDate,
          endDate: settings.endDate,
          experimentId: settings.experimentId,
        },
        dialect,
      );
      processedDimensions.unitDimensions.push(clonedDimension);
    } else if (dimension?.type === "experiment") {
      processedDimensions.experimentDimensions.push(dimension);
    } else if (dimension?.type === "date") {
      processedDimensions.dateDimension = dimension;
    }
  });
  return processedDimensions;
}
