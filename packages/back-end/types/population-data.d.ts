import { z } from "zod";

import { populationDataInterfaceValidator } from "back-end/src/routers/population-data/population-data.validators";

export type PopulationDataInterface = z.infer<
  typeof populationDataInterfaceValidator
>;