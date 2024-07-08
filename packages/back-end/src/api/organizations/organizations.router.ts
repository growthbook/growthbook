import { Router } from "express";
import { postOrganization } from "./postOrganization";
import { listOrganizations } from "./listOrganizations";
import { putOrganization } from "./putOrganization";

const router = Router();

// Organization Endpoints
// Mounted at /api/v1/organizations
router.get("/", listOrganizations);
router.post("/", postOrganization);
router.put("/:id", putOrganization);

export default router;
