import { z } from "zod";
import { baseSchema } from "./base-model";

/** Each upload is a new version of the group's IDs. */
export const savedGroupUploadValidator = baseSchema.safeExtend({
  savedGroupId: z.string(),
  version: z.number().int().positive(),
  fileKey: z.string(),
  size: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  createdBy: z.string(),
});

export type SavedGroupUploadInterface = z.infer<
  typeof savedGroupUploadValidator
>;

// TODO(remote-saved-groups): wrap the API schemas below in namedSchema once an
// endpoint uses them, so the API docs don't list them before then.

export const apiSavedGroupVersionValidator = z
  .object({
    savedGroupId: z.string(),
    version: z.number().int(),
    size: z.number().int().describe("File size in bytes"),
    rowCount: z.number().int().describe("Number of unique IDs in the file"),
    dateCreated: z.string().meta({ format: "date-time" }),
    createdBy: z.string(),
  })
  .strict();

export type ApiSavedGroupVersion = z.infer<
  typeof apiSavedGroupVersionValidator
>;

export const listSavedGroupVersionsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z.string().describe("The id of the requested resource"),
    })
    .strict(),
  responseSchema: z
    .object({
      versions: z.array(apiSavedGroupVersionValidator),
    })
    .strict(),
  summary: "List the uploaded versions of a remote saved group",
  operationId: "listSavedGroupVersions",
  tags: ["saved-groups"],
  method: "get" as const,
  path: "/saved-groups/:id/versions",
  exampleRequest: { params: { id: "abc123" } },
};

export const apiRemoteSavedGroupValidator = z
  .object({
    id: z.string(),
    attributeKey: z.string(),
    version: z
      .number()
      .int()
      .nullable()
      .describe("The current uploaded version, or null before any upload"),
    archived: z
      .boolean()
      .describe("Archived groups are listed so loaders can remove them"),
  })
  .strict();

export type ApiRemoteSavedGroup = z.infer<typeof apiRemoteSavedGroupValidator>;

export const listRemoteSavedGroupsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      savedGroups: z.array(apiRemoteSavedGroupValidator),
    })
    .strict(),
  summary: "List remote saved groups and their current versions",
  description:
    "Used by remote saved group loaders to find new uploads. Includes archived groups so loaders can remove them.",
  operationId: "listRemoteSavedGroups",
  tags: ["saved-groups"],
  method: "get" as const,
  path: "/remote-saved-groups",
};
