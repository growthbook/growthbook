import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import cloneDeep from "lodash/cloneDeep";
import { Changeset } from "shared/types/experiment";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { uploadFile } from "back-end/src/services/files";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";

const MIMETYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
};

const postVariationImageUploadValidator = {
  paramsSchema: z
    .object({
      id: z.string(),
      variationId: z.string(),
    })
    .strict(),
  bodySchema: z
    .object({
      screenshot: z
        .string()
        .meta({ contentEncoding: "base64" })
        .describe("Base64-encoded screenshot data"),
      contentType: z
        .enum(["image/png", "image/jpeg", "image/gif"])
        .describe("MIME type of the screenshot"),
      description: z
        .string()
        .describe("Optional description for the screenshot")
        .optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: z.object({
    screenshot: z.object({
      path: z.string().describe("URL or path to the uploaded screenshot"),
      description: z.string().describe("Description of the screenshot"),
    }),
  }),
  method: "post" as const,
  path: "/experiments/:id/variation/:variationId/screenshot/upload",
  operationId: "postVariationImageUpload",
  summary: "Upload a variation screenshot",
  tags: ["experiments"],
};

export const postVariationImageUpload = createApiRequestHandler(
  postVariationImageUploadValidator,
)(async (req) => {
  const context = req.context;
  const { id, variationId } = req.params;
  const { screenshot, contentType, description = "" } = req.body;

  if (context.org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  if (!context.permissions.canAddComment([])) {
    context.permissions.throwPermissionError();
  }

  let screenshotBuffer: Buffer;
  try {
    screenshotBuffer = Buffer.from(screenshot, "base64");
  } catch {
    throw new Error("Invalid base64 screenshot data");
  }

  if (screenshotBuffer.length === 0) {
    throw new Error("Screenshot data cannot be empty");
  }

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.organization !== context.org.id) {
    throw new Error("You do not have access to this experiment");
  }

  const changes: Changeset = {};
  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const variationIndex = experiment.variations.findIndex(
    (v) => v.id === variationId,
  );
  if (variationIndex === -1) {
    throw new Error(`Unknown variation ${variationId}`);
  }

  const ext = MIMETYPES[contentType];
  const now = new Date();
  const pathPrefix = `${context.org.id}/${now.toISOString().substr(0, 7)}/`;
  const fileName = "img_" + uuidv4();
  const filePath = `${pathPrefix}${fileName}.${ext}`;
  const fileURL = await uploadFile(filePath, contentType, screenshotBuffer);

  experiment.variations[variationIndex].screenshots =
    experiment.variations[variationIndex].screenshots || [];

  changes.variations = cloneDeep(experiment.variations);
  changes.variations[variationIndex].screenshots.push({
    path: fileURL,
    description,
  });

  await updateExperiment({
    context,
    experiment,
    changes,
  });

  await req.audit({
    event: "experiment.screenshot.create",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsCreate({
      variation: variationIndex,
      url: fileURL,
      description,
    }),
  });

  if (context.userId) {
    await context.models.watch.upsertWatch({
      userId: context.userId,
      item: experiment.id,
      type: "experiments",
    });
  }

  return {
    screenshot: {
      path: fileURL,
      description,
    },
  };
});
