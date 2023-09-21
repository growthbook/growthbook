import { Router } from "express";
import { listGroups } from "./listGroups";

const router = Router();

// DataSource Endpoints
// Mounted at /scim/v2/groups
router.get("/", listGroups);

export default router;
