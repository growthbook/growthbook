import { Router } from "express";
import { listGroups } from "./listGroups";
import { createGroup } from "./createGroup";
import { getGroup } from "./getGroup";

const router = Router();

// Groups Endpoints
// Mounted at /scim/v2/groups
router.get("/", listGroups);
router.get("/:id", getGroup);
router.post("/", createGroup);

export default router;
