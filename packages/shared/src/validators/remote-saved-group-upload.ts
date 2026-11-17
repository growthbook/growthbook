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
      "The data store's ID, such as `redis-us-east`, set in the loader's config. Loaders sharing a store (such as one Redis) use the same ID. Shown in the UI.",
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
  // The file's name on the uploader's computer, used for downloads
  fileName: z.string().optional(),
  size: z.number().int().nonnegative(),
  // Whether IDs are parsed as numbers, from the attribute's type at upload.
  // Fixed per version, so every store loads it the same way even if the
  // attribute's type changes later. Older uploads don't have it.
  numeric: z.boolean().optional(),
  createdBy: z.string(),
  status: savedGroupUploadStatusValidator,
  // One entry per data store, from loaders' reports
  loads: z.array(savedGroupUploadLoadValidator).optional(),
  // Hex SHA-256 of the file, computed when it's validated
  sha256: z.string().optional(),
  // Set when deleted. The record stays, so its version number isn't reused.
  dateDeleted: z.date().optional(),
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
      fileName: z
        .string()
        .nullable()
        .describe("The uploaded file's original name, if it was given"),
      size: z.number().int().describe("File size in bytes"),
      sha256: z
        .string()
        .nullable()
        .describe(
          "Hex SHA-256 of the file, set once it's validated. Null if it isn't validated yet, or wasn't read in full.",
        ),
      dateCreated: z.string().meta({ format: "date-time" }),
      createdBy: z
        .string()
        .describe(
          "Who uploaded it: a user ID, or an API key ID (`key_…`) for a key acting as itself",
        ),
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

/** One upload for the app's details view, with what storage reports. */
export const savedGroupUploadDetailsValidator = z
  .object({
    upload: apiSavedGroupUploadValidator,
    file: z
      .object({
        size: z.number().int(),
        contentType: z.string().nullable(),
        lastModified: z.string().nullable(),
        etag: z.string().nullable(),
      })
      .strict()
      .nullable()
      .describe("Null when the file is missing from storage"),
    storageLocation: z
      .string()
      .nullable()
      .describe("Where the file is stored. Null on GrowthBook Cloud."),
  })
  .strict();

export type SavedGroupUploadDetails = z.infer<
  typeof savedGroupUploadDetailsValidator
>;

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

export type SavedGroupUploadUrlResponse = z.infer<
  typeof savedGroupUploadUrlResponseValidator
>;

export const postSavedGroupUploadUrlValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: savedGroupUploadUrlResponseValidator,
  summary: "Get a signed URL to upload a remote saved group CSV",
  description:
    "Upload a CSV with one ID per line to the returned URL with `Content-Type: text/csv`, then create an upload with the `fileKey`. A first line equal to the attribute name is a header. Needs S3 or Google Cloud Storage.",
  confirmation: ["savedGroup.draft"] as const,
  operationId: "postSavedGroupUploadUrl",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups/:id/upload-url",
  exampleRequest: { params: { id: "abc123" } },
};

export const postSavedGroupUploadBodyValidator = z
  .object({
    fileKey: z.string().describe("The `fileKey` from the upload URL endpoint"),
    fileName: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("The file's original name, used when downloading it"),
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
    "Records the next version of the group's IDs. The start and end of the file are checked for one ID per line, then the whole file in the background; loaders trim and deduplicate the IDs. Poll `GET /saved-groups/{id}/uploads/{version}` until it's valid, then set the group's `currentUploadVersion` with `PUT /saved-groups-revisions/{id}/{version}/upload-version` to use it. Loaders pick up the group's version from `currentUpload` and download it from `GET /saved-groups/{id}/uploads/{version}/file`, which redirects to a short-lived signed storage URL.",
  confirmation: ["savedGroup.draft"] as const,
  operationId: "postSavedGroupUpload",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups/:id/uploads",
  exampleRequest: {
    params: { id: "abc123" },
    body: { fileKey: "org_abc/remote-saved-groups/grp_123/staging/1234.csv" },
  },
};

const uploadVersionParams = z
  .object({
    id: z.string().describe("The id of the remote saved group"),
    version: z.coerce.number().int().positive(),
  })
  .strict();

export const getSavedGroupUploadValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: uploadVersionParams,
  responseSchema: z
    .object({
      upload: apiSavedGroupUploadValidator,
    })
    .strict(),
  summary: "Get one upload of a remote saved group",
  description:
    "Returns an upload of any status. After creating an upload, poll this until `status.type` is `valid` or `invalid`.",
  operationId: "getSavedGroupUpload",
  tags: ["saved-groups"],
  method: "get" as const,
  path: "/saved-groups/:id/uploads/:version",
  exampleRequest: { params: { id: "abc123", version: 3 } },
};

export const deleteSavedGroupUploadValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: uploadVersionParams,
  responseSchema: z
    .object({
      deletedVersion: z.number().int(),
    })
    .strict(),
  summary: "Delete an upload of a remote saved group",
  description:
    "Deletes the upload and its file. The version the group uses, or one an open draft uses, can't be deleted. Version numbers aren't reused. Needs permission to publish the saved group.",
  confirmation: ["savedGroup.delete"] as const,
  operationId: "deleteSavedGroupUpload",
  tags: ["saved-groups"],
  method: "delete" as const,
  path: "/saved-groups/:id/uploads/:version",
  exampleRequest: { params: { id: "abc123", version: 3 } },
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
  confirmation: ["savedGroup.other"] as const,
  operationId: "postSavedGroupUploadLoad",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups/:id/uploads/:version/loads",
  exampleRequest: {
    params: { id: "abc123", version: 3 },
    body: {
      storeId: "redis-us-east",
      status: { type: "loaded" as const, rowCount: 120000 },
    },
  },
};
