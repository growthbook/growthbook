import type { z } from "zod";

import type { CreateProps } from "shared/types/base-model";
import type { metricGroupValidator } from "../validators";

export type MetricGroupInterface = z.infer<typeof metricGroupValidator>;

export type CreateMetricGroupProps = CreateProps<MetricGroupInterface>;
