import express from "express";
import * as tagsController from "../controllers/tags";
import { wrapController } from "../services/routers";

wrapController(tagsController);

const router = express.Router();

router.post("", tagsController.postTag);
router.delete("/:id", tagsController.deleteTag);

export { router as tagsRouter };
