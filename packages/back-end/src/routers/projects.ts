import express from "express";
import * as projectsController from "../controllers/projects";
import { wrapController } from "../services/routers";

wrapController(projectsController);

const router = express.Router();

router.post("", projectsController.postProjects);
router.put("/:id", projectsController.putProject);
router.delete("/:id", projectsController.deleteProject);

export { router as projectsRouter };
