import { z } from "zod";
import { isoDatetimeToDate } from "./codecs";

export const baseSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: isoDatetimeToDate,
    dateUpdated: isoDatetimeToDate,
  })
  .strict();

export const apiBaseSchema = z
  .object({
    id: z.string(),
    dateCreated: z.iso.datetime(),
    dateUpdated: z.iso.datetime(),
  })
  .strict();
