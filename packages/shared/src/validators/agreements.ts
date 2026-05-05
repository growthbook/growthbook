import { z } from "zod";

export const AGREEMENT_TYPE_AI = "ai";
export const AGREEMENT_TYPE_MANAGED_WAREHOUSE = "managed-warehouse";

export const agreementType = z.enum([
  AGREEMENT_TYPE_AI,
  AGREEMENT_TYPE_MANAGED_WAREHOUSE,
]);

export const agreementValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    agreement: agreementType,
    version: z.string(),
    userId: z.string(),
    userEmail: z.string(),
    userName: z.string(),
    dateSigned: z.date(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type AgreementType = z.infer<typeof agreementType>;
export type AgreementValidator = z.infer<typeof agreementValidator>;
