import { Router } from "express";
import { listGroups } from "./listGroups.js";
import { createGroup } from "./createGroup.js";
import { getGroup } from "./getGroup.js";
import { patchGroup } from "./patchGroup.js";
import { deleteGroup } from "./deleteGroup.js";

const router = Router();

// Groups Endpoints
// Mounted at /scim/v2/groups
router.get("/", listGroups);
router.get("/:id", getGroup);
router.post("/", createGroup);
router.patch("/:id", patchGroup);
router.delete("/:id", deleteGroup);

export default router;
