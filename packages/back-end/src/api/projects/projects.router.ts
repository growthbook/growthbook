import { Router } from "express";
import { getProject } from "./getProject";
import { listProjects } from "./listProjects";
import { putProject } from "./putProject";
import { postProject } from "./postProject";
import { deleteProject } from "./deleteProject";

const router = Router();

// Project Endpoints
// Mounted at /api/v1/projects
router.get("/", listProjects);
router.post("/", postProject);
router.get("/:id", getProject);
router.put("/:id", putProject);
router.delete("/:id", deleteProject);

export default router;
