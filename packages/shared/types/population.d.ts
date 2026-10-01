import { z } from "zod";
import {
  populationStepSourceValidator,
  populationStepValidator,
  populationValidator,
} from "shared/validators";

export type PopulationStepSource = z.infer<
  typeof populationStepSourceValidator
>;

export type PopulationStep = z.infer<typeof populationStepValidator>;

export type PopulationInterface = z.infer<typeof populationValidator>;
