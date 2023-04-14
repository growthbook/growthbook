import { Router } from "express";
import { getSavedGroup } from "./getSavedGroup";
import { listSavedGroups } from "./listSavedGroups";
import { patchSavedGroup } from "./patchSavedGroup";
import { postSavedGroup } from "./postSavedGroup";
import { putSavedGroup } from "./putSavedGroup";

const router = Router();

// SavedGroup Endpoints
// Mounted at /api/v1/saved-groups
router.get("/", listSavedGroups);
router.get("/:id", getSavedGroup);
router.put("/:id", putSavedGroup);
router.patch("/:id", patchSavedGroup);
router.post("/", postSavedGroup);

export default router;
