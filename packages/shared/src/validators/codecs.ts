import { z } from "zod";

// Accept both ISO string and Date when parsing (e.g. updates coming through BaseModel
// _updateOne may already have Date objects from a prior parse)
export const isoDatetimeToDate = z.codec(
  z.union([z.iso.datetime(), z.date()]),
  z.date(),
  {
    decode: (val: string | Date) =>
      typeof val === "string" ? new Date(val) : val,
    encode: (date) => date.toISOString(),
  },
);

// For optional date fields: treats `null` as "unset" (undefined) at the parse boundary
// so that MongoDB's null-for-cleared-optional storage detail never leaks into domain types
export const optionalIsoDatetimeToDate = z.preprocess(
  (val) => (val === null ? undefined : val),
  isoDatetimeToDate.optional(),
);
