import { z } from "zod";
import { baseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

const lineErrors = z
  .array(z.string().max(500))
  .max(10)
  .describe("The first problems found in the file");

const loadReportFields = {
  storeId: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "Identifies the data store, such as one Redis. Loaders sharing a store report with the same id.",
    ),
  status: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("loading") }).strict(),
      z
        .object({
          type: z.literal("loaded"),
          rowCount: z
            .number()
            .int()
            .nonnegative()
            .describe("Unique IDs loaded"),
        })
        .strict(),
      z
        .object({
          type: z.literal("invalid"),
          invalidLineCount: z.number().int().nonnegative(),
          errors: lineErrors,
        })
        .strict()
        .describe(
          "The file has problems, so the store kept serving the previous upload",
        ),
      z
        .object({
          type: z.literal("failed"),
          error: z
            .string()
            .max(2000)
            .describe("A problem in the data store, not the file"),
        })
        .strict(),
    ])
    .describe(
      "Loaders validate the file while loading it, so each store reports its own result.",
    ),
};

/** One data store's report on loading an upload. */
export const savedGroupUploadLoadValidator = z
  .object({ ...loadReportFields, dateUpdated: z.date() })
  .strict();

export type SavedGroupUploadLoad = z.infer<
  typeof savedGroupUploadLoadValidator
>;

/** GrowthBook's own check of the whole file. Loaders only see `valid` uploads. */
export const savedGroupUploadStatusValidator = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("pending") }).strict(),
    z
      .object({
        type: z.literal("valid"),
        idCount: z
          .number()
          .int()
          .nonnegative()
          .describe("IDs in the file, before removing duplicates"),
      })
      .strict(),
    z
      .object({
        type: z.literal("invalid"),
        invalidLineCount: z.number().int().nonnegative(),
        errors: lineErrors,
      })
      .strict(),
  ])
  .describe(
    "`pending` until GrowthBook has checked the whole file. Loaders only see `valid` uploads.",
  );

export type SavedGroupUploadStatus = z.infer<
  typeof savedGroupUploadStatusValidator
>;

/** Each upload is a new version of a remote group's IDs. */
export const savedGroupUploadValidator = baseSchema.safeExtend({
  savedGroupId: z.string(),
  version: z.number().int().positive(),
  // Where the client uploaded the file; it can still overwrite it there
  sourceKey: z.string(),
  // GrowthBook's own copy, which nothing writes to after it's made
  fileKey: z.string(),
  size: z.number().int().nonnegative(),
  createdBy: z.string(),
  status: savedGroupUploadStatusValidator,
  // One entry per data store, from loaders' reports
  loads: z.array(savedGroupUploadLoadValidator).optional(),
});

export type SavedGroupUploadInterface = z.infer<
  typeof savedGroupUploadValidator
>;

export const apiSavedGroupUploadValidator = namedSchema(
  "SavedGroupUpload",
  z
    .object({
      savedGroupId: z.string(),
      version: z.number().int(),
      size: z.number().int().describe("File size in bytes"),
      dateCreated: z.string().meta({ format: "date-time" }),
      createdBy: z.string(),
      status: savedGroupUploadStatusValidator,
      loads: z
        .array(
          z
            .object({
              ...loadReportFields,
              dateUpdated: z.string().meta({ format: "date-time" }),
            })
            .strict(),
        )
        .describe("Each data store's latest report on loading this upload"),
    })
    .strict(),
);

export type ApiSavedGroupUpload = z.infer<typeof apiSavedGroupUploadValidator>;

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listSavedGroupUploadsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: idParams,
  // One object, not an intersection: the generated spec closes each part of
  // an intersection, which would make the pagination fields invalid.
  responseSchema: z
    .object({
      uploads: z.array(apiSavedGroupUploadValidator),
      ...apiPaginationFieldsValidator.shape,
    })
    .strict(),
  summary: "List the uploads of a remote saved group",
  description: "Newest first.",
  operationId: "listSavedGroupUploads",
  tags: ["saved-groups"],
  method: "get" as const,
  path: "/saved-groups/:id/uploads",
  exampleRequest: { params: { id: "abc123" } },
};

export const savedGroupUploadUrlResponseValidator = z
  .object({
    signedUrl: z.string(),
    fields: z
      .record(z.string(), z.string())
      .nullable()
      .describe(
        "Form fields for an S3 presigned POST. When null, PUT the file to `signedUrl` instead.",
      ),
    fileKey: z
      .string()
      .describe("Pass this to the create upload endpoint after uploading"),
    maxBytes: z.number().int(),
    expiresAt: z.string().meta({ format: "date-time" }),
  })
  .strict();

export const postSavedGroupUploadUrlValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: savedGroupUploadUrlResponseValidator,
  summary: "Get a signed URL to upload a remote saved group CSV",
  description:
    "Upload a CSV with one ID per line to the returned URL with `Content-Type: text/csv`, then create an upload with the `fileKey`. A first line equal to the attribute name is a header. Needs S3 or Google Cloud Storage.",
  operationId: "postSavedGroupUploadUrl",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups/:id/upload-url",
  exampleRequest: { params: { id: "abc123" } },
};

export const postSavedGroupUploadBodyValidator = z
  .object({
    fileKey: z.string().describe("The `fileKey` from the upload URL endpoint"),
  })
  .strict();

export const postSavedGroupUploadValidator = {
  bodySchema: postSavedGroupUploadBodyValidator,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      upload: apiSavedGroupUploadValidator,
    })
    .strict(),
  summary: "Upload a new version of a remote saved group's IDs",
  description:
    "Replaces the group's IDs with the next version. The start and end of the file are checked for one ID per line; loaders trim and deduplicate the IDs. The SDK payload doesn't change; loaders pick up the new version from `latestUpload` on the saved group, and download it from `GET /saved-groups/{id}/uploads/{version}/file`, which redirects to a signed storage URL and supports `If-None-Match`.",
  operationId: "postSavedGroupUpload",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups/:id/uploads",
  exampleRequest: {
    params: { id: "abc123" },
    body: { fileKey: "org_abc/remote-saved-groups/grp_123/uploads/1234.csv" },
  },
};

export const postSavedGroupUploadLoadBodyValidator = z
  .object(loadReportFields)
  .strict();

export const postSavedGroupUploadLoadValidator = {
  bodySchema: postSavedGroupUploadLoadBodyValidator,
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z.string().describe("The id of the remote saved group"),
      version: z.coerce.number().int().positive(),
    })
    .strict(),
  responseSchema: z
    .object({
      upload: apiSavedGroupUploadValidator,
    })
    .strict(),
  summary: "Report loading a remote saved group upload into a data store",
  description:
    "Called by remote saved group loaders. Each report replaces the previous one from the same `storeId`. Needs permission to publish the saved group.",
  operationId: "postSavedGroupUploadLoad",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups/:id/uploads/:version/loads",
  exampleRequest: {
    params: { id: "abc123", version: 3 },
    body: {
      storeId: "7f3c2a9e-redis-us-east",
      status: { type: "loaded" as const, rowCount: 120000 },
    },
  },
};
