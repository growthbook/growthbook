import { z } from "zod";

import {
  populationDataInterfaceValidator,
  populationDataMetricValidator,
  populationDataSourceTypeValidator,
} from "back-end/src/routers/population-data/population-data.validators";

export type PopulationDataInterface = z.infer<
  typeof populationDataInterfaceValidator
>;

export type PopulationDataMetric = z.infer<
  typeof populationDataMetricValidator
>;

export type PopulationDataSourceType = z.infer<
  typeof populationDataSourceTypeValidator
>;
