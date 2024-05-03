import { Router } from "express";
import { getProject } from "./getProject";
import { listProjects } from "./listProjects";
import { putProject } from "./putProject";

const router = Router();

// Project Endpoints
// Mounted at /api/v1/projects
router.get("/", listProjects);
router.get("/:id", getProject);
router.put("/:id", putProject);

export default router;
