import { Router } from "express";
import { getSavedGroup } from "./getSavedGroup";
import { listSavedGroups } from "./listSavedGroups";
import { postSavedGroup } from "./postSavedGroup";
import { updateSavedGroup } from "./updateSavedGroup";

const router = Router();

// SavedGroup Endpoints
// Mounted at /api/v1/saved-groups
router.get("/", listSavedGroups);
router.get("/:id", getSavedGroup);
router.post("/:id", updateSavedGroup);
router.post("/", postSavedGroup);

export default router;
