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
  settings: Pick<
    ExperimentSnapshotSettings,
    "startDate" | "endDate" | "experimentId"
  >,
  activationMetric: ExperimentMetricInterface | null,
): ProcessedDimensions {
  const processedDimensions: ProcessedDimensions = {
    unitDimensions: [],
    experimentDimensions: [],
    activationDimension: null,
    dateDimension: null,
    dateCutoffDimension: null,
    comboDimension: null,
  };

  const compileUserDimension = (dimension: UserDimension): UserDimension => {
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
    return clonedDimension;
  };

  dimensions.forEach((dimension) => {
    if (dimension?.type === "activation") {
      if (activationMetric) {
        processedDimensions.activationDimension = { type: "activation" };
      }
    } else if (dimension?.type === "user") {
      processedDimensions.unitDimensions.push(compileUserDimension(dimension));
    } else if (dimension?.type === "experiment") {
      processedDimensions.experimentDimensions.push(dimension);
    } else if (dimension?.type === "date") {
      processedDimensions.dateDimension = dimension;
    } else if (dimension?.type === "datecutoff") {
      processedDimensions.dateCutoffDimension = dimension;
    } else if (dimension?.type === "combo") {
      processedDimensions.comboDimension = dimension;
      // Register constituents so the units source materializes their columns;
      // the combo's own value is computed downstream from those columns
      dimension.dimensions.forEach((constituent) => {
        if (constituent.type === "experiment") {
          if (
            !processedDimensions.experimentDimensions.some(
              (d) => d.id === constituent.id,
            )
          ) {
            processedDimensions.experimentDimensions.push(constituent);
          }
        } else if (
          !processedDimensions.unitDimensions.some(
            (d) => d.dimension.id === constituent.dimension.id,
          )
        ) {
          processedDimensions.unitDimensions.push(
            compileUserDimension(constituent),
          );
        }
      });
    }
  });
  return processedDimensions;
}
