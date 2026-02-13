import { Router } from "express";
import { getProject } from "./getProject.js";
import { listProjects } from "./listProjects.js";
import { putProject } from "./putProject.js";
import { postProject } from "./postProject.js";
import { deleteProject } from "./deleteProject.js";

const router = Router();

// Project Endpoints
// Mounted at /api/v1/projects
router.get("/", listProjects);
router.post("/", postProject);
router.get("/:id", getProject);
router.put("/:id", putProject);
router.delete("/:id", deleteProject);

export default router;
