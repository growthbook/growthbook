import { z } from "zod";
import { namedSchema } from "./openapi-helpers";

const checklistTask = z
  .object({
    task: z.string().min(1).describe("Shown to the person launching"),
    completionType: z
      .enum(["manual", "auto"])
      .describe("`auto` items are checked off from the experiment itself"),
    url: z.string().optional().describe("Optional link shown with the task"),
    propertyKey: z
      .enum([
        "description",
        "hypothesis",
        "project",
        "tag",
        "screenshots",
        "prerequisiteTargeting",
        "customField",
        "schedule",
      ])
      .optional()
      .describe("For `auto` items: the experiment field that must be set"),
    customFieldId: z
      .string()
      .optional()
      .describe("When propertyKey is `customField`"),
  })
  .strict();

export const apiLaunchChecklistValidator = namedSchema(
  "LaunchChecklist",
  z
    .object({
      id: z.string(),
      projectId: z
        .string()
        .describe("Empty for the organization-wide checklist"),
      tasks: z.array(checklistTask),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

const scopeQuery = z
  .object({
    projectId: z
      .string()
      .optional()
      .describe(
        "Omit for the organization-wide checklist. A Project's checklist replaces the organization's for its experiments.",
      ),
  })
  .strict();

const premiumNote =
  "Requires the custom pre-launch checklist feature. The organization checklist needs permission to manage settings; a Project's needs permission to update the Project.";

export const getLaunchChecklistValidator = {
  bodySchema: z.never(),
  querySchema: scopeQuery,
  paramsSchema: z.never(),
  responseSchema: z
    .object({ launchChecklist: apiLaunchChecklistValidator.nullable() })
    .strict(),
  summary: "Get the pre-launch checklist for the organization or a Project",
  operationId: "getLaunchChecklist",
  tags: ["experiments"],
  method: "get" as const,
  path: "/launch-checklist",
};

export const putLaunchChecklistValidator = {
  bodySchema: z
    .object({
      tasks: z.array(checklistTask).superRefine((tasks, ctx) => {
        tasks.forEach((t, i) => {
          if (t.completionType === "auto" && !t.propertyKey) {
            ctx.addIssue({
              code: "custom",
              path: [i, "propertyKey"],
              message: "auto tasks need a propertyKey",
            });
          }
          if (t.propertyKey === "customField" && !t.customFieldId) {
            ctx.addIssue({
              code: "custom",
              path: [i, "customFieldId"],
              message: "customField tasks need a customFieldId",
            });
          }
        });
      }),
    })
    .strict(),
  querySchema: scopeQuery,
  paramsSchema: z.never(),
  responseSchema: z
    .object({ launchChecklist: apiLaunchChecklistValidator })
    .strict(),
  summary: "Create or replace a pre-launch checklist",
  description: premiumNote,
  operationId: "putLaunchChecklist",
  tags: ["experiments"],
  method: "put" as const,
  path: "/launch-checklist",
};

export const deleteLaunchChecklistValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ projectId: z.string() }).strict(),
  paramsSchema: z.never(),
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a Project's pre-launch checklist",
  description:
    "Its experiments fall back to the organization checklist. The organization checklist itself can't be deleted, only emptied.",
  operationId: "deleteLaunchChecklist",
  tags: ["experiments"],
  method: "delete" as const,
  path: "/launch-checklist",
};
