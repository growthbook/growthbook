import { z } from "zod";

const TYPES = ["SQL", "FACT"] as const;
// export const segmentValidator = z
//   .object({
//     id: z.string(),
//     organization: z.string(),
//     owner: z.string().default(""),
//     datasource: z.string(),
//     dateCreated: z.date(),
//     dateUpdated: z.date(),
//     name: z.string(),
//     description: z.string(),
//     userIdType: z.string(),
//     type: z.enum(TYPES),
//     sql: z.string().optional(),
//     factTableId: z.string().optional(),
//     filters: z.array(z.string()).optional(),
//   })
//   .strict();

export const segmentValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: z.string().default(""),
    datasource: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    userIdType: z.string(),
    type: z.enum(TYPES).default("SQL"), // Default to "SQL" if type is missing
    // type: z.enum(TYPES),
    sql: z.string().optional(),
    factTableId: z.string().optional(),
    filters: z.array(z.string()).optional(),
  })
  .strict();

// const baseSegmentSchema = z.object({
//   id: z.string(),
//   organization: z.string(),
//   owner: z.string().default(""),
//   datasource: z.string(),
//   dateCreated: z.date(),
//   dateUpdated: z.date(),
//   name: z.string(),
//   description: z.string(),
//   userIdType: z.string(),
//   type: z.enum(TYPES).default("SQL"), // Default to "SQL" if type is missing
// });

// export const sqlSegmentSchema = baseSegmentSchema.extend({
//   type: z.literal("SQL"),
//   sql: z.string(),
//   factTableId: z.string().optional(),
//   filters: z.array(z.string()).optional(),
// });

// export const factSegmentSchema = baseSegmentSchema.extend({
//   type: z.literal("FACT"),
//   sql: z.string().optional(),
//   factTableId: z.string(),
//   filters: z.array(z.string()),
// });

// export const segmentValidator = z.union([sqlSegmentSchema, factSegmentSchema]);

// const baseSegmentSchema = z.object({
//   id: z.string(),
//   organization: z.string(),
//   owner: z.string().default(""),
//   datasource: z.string(),
//   dateCreated: z.date(),
//   dateUpdated: z.date(),
//   name: z.string(),
//   description: z.string(),
//   userIdType: z.string(),
//   type: z.enum(TYPES).optional(), // Optional here
// });

// const sqlSegmentSchema = baseSegmentSchema.extend({
//   type: z.literal("SQL").optional(), // Make type optional
//   sql: z.string(),
//   factTableId: z.string().optional(),
//   filters: z.array(z.string()).optional(),
// });

// const factSegmentSchema = baseSegmentSchema.extend({
//   type: z.literal("FACT"),
//   sql: z.string().optional(),
//   factTableId: z.string(),
//   filters: z.array(z.string()),
// });

// export const segmentValidator = z
//   .union([sqlSegmentSchema, factSegmentSchema])
//   // .catchall(z.unknown()) // Catch any unknown fields
//   .refine((data) => data.type === "FACT" || data.type === "SQL", {
//     message: "Type must be SQL or FACT",
//   });

// const baseCreateSegmentSchema = baseSegmentSchema.omit({
//   id: true,
//   organization: true,
// });

// // Create schemas for the create segment variants
// const createSqlSegmentSchema = baseCreateSegmentSchema.extend({
//   type: z.literal("SQL"),
//   sql: z.string(),
//   factTableId: z.string().optional(),
//   filters: z.array(z.string()).optional(),
// });

// const createFactSegmentSchema = baseCreateSegmentSchema.extend({
//   type: z.literal("FACT"),
//   sql: z.string().optional(),
//   factTableId: z.string(),
//   filters: z.array(z.string()),
// });

// // Union of the create segment schemas
// export const createSegmentValidator = z.union([
//   createSqlSegmentSchema,
//   createFactSegmentSchema,
// ]);

export const createSegmentValidator = segmentValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});
