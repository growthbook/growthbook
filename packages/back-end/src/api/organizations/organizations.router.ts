import { Router } from "express";
import { postOrganization } from "./postOrganization.js";
import { listOrganizations } from "./listOrganizations.js";
import { putOrganization } from "./putOrganization.js";

const router = Router();

// Organization Endpoints
// Mounted at /api/v1/organizations
router.get("/", listOrganizations);
router.post("/", postOrganization);
router.put("/:id", putOrganization);

export default router;
