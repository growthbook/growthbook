import { RequestHandler, Router } from "express";
import { listGroups } from "./listGroups";
import { createGroup } from "./createGroup";
import { getGroup } from "./getGroup";
import { patchGroup } from "./patchGroup";
import { deleteGroup } from "./deleteGroup";

const router = Router();

// Groups Endpoints
// Mounted at /scim/v2/groups
router.get("/", listGroups as unknown as RequestHandler);
router.get("/:id", getGroup as unknown as RequestHandler);
router.post("/", createGroup as unknown as RequestHandler);
router.patch("/:id", patchGroup as unknown as RequestHandler);
router.delete("/:id", deleteGroup as unknown as RequestHandler);

export default router;
