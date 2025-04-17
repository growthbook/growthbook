import { z } from "zod";
import { baseSchema } from "back-end/src/models/BaseModel";
import { experimentAnalysisSummary } from "./experiments";

export const safeRolloutStatusArray = [
  "running",
  "rolled-back",
  "released",
  "stopped",
] as const;
export type SafeRolloutStatus = typeof safeRolloutStatusArray[number];

const safeRollout = z.object({
  datasourceId: z.string(),
  exposureQueryId: z.string(),
  hashAttribute: z.string(),
  guardrailMetricIds: z.array(z.string()),
  status: z.enum(safeRolloutStatusArray),
  startedAt: z.date().optional(),
  lastSnapshotAttempt: z.date().optional(),
  nextSnapshotAttempt: z.date().optional(),
  autoSnapshots: z.boolean().default(true),
  featureId: z.string(),
  ruleId: z.string(),
  maxDurationDays: z.number(),
  analysisSummary: experimentAnalysisSummary,
  environment: z.string(),
});
export const safeRolloutValidator = baseSchema
  .extend(safeRollout.shape)
  .strict();
export type SafeRolloutInterface = z.infer<typeof safeRolloutValidator>;

export type CreateSafeRolloutInterface = Pick<
  SafeRolloutInterface,
  | "datasourceId"
  | "exposureQueryId"
  | "hashAttribute"
  | "maxDurationDays"
  | "guardrailMetricIds"
>;
