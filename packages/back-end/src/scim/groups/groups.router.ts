import { Router } from "express";
import { listGroups } from "./listGroups";
import { createGroup } from "./createGroup";
import { getGroup } from "./getGroup";
import { patchGroup } from "./patchGroup";
import { deleteGroup } from "./deleteGroup";

const router = Router();

// Groups Endpoints
// Mounted at /scim/v2/groups
router.get("/", listGroups);
router.get("/:id", getGroup);
router.post("/", createGroup);
router.patch("/:id", patchGroup);
router.delete("/:id", deleteGroup);

export default router;
