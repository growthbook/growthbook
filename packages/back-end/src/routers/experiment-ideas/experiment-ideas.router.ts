import express from "express";
import { z } from "zod";
import {
  postExperimentIdeaBody,
  putExperimentIdeaBody,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-ideas.controller";

const router = express.Router();
const ExperimentIdeasController = wrapController(rawController);

const idParams = z.object({ id: z.string() }).strict();

const stageColor = z.enum([
  "gray",
  "blue",
  "cyan",
  "indigo",
  "violet",
  "purple",
  "amber",
  "orange",
  "yellow",
  "green",
  "teal",
  "red",
  "pink",
]);

router.get(
  "/",
  validateRequestMiddleware({
    query: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
  }),
  ExperimentIdeasController.getExperimentIdeas,
);

router.post(
  "/",
  validateRequestMiddleware({ body: postExperimentIdeaBody }),
  ExperimentIdeasController.postExperimentIdea,
);

router.put(
  "/stages",
  validateRequestMiddleware({
    body: z
      .object({
        stages: z
          .array(
            z
              .object({
                id: z.string().min(1).max(64),
                label: z.string().max(64),
                color: stageColor.optional(),
                description: z.string().max(200).optional(),
              })
              .strict(),
          )
          .max(20),
        defaultStageId: z.string(),
      })
      .strict(),
  }),
  ExperimentIdeasController.putExperimentIdeaStages,
);

router.get(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  ExperimentIdeasController.getExperimentIdea,
);

router.put(
  "/:id",
  validateRequestMiddleware({ params: idParams, body: putExperimentIdeaBody }),
  ExperimentIdeasController.putExperimentIdea,
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  ExperimentIdeasController.deleteExperimentIdea,
);

router.post(
  "/:id/archive",
  validateRequestMiddleware({ params: idParams }),
  ExperimentIdeasController.postArchiveExperimentIdea,
);

router.post(
  "/:id/restore",
  validateRequestMiddleware({ params: idParams }),
  ExperimentIdeasController.postRestoreExperimentIdea,
);

router.post(
  "/:id/upvote",
  validateRequestMiddleware({ params: idParams }),
  ExperimentIdeasController.postExperimentIdeaUpvote,
);

router.delete(
  "/:id/upvote",
  validateRequestMiddleware({ params: idParams }),
  ExperimentIdeasController.deleteExperimentIdeaUpvote,
);

export { router as experimentIdeasRouter };
