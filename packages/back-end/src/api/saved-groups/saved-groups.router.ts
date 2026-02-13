import { Router } from "express";
import { getSavedGroup } from "./getSavedGroup.js";
import { listSavedGroups } from "./listSavedGroups.js";
import { postSavedGroup } from "./postSavedGroup.js";
import { updateSavedGroup } from "./updateSavedGroup.js";
import { deleteSavedGroup } from "./deleteSavedGroup.js";

const router = Router();

// SavedGroup Endpoints
// Mounted at /api/v1/saved-groups
router.get("/", listSavedGroups);
router.post("/", postSavedGroup);
router.get("/:id", getSavedGroup);
router.post("/:id", updateSavedGroup);
router.delete("/:id", deleteSavedGroup);

export default router;
