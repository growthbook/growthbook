import { z } from "zod";

import { CreateProps } from "shared/types/base-model";
import { metricGroupValidator } from "../validators";

export type MetricGroupInterface = z.infer<typeof metricGroupValidator>;

export type CreateMetricGroupProps = CreateProps<MetricGroupInterface>;
