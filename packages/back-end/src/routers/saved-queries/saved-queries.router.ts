import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawSavedQueriesController from "./saved-queries.controller";

const router = express.Router();

const savedQueriesController = wrapController(rawSavedQueriesController);

router.get("/", savedQueriesController.getSavedQueries);

router.post("/", savedQueriesController.postSavedQuery);

router.put("/:id", savedQueriesController.putSavedQuery);

router.delete("/:id", savedQueriesController.deleteSavedQuery);

export { router as savedQueriesRouter };
