import { Router } from "express";
import { getSavedGroup } from "./getSavedGroup";
import { listSavedGroups } from "./listSavedGroups";
import { postSavedGroup } from "./postSavedGroup";
import { updateSavedGroup } from "./updateSavedGroup";
import { deleteSavedGroup } from "./deleteSavedGroup";
import { postSavedGroupAddMember } from "./postSavedGroupAddMember";
import { postSavedGroupRemoveMember } from "./postSavedGroupRemoveMember";

const router = Router();

// SavedGroup Endpoints
// Mounted at /api/v1/saved-groups
router.get("/", listSavedGroups);
router.post("/", postSavedGroup);
router.get("/:id", getSavedGroup);
router.post("/:id", updateSavedGroup);
router.delete("/:id", deleteSavedGroup);
router.post("/:id/add-member/:mid", postSavedGroupAddMember);
router.post("/:id/remove-member/:mid", postSavedGroupRemoveMember);

export default router;
