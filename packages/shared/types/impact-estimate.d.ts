import { z } from "zod";

import { impactEstimateValidator } from "../validators";

export type ImpactEstimateInterface = z.infer<typeof impactEstimateValidator>;
