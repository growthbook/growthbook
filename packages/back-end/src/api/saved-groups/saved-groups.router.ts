import { Router } from "express";
import { getSavedGroup } from "./getSavedGroup";
import { listSavedGroups } from "./listSavedGroups";
import { postSavedGroup } from "./postSavedGroup";
import { putSavedGroup } from "./putSavedGroup";

const router = Router();

// SavedGroup Endpoints
// Mounted at /api/v1/saved-groups
router.get("/", listSavedGroups);
router.get("/:id", getSavedGroup);
router.put("/:id", putSavedGroup);
router.post("/", postSavedGroup);

export default router;
