import { Router } from "express";
import { postOrganization } from "./postOrganization";
import { listOrganizations } from "./listOrganizations";
import { putOrganization } from "./putOrganization";
import { listEnvironments } from "./listEnvironments";
import { putEnvironment } from "./putEnvironment";
import { postEnvironment } from "./postEnvironment";
import { deleteEnvironment } from "./deleteEnvironment";

const router = Router();

// Organization Endpoints
// Mounted at /api/v1/organizations
router.get("/", listOrganizations);
router.post("/", postOrganization);
router.put("/:id", putOrganization);
router.get("/:id/environments", listEnvironments);
router.post("/:id/environments", postEnvironment);
router.put("/:id/environments/:environmentId", putEnvironment);
router.delete("/:id/environments/:environmentId", deleteEnvironment);

export default router;
