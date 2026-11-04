import { z } from "zod";

export const qaOverrideAdditionalTargetingValidator = z
  .object({
    attribute: z.string().min(1),
    values: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const qaOverrideBaseValidator = z.object({
  id: z.string(),
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  sdkConnection: z.string(),
  environment: z.string(),
  additionalTargeting: qaOverrideAdditionalTargetingValidator.nullable(),
  createdBy: z.string(),
});
